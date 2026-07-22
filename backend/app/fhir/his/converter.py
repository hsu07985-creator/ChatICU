"""HISConverter — orchestrates the 7-entity HIS JSON → ChatICU DB conversion.

The heavy lifting (date parsing, drug/lab dictionaries, resource loads, and
filesystem snapshot reading) lives in sibling modules; this module wires them
together into the per-patient converter.
"""

import json
import os
import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.fhir.his_lab_mapping import HIS_LAB_MAP
from app.models.coding_source import VALID_CODING_SOURCES

from app.fhir.his.drug_dictionaries import (
    _FREQ_MAP,
    _OPD_SW_MAP,
    _ROUTE_MAP,
    _classify_category,
    _classify_san,
    _clean_drug_name,
    _combo_generic_from_his,
)
from app.fhir.his.lab_dictionaries import _build_ecg_impression
from app.fhir.his.resources import (
    _FORMULARY_MAP,
)
from app.fhir.his import snapshot_io
from app.fhir.his.roc_time import (
    _gen_id,
    _normalize_patient_gender,
    _roc_birthday_to_age,
    _roc_to_date,
    _roc_to_datetime,
)


# HIS ICU bed code (MICU01 / GICU07 / any *ICU + digits) → display label "I-01".
# The number keeps its 2-digit zero-padded form; non-ICU codes are returned as-is.
_ICU_BED_RE = re.compile(r"^[A-Za-z]*ICU0*(\d+)$", re.IGNORECASE)


def _format_bed_number(code: str) -> str:
    m = _ICU_BED_RE.match(code)
    if m:
        return f"I-{int(m.group(1)):02d}"
    return code


def _to_float(value: Any) -> Optional[float]:
    """Parse HIS numeric strings ('163', '53.7') to float; None when unparseable."""
    if value is None or value == "":
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> Optional[int]:
    """Parse HIS numeric strings to int (via float, tolerating '99.0'); None if bad."""
    f = _to_float(value)
    return int(round(f)) if f is not None else None


class HISConverter:
    """Convert HIS JSON data for one patient → ChatICU DB dicts."""

    def __init__(self, patient_dir: str, pat_no: Optional[str] = None):
        self.patient_dir = patient_dir
        self.pat_no = pat_no or os.path.basename(patient_dir)
        self._cache: Dict[str, Any] = {}

    def _load(self, filename: str) -> list:
        """Load a HIS JSON file for single-record types (patient demographics).

        See :func:`app.fhir.his.snapshot_io.load_single` for the full
        campus-fallback resolution strategy.
        """
        return snapshot_io.load_single(self._cache, self.patient_dir, filename)

    def _load_all(self, filename: str) -> list:
        """Load a HIS JSON file across ALL campuses and concatenate.

        See :func:`app.fhir.his.snapshot_io.load_all`.
        """
        return snapshot_io.load_all(self._cache, self.patient_dir, filename)

    def _load_sb(self, sb_name: str) -> list:
        """Load a SMARTBED nursing source (sbNutrition, sbTube, sbDisease, …).

        See :func:`app.fhir.his.snapshot_io.load_smartbed`.
        """
        return snapshot_io.load_smartbed(self._cache, self.patient_dir, sb_name)

    def _load_seq(self, tool: str) -> list:
        """Load a ``<tool>_AllPatientSeq`` envelope's rows (getSO, getTPR, …).

        See :func:`app.fhir.his.snapshot_io.load_seq`.
        """
        return snapshot_io.load_seq(self._cache, self.patient_dir, tool)

    @staticmethod
    def _load_from_dir(dir_path: str, candidates: Tuple[str, ...]) -> list:
        """Try each candidate filename in ``dir_path``; return its Data array.

        See :func:`app.fhir.his.snapshot_io._load_from_dir`.
        """
        return snapshot_io._load_from_dir(dir_path, candidates)

    # ------------------------------------------------------------------ #
    # Patient
    # ------------------------------------------------------------------ #

    def convert_patient(self) -> Optional[Dict[str, Any]]:
        """getPatient.json → patients table dict."""
        rows = self._load("getPatient.json")
        if not rows:
            return None
        p = rows[0]

        pat_id = _gen_id("pat", self.pat_no)
        age = _roc_birthday_to_age(p.get("BIRTHDAY"))
        dob = _roc_to_date(p.get("BIRTHDAY"))
        blood_type = None
        if p.get("BLOODTYPE_LAB"):
            rh = p.get("BLOODTYPE_LAB_RH", "")
            blood_type = f"{p['BLOODTYPE_LAB']}{rh}"

        # DNR
        has_dnr = bool(p.get("DNR_CONSENT") or p.get("DNR_IC_FLAG"))
        code_status = "DNR" if has_dnr else "Full Code"

        # Discharge/death fields are direct HIS dates. REAL_OUT_DATE does not
        # encode a disposition, so only DEAD_DATE may set discharge_type.
        dead_date = _roc_to_date(p.get("DEAD_DATE"))
        current_ipd = self._current_ipd_row()
        real_out_date = _roc_to_date(current_ipd.get("REAL_OUT_DATE")) if current_ipd else None
        discharge_date = dead_date or real_out_date
        archived = bool(discharge_date)

        # Diagnosis from getOpd ICD codes
        diagnosis = self._extract_diagnosis()

        # Department and attending physician from getOpd
        dept, doctor = self._extract_dept_doctor()

        # Admission date from getIPD or earliest order
        admission_date, icu_admission_date = self._extract_admission_dates()

        # SMARTBED-derived vitals-adjacent fields (2026-07-21 nested snapshot):
        # bed from the in-bed roster, anthropometrics from nutrition assessment,
        # airway status and dates from the tube list.
        bed_number = self._extract_bed_number()
        height, weight, bmi = self._extract_anthropometrics()
        intubated, intubation_date, tracheostomy, tracheostomy_date = self._extract_airway()

        return {
            "id": pat_id,
            "name": p.get("PAT_NAME", ""),
            "bed_number": bed_number or "",  # '' → not meaningful → keep manual
            "medical_record_number": self.pat_no,
            "age": age or 0,
            "date_of_birth": dob,
            "gender": _normalize_patient_gender(p.get("SEX")),
            "height": height,
            "weight": weight,
            "bmi": bmi,
            "diagnosis": diagnosis or "待確認",
            "symptoms": [],
            "intubated": intubated,
            "intubation_date": intubation_date,
            "tracheostomy": tracheostomy,
            "tracheostomy_date": tracheostomy_date,
            "critical_status": None,
            "sedation": [],
            "analgesia": [],
            "nmb": [],
            "admission_date": admission_date,
            "icu_admission_date": icu_admission_date,
            "ventilator_days": 0,
            "attending_physician": doctor,
            "department": dept,
            "unit": "ICU",
            "alerts": [],
            "consent_status": None,
            "allergies": [],
            "allergies_from_his": False,
            "blood_type": blood_type,
            "code_status": code_status,
            "has_dnr": has_dnr,
            "is_isolated": False,
            "archived": archived,
            "discharge_type": "death" if dead_date else None,
            "discharge_date": discharge_date,
            "campus": None,
            "last_update": None,
        }

    def _extract_diagnosis(self) -> Optional[str]:
        """Extract the current admission diagnosis from getIpd ICD codes.

        getIpd.json contains the active inpatient admission diagnosis with
        ICD codes that already include Chinese descriptions (e.g.
        "A41.9敗血症，未明示病原體"). getIPD is a historical discharge
        summary and must not replace the current admission.
        """
        chosen = self._current_ipd_row()
        if chosen:
            icd_codes = []
            for i in range(1, 11):
                icd = chosen.get(f"ICD_CODE{i}")
                if icd:
                    icd_codes.append(icd)
            if icd_codes:
                return "; ".join(icd_codes)

        # Fallback: getOpd.json with OPD_SW=1 (inpatient visit records)
        opd_rows = self._load("getOpd.json")
        if not opd_rows:
            return None
        inpatient = [r for r in opd_rows if str(r.get("OPD_SW", "")) == "1"]
        if inpatient:
            chosen = max(inpatient, key=lambda r: r.get("PAT_SEQ", ""))
        else:
            chosen = opd_rows[-1]
        icd_codes = []
        for i in range(1, 11):
            icd = chosen.get(f"ICD_CODE{i}")
            if icd:
                icd_codes.append(icd)
        return "; ".join(icd_codes) if icd_codes else None

    def _current_ipd_row(self) -> Optional[dict]:
        """Active getIpd row; getIPD is a different historical source."""
        rows = self._load("getIpd.json")
        if not rows:
            return None
        return next((row for row in reversed(rows) if not row.get("REAL_OUT_DATE")), rows[-1])

    def _extract_dept_doctor(self) -> Tuple[Optional[str], Optional[str]]:
        """Department and attending directly from the active admission row."""
        current = self._current_ipd_row()
        if current and current.get("DR_NAME"):
            return current.get("HDEPT_NAME"), current.get("DR_NAME")

        # Older snapshots without getIpd retain the direct getOpd fallback.
        opd_rows = self._load("getOpd.json")
        if not opd_rows:
            return None, None
        inpatient = [r for r in opd_rows if str(r.get("OPD_SW", "")) == "1"]
        if inpatient:
            chosen = max(inpatient, key=lambda r: r.get("PAT_SEQ", ""))
        else:
            chosen = opd_rows[-1]
        return chosen.get("HDEPT_NAME"), chosen.get("DR_NAME")

    def _extract_admission_dates(self) -> Tuple[Optional[date], Optional[date]]:
        """Extract the current ICU admission date from getIpd."""
        current = self._current_ipd_row()
        if current:
            admission = _roc_to_date(current.get("IPD_DATE"))
            return admission, admission

        # Fallback: earliest inpatient medication order
        med_rows = self._load("getAllMedicine.json")
        earliest = None
        for m in med_rows:
            if m.get("OPD_SW") in ("I", "0", "1"):
                d = _roc_to_date(m.get("START_DATE"))
                if d and (earliest is None or d < earliest):
                    earliest = d
        return earliest, earliest

    def _extract_bed_number(self) -> Optional[str]:
        """This patient's bed from getICUbed (the roster lists the whole unit).

        HIS ships ICU beds as ``MICU01`` (M = Medical ICU); the board shows them
        as ``I-01``. Non-ICU codes (e.g. a ward transfer ``RCW29-1``) are kept
        verbatim.
        """
        for row in self._load("getICUbed.json"):
            if str(row.get("PAT_NO")) == str(self.pat_no):
                code = (row.get("BED_CODE") or "").strip()
                if code:
                    return _format_bed_number(code)
        return None

    def _extract_anthropometrics(
        self,
    ) -> Tuple[Optional[float], Optional[float], Optional[float]]:
        """(height cm, weight kg, BMI) from the SMARTBED nutrition assessment.

        HIS ships these as strings; BMI is pre-computed at source. Returns the
        first assessment row that carries any of the three values.
        """
        for row in self._load_sb("sbNutrition"):
            height = _to_float(row.get("BODY_HEIGHT"))
            weight = _to_float(row.get("BODY_WEIGHT"))
            bmi = _to_float(row.get("BMI"))
            if height or weight or bmi:
                return height, weight, bmi
        return None, None, None

    def _extract_airway(
        self,
    ) -> Tuple[bool, Optional[date], bool, Optional[date]]:
        """Airway status and placement dates from sbTube PIPE_ALIASES.

        ``Endo*`` = endotracheal tube (intubated), ``Tr*`` = tracheostomy. Only
        a present-in-place tube counts — one whose END_DATE is unset or not yet
        past the snapshot date (a removed line keeps its historical row).
        """
        intubated = tracheostomy = False
        intubation_date: Optional[date] = None
        trach_date: Optional[date] = None
        today = date.today()
        for tube in self._load_sb("sbTube"):
            alias = str(tube.get("PIPE_ALIASES") or "")
            end = _roc_to_date(tube.get("END_DATE"))
            if end is not None and end < today:
                continue  # already removed
            if alias.startswith("Endo"):
                intubated = True
                put = _roc_to_date(tube.get("PUT_DATE"))
                if put and (intubation_date is None or put < intubation_date):
                    intubation_date = put
            elif alias.startswith("Tr"):
                tracheostomy = True
                put = _roc_to_date(tube.get("PUT_DATE"))
                if put and (trach_date is None or put < trach_date):
                    trach_date = put
        return intubated, intubation_date, tracheostomy, trach_date

    def _extract_food_allergy(self) -> List[str]:
        """Structured food allergies from sbDisease.FOOD_ALLERGY (comma-list).

        The field is null/'' when there is no positive record (see snapshot
        inventory §4 — '' means 'confirmed none', not 'unknown'), so only a
        non-empty value contributes.
        """
        out: List[str] = []
        for row in self._load_sb("sbDisease"):
            raw = (row.get("FOOD_ALLERGY") or "").strip()
            if not raw or raw in ("無", "否"):
                continue
            for part in re.split(r"[,、;/]", raw):
                part = part.strip()
                if part and part not in out:
                    out.append(part)
        return out

    # ------------------------------------------------------------------ #
    # Medications
    # ------------------------------------------------------------------ #

    def convert_medications(self) -> List[Dict[str, Any]]:
        """HIS medication sources → list of medications table dicts.

        ``getMedicine_AllPatientSeq`` is the complete primary-campus source;
        ``getAllMedicine`` supplies campus metadata and secondary-campus rows.
        """
        rows_by_key: Dict[Tuple[str, str, str, str], dict] = {}
        for row in self._load_all("getAllMedicine.json"):
            key = (
                str(row.get("_source_factory") or "MAIN"),
                str(row.get("PAT_SEQ") or ""),
                str(row.get("ODR_SEQ") or ""),
                str(row.get("ODR_CODE") or ""),
            )
            rows_by_key[key] = dict(row)
        for row in self._load_seq("getMedicine"):
            key = (
                "MAIN",
                str(row.get("PAT_SEQ") or ""),
                str(row.get("ODR_SEQ") or ""),
                str(row.get("ODR_CODE") or ""),
            )
            rows_by_key[key] = {**rows_by_key.get(key, {}), **row, "_source_factory": "MAIN"}

        rows = list(rows_by_key.values())
        patient = self.convert_patient()
        if not patient:
            return []
        pat_id = patient["id"]

        medications = []
        for m in rows:
            raw_name = m.get("ODR_NAME", "")
            clean_name, rule_generic = _clean_drug_name(raw_name)
            odr_code = (m.get("ODR_CODE") or "").strip()

            # Keep the source field source-authentic. DDI aliases are applied only
            # while computing interactions, not written over HIS DRUG_NAME.
            generic = _combo_generic_from_his(m.get("DRUG_NAME") or "") or rule_generic

            freq_code = (m.get("FREQ_CODE") or "").strip().upper()
            route_code = (m.get("ROUTE_CODE") or "").strip().upper()

            # Determine PRN
            is_prn = "PRN" in freq_code

            # Source type comes directly from HIS OPD_SW.
            opd_sw = m.get("OPD_SW", "I")
            source_type = _OPD_SW_MAP.get(opd_sw, "inpatient")

            # Determine status
            dc_flag = m.get("DC_FLAG")
            if dc_flag == "Y":
                status = "discontinued"
            elif source_type == "outpatient":
                # Outpatient Rx: expired when START_DATE + DAYS < today
                start_dt = _roc_to_date(m.get("START_DATE"))
                days_supply = int(float(m["DAYS"])) if m.get("DAYS") else None
                if start_dt and days_supply:
                    if (start_dt + timedelta(days=days_supply)) < date.today():
                        status = "discontinued"
                    else:
                        status = "active"
                else:
                    status = "active"
            else:
                # Inpatient: compare END_DATE with today
                end_dt = _roc_to_date(m.get("END_DATE"))
                if end_dt and end_dt < date.today():
                    status = "discontinued"
                else:
                    status = "active"

            med_id = _gen_id("med", self.pat_no, str(m.get("ODR_SEQ", "")),
                             m.get("PAT_SEQ", ""), m.get("ODR_CODE", ""))

            # HIS ATC_CODE is the source of truth. The formulary remains a
            # fallback and supplies only derived metadata.
            formulary_entry = _FORMULARY_MAP.get(odr_code) if odr_code else None
            his_atc = (m.get("ATC_CODE") or "").strip() or None
            category = _classify_category(his_atc)
            is_antibiotic = category == "antibiotic"
            if his_atc:
                atc_code = his_atc
                kidney_relevant = formulary_entry["kidney_relevant"] if formulary_entry else None
                coding_source = "his_atc"
            elif formulary_entry:
                atc_code = formulary_entry["atc_code"]
                kidney_relevant = formulary_entry["kidney_relevant"]
                coding_source = formulary_entry["source"]
            else:
                atc_code = None
                kidney_relevant = None
                coding_source = "unmapped" if odr_code else None

                # PR-2: cache-only RxNorm fallback. Production syncs never hit network.
                try:
                    from app.fhir.rxnorm import (
                        extract_generic_name as _rxnorm_extract,
                        lookup as _rxnorm_lookup,
                    )

                    generic_candidate = _rxnorm_extract(raw_name)
                    if generic_candidate:
                        hit = _rxnorm_lookup(generic_candidate, online=False)
                        if hit and hit.atc_code:
                            atc_code = hit.atc_code
                            coding_source = "rxnorm_cache"
                except Exception:
                    # RxNorm cache is optional — never fail sync on lookup error
                    pass

            if coding_source is not None and coding_source not in VALID_CODING_SOURCES:
                raise ValueError(
                    f"Invalid coding_source {coding_source!r} for order_code={odr_code!r}. "
                    f"Allowed: {sorted(VALID_CODING_SOURCES)}"
                )

            med_dict = {
                "id": med_id,
                "patient_id": pat_id,
                "name": clean_name,
                "generic_name": generic,
                "order_code": odr_code or None,
                "nhi_code": (m.get("NHI_CODE") or "").strip() or None,
                "category": category,
                "san_category": _classify_san(his_atc),
                "dose": str(m["DOSE"]) if m.get("DOSE") is not None else None,
                "unit": m.get("DOSE_UNIT"),
                "frequency": _FREQ_MAP.get(freq_code, freq_code.lower() if freq_code else None),
                "route": _ROUTE_MAP.get(route_code, route_code if route_code else None),
                "prn": is_prn,
                "indication": None,
                "start_date": _roc_to_date(m.get("START_DATE")),
                "end_date": _roc_to_date(m.get("END_DATE")),
                "status": status,
                "prescribed_by": {"name": m["USER_NAME"]} if m.get("USER_NAME") else None,
                "warnings": [],
                "concentration": None,
                "concentration_unit": None,
                "notes": m.get("NOTES"),
                "source_type": source_type,
                "source_campus": m.get("_source_factory"),
                "prescribing_hospital": None,
                "prescribing_department": m.get("HDEPT_NAME"),
                "prescribing_doctor_name": m.get("USER_NAME"),
                "days_supply": int(m["DAYS"]) if m.get("DAYS") else None,
                "is_external": False,
                # PR-1: standardized codes
                "atc_code": atc_code,
                "is_antibiotic": is_antibiotic,
                "kidney_relevant": kidney_relevant,
                "coding_source": coding_source,
                # Preserve every HIS field verbatim for audit/replay.  The
                # normalized columns above remain the API's stable contract.
                "source_details": dict(m),
            }
            medications.append(med_dict)

        return medications

    # ------------------------------------------------------------------ #
    # Lab Data
    # ------------------------------------------------------------------ #

    def convert_lab_data(self) -> List[Dict[str, Any]]:
        """getLabResult.json → list of lab_data table dicts.

        Groups lab results by REPORT_DATE+REPORT_TIME (= one lab draw),
        then maps each LAB_CODE to the appropriate JSONB category and key.
        Uses _load_all() to include labs from secondary campuses.
        """
        rows = self._load_all("getLabResult.json")
        patient = self.convert_patient()
        if not patient or not rows:
            return []
        pat_id = patient["id"]

        # A timestamp alone is not a report identity: different sheets/campuses
        # can report simultaneously and contain the same analyte key.
        grouped: Dict[Tuple[str, str, str, str], List[dict]] = defaultdict(list)
        for r in rows:
            group_key = (
                str(r.get("REPORT_DATE") or ""),
                str(r.get("REPORT_TIME") or ""),
                str(r.get("_source_factory") or "MAIN"),
                str(r.get("SHEET_NO") or ""),
            )
            grouped[group_key].append(r)

        lab_records = []
        for group_key, items in sorted(grouped.items()):
            report_date, report_time, source_campus, sheet_no = group_key
            timestamp = _roc_to_datetime(report_date, report_time or None)
            if not timestamp:
                continue

            lab_id = _gen_id("lab", self.pat_no, *group_key)

            # Initialize all JSONB categories
            categories: Dict[str, Dict] = {
                "biochemistry": {}, "hematology": {}, "blood_gas": {},
                "venous_blood_gas": {}, "inflammatory": {}, "coagulation": {},
                "cardiac": {}, "thyroid": {}, "hormone": {}, "lipid": {},
                "other": {},
            }

            for item in items:
                lab_code = item.get("LAB_CODE", "")
                mapping = HIS_LAB_MAP.get(lab_code)

                if not mapping:
                    # Unmapped code → put in 'other'
                    cat = "other"
                    key = lab_code or item.get("LAB_NAME", "unknown")
                else:
                    cat, key, _ = mapping

                # Culture/AST have their own table. Other textual tests stay in
                # lab_data so the source record is not silently lost.
                if cat in ("culture", "susceptibility"):
                    continue

                # Map to parent category if not in our JSONB columns
                if cat in ("glycated",):
                    cat = "other"  # frontend expects HbA1C in "other"
                elif cat in ("serology", "tumor_marker", "allergy", "tdm",
                             "molecular", "rapid_antigen", "gram_stain"):
                    prefix = {
                        "molecular": "PCR_",
                        "rapid_antigen": "AG_",
                        "gram_stain": "GRAM_",
                    }.get(cat, "")
                    key = prefix + key
                    cat = "other"
                elif cat in ("urinalysis", "stool", "pleural_fluid"):
                    # Prefix key to avoid collision with blood-based items
                    # (e.g., urinalysis Glucose vs biochemistry Glucose)
                    _PREFIX = {"urinalysis": "U_", "stool": "ST_", "pleural_fluid": "PF_"}
                    key = _PREFIX[cat] + key
                    cat = "other"

                if cat not in categories:
                    categories[cat] = {}

                # Parse value
                result_str = item.get("RESULT", "")
                try:
                    value = float(result_str)
                except (ValueError, TypeError):
                    # Non-numeric result (e.g., "ORANGE", "+/-") → store as string
                    value = result_str

                # Reference range
                low = item.get("LOW_LIMIT")
                high = item.get("HIGH_LIMIT")
                ref_range = ""
                if low is not None and high is not None:
                    ref_range = f"{low}-{high}"
                elif low is not None:
                    ref_range = f"≥{low}"
                elif high is not None:
                    ref_range = f"≤{high}"

                # Abnormal flag
                res_sw = (item.get("RES_SW") or "").strip().upper()
                is_abnormal = res_sw in ("H", "HH", "L", "LL", "A", "X")

                categories[cat][key] = {
                    "value": value,
                    "unit": item.get("UNIT", ""),
                    "referenceRange": ref_range,
                    "isAbnormal": is_abnormal,
                    "code": lab_code,
                    "name": item.get("LAB_NAME") or (mapping[2] if mapping else key),
                    "specimen": item.get("ITEM_NAME"),
                    "comment": item.get("RES_COMMENT"),
                    "sourceCampus": source_campus,
                    "sheetNumber": sheet_no,
                    "source": dict(item),
                }

            # A sheet containing only culture/AST rows belongs exclusively in
            # culture_results; do not create an empty lab_data orphan.
            if not any(categories.values()):
                continue

            # Remove empty categories
            lab_dict: Dict[str, Any] = {
                "id": lab_id,
                "patient_id": pat_id,
                "timestamp": timestamp,
            }
            for cat, data in categories.items():
                lab_dict[cat] = data if data else None

            lab_records.append(lab_dict)

        return lab_records

    # ------------------------------------------------------------------ #
    # Culture Results
    # ------------------------------------------------------------------ #

    def convert_culture_results(self) -> List[Dict[str, Any]]:
        """getLabResult.json (culture/susceptibility items) → culture_results dicts."""
        rows = self._load_all("getLabResult.json")
        patient = self.convert_patient()
        if not patient or not rows:
            return []
        pat_id = patient["id"]

        # SHEET_NO is only unique within a campus.
        culture_groups: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
        for r in rows:
            lab_code = r.get("LAB_CODE", "")
            mapping = HIS_LAB_MAP.get(lab_code)
            if not mapping:
                continue
            cat = mapping[0]
            if cat in ("culture", "susceptibility", "gram_stain"):
                source_campus = str(r.get("_source_factory") or "MAIN")
                sheet_no = str(r.get("SHEET_NO") or "unknown")
                culture_groups[(source_campus, sheet_no)].append(r)

        results = []
        for (source_campus, sheet_no), items in culture_groups.items():
            first = items[0]
            cul_id = (
                _gen_id("cul", self.pat_no, sheet_no)
                if source_campus == "MAIN"
                else _gen_id("cul", self.pat_no, sheet_no, source_campus)
            )

            # First pass: collect metadata, colonies, isolates
            isolate_map: Dict[str, dict] = {}  # _Isolate1 → {organism, code, colonies}
            colonies_map: Dict[str, str] = {}  # _Colonies1 → value
            susceptibility = []
            mic_by_key: Dict[str, str] = {}
            q_score = None
            result_text = None
            alerts: List[str] = []
            aerobic_result = None
            anaerobic_result = None
            sample_type = None

            for item in items:
                mapping = HIS_LAB_MAP.get(item.get("LAB_CODE", ""))
                if not mapping:
                    continue
                cat, key, name = mapping
                lab_code = item.get("LAB_CODE", "")
                result_val = item.get("RESULT", "")

                if cat == "culture":
                    if key in ("_Isolate1", "_Isolate2", "_Isolate3"):
                        if result_val and result_val.strip():
                            isolate_map[key] = {
                                "code": lab_code,
                                "organism": result_val.strip(),
                            }
                    elif key in ("_Colonies1", "_Colonies2", "_Colonies3"):
                        if result_val and result_val.strip():
                            colonies_map[key] = result_val.strip().lstrip(":")
                    elif key == "_QScore":
                        try:
                            q_score = int(result_val)
                        except (ValueError, TypeError):
                            pass
                    elif key == "_Result":
                        if result_val and result_val.strip():
                            result_text = result_val.strip()
                    elif key == "_AerobicResult":
                        if result_val and result_val.strip():
                            aerobic_result = result_val.strip()
                    elif key == "_AnaerobicResult":
                        if result_val and result_val.strip():
                            anaerobic_result = result_val.strip()
                    elif key == "_SampleType":
                        if result_val and result_val.strip():
                            sample_type = result_val.strip()
                    elif key in ("_Comment", "_Comment2") and result_val:
                        val = result_val.strip()
                        if val and ("抗藥" in val or "MDR" in val or "Carbapenem" in val or "危急" in val):
                            alerts.append(val)
                    elif key == "_CriticalAlert" and result_val and result_val.strip():
                        alerts.append(result_val.strip())

                elif cat == "susceptibility" and result_val and result_val.strip():
                    if key.endswith("_MIC"):
                        mic_by_key[key.removesuffix("_MIC")] = result_val.strip()
                    else:
                        susceptibility.append({
                            "antibiotic": name,
                            "code": lab_code,
                            "result": result_val.strip(),  # S, I, R
                            "_key": key,
                        })

            for entry in susceptibility:
                entry["mic"] = mic_by_key.pop(entry.pop("_key"), None)

            # Pair isolates with colonies: _Isolate1↔_Colonies1, etc.
            isolates = []
            for iso_key in ("_Isolate1", "_Isolate2", "_Isolate3"):
                if iso_key not in isolate_map:
                    continue
                iso = isolate_map[iso_key]
                col_key = iso_key.replace("_Isolate", "_Colonies")
                colonies_val = colonies_map.get(col_key, "")
                isolates.append({
                    "code": iso["code"],
                    "organism": iso["organism"],
                    "colonies": colonies_val,
                })

            # For blood cultures with both aerobic+anaerobic negative, synthesize result
            if result_text is None and aerobic_result and anaerobic_result:
                if aerobic_result == "Negative" and anaerobic_result == "Negative":
                    result_text = "No growth to date"

            collected_times = [
                dt for item in items
                if (dt := _roc_to_datetime(item.get("SIGN_DATE"), item.get("SIGN_TIME")))
            ]
            reported_times = [
                dt for item in items
                if (dt := _roc_to_datetime(item.get("REPORT_DATE"), item.get("REPORT_TIME")))
            ]

            results.append({
                "id": cul_id,
                "patient_id": pat_id,
                "sheet_number": sheet_no,
                "specimen": sample_type or first.get("ITEM_NAME", ""),
                "specimen_code": first.get("ITEM_CODE", ""),
                "department": first.get("HDEPT_NAME", ""),
                "collected_at": min(collected_times) if collected_times else None,
                "reported_at": max(reported_times) if reported_times else None,
                "isolates": isolates,
                "susceptibility": susceptibility,
                "q_score": q_score,
                "result": result_text,
                "source_campus": source_campus,
                "source_details": {
                    "items": [dict(item) for item in items],
                    "alerts": alerts,
                    "aerobic_result": aerobic_result,
                    "anaerobic_result": anaerobic_result,
                    "unpaired_mic": mic_by_key,
                },
            })

        return results

    # ------------------------------------------------------------------ #
    # Diagnostic Reports
    # ------------------------------------------------------------------ #

    def convert_diagnostic_reports(self) -> List[Dict[str, Any]]:
        """No-op: getAllOrder contains orders, not completed diagnostic reports."""
        return []

    # ------------------------------------------------------------------ #
    # Surgery Reports
    # ------------------------------------------------------------------ #

    def convert_surgery(self) -> List[Dict[str, Any]]:
        """getSurgery.json → diagnostic_reports dicts."""
        rows = self._load_all("getSurgery.json")
        patient = self.convert_patient()
        if not patient or not rows:
            return []
        pat_id = patient["id"]

        reports = []
        for rec in rows:
            report_id = _gen_id(
                "diag", self.pat_no, "surg",
                rec.get("_source_factory", "MAIN"),
                rec.get("OP_ODR_CODE1", ""), rec.get("IN_OR_DATE", ""),
            )
            reports.append({
                "id": report_id,
                "patient_id": pat_id,
                "report_type": "procedure",
                "exam_name": rec.get("ODR_NAME", "手術"),
                "exam_date": _roc_to_datetime(rec.get("IN_OR_DATE")),
                "body_text": rec.get("CONTENT_TEXT", "") or "",
                "impression": None,
                "reporter_name": rec.get("DR_NAME"),
                "status": "final",
            })
        return reports

    # ------------------------------------------------------------------ #
    # ECG AI Results
    # ------------------------------------------------------------------ #

    def convert_ai_results(self) -> List[Dict[str, Any]]:
        """getAIResult.json → diagnostic_reports dicts (ECG AI interpretation)."""
        rows = self._load_all("getAIResult.json")
        patient = self.convert_patient()
        if not patient or not rows:
            return []
        pat_id = patient["id"]

        reports = []
        for rec in rows:
            report_id = _gen_id(
                "diag", self.pat_no, "ecgai",
                rec.get("_source_factory", "MAIN"),
                rec.get("SHEET_NO", ""), rec.get("SHEET_ITEM_SEQ", ""),
            )

            # Parse REPORT_CONTENT JSON string
            content_raw = rec.get("REPORT_CONTENT", "{}")
            try:
                content = json.loads(content_raw) if isinstance(content_raw, str) else content_raw
            except (json.JSONDecodeError, TypeError):
                content = {}

            impression = _build_ecg_impression(content)

            reports.append({
                "id": report_id,
                "patient_id": pat_id,
                "report_type": "ecg_ai",
                "exam_name": "ECG AI Interpretation",
                "exam_date": _roc_to_datetime(rec.get("REPORT_DATE"), rec.get("REPORT_TIME")),
                "body_text": json.dumps(content, ensure_ascii=False) if content else "",
                "impression": impression,
                "reporter_name": "AI System",
                "status": "final",
            })
        return reports

    # ------------------------------------------------------------------ #
    # Vital signs (getTPR)
    # ------------------------------------------------------------------ #

    def convert_vital_signs(self) -> List[Dict[str, Any]]:
        """getTPR_AllPatientSeq → vital_signs rows (hourly TPR + BP time series).

        HIS provides temperature / pulse / respiration / BP only — SpO2 and the
        invasive pressures (etco2/cvp/icp/cpp) stay manual, so those columns are
        left unset. Each row gets a deterministic id (patient + timestamp) so
        re-syncs upsert in place and manually-entered vital rows (uuid ids) are
        never touched. Rows with no numeric measurement at all are skipped.
        """
        pat_id = _gen_id("pat", self.pat_no)
        # Keyed by id (patient + timestamp): HIS repeats the identical reading
        # several times per timestamp, so one row per timestamp is correct.
        rows: Dict[str, Dict[str, Any]] = {}
        for r in self._load_seq("getTPR"):
            ts = _roc_to_datetime(r.get("CREATEDATE"), r.get("CREATETIME"))
            if ts is None:
                continue
            hr = _to_int(r.get("PULSE"))
            sbp = _to_int(r.get("SYSTOLICBP"))
            dbp = _to_int(r.get("DIASTOLICBP"))
            rr = _to_int(r.get("RESPIRATIONRATE"))
            temp = _to_float(r.get("TEMPERATURE"))
            if hr is None and sbp is None and dbp is None and rr is None and temp is None:
                continue
            mean_bp = round((sbp + 2 * dbp) / 3, 1) if sbp is not None and dbp is not None else None
            vid = _gen_id("vit", self.pat_no, r.get("CREATEDATE") or "", r.get("CREATETIME") or "")
            rows[vid] = {
                "id": vid,
                "patient_id": pat_id,
                "timestamp": ts,
                "heart_rate": hr,
                "systolic_bp": sbp,
                "diastolic_bp": dbp,
                "mean_bp": mean_bp,
                "respiratory_rate": rr,
                "temperature": temp,
            }
        return list(rows.values())

    def convert_clinical_scores(self) -> List[Dict[str, Any]]:
        """sbPain → immutable pain-score rows with deterministic HIS ids."""
        pat_id = _gen_id("pat", self.pat_no)
        rows: Dict[str, Dict[str, Any]] = {}
        for record in self._load_sb("sbPain"):
            value = _to_int(record.get("PAIN_NUMBER"))
            timestamp = _roc_to_datetime(
                record.get("CREATE_DATE"), record.get("CREATE_TIME")
            )
            if value is None or not 0 <= value <= 10 or timestamp is None:
                continue
            score_id = _gen_id(
                "score",
                self.pat_no,
                "pain",
                record.get("CREATE_DATE") or "",
                record.get("CREATE_TIME") or "",
            )
            rows[score_id] = {
                "id": score_id,
                "patient_id": pat_id,
                "score_type": "pain",
                "value": value,
                "timestamp": timestamp,
                "recorded_by": "HIS",
                "notes": "sbPain",
            }
        return list(rows.values())

    # ------------------------------------------------------------------ #
    # Enrichment: derive fields from converted data
    # ------------------------------------------------------------------ #

    @staticmethod
    def _derive_san(medications: List[Dict]) -> Tuple[list, list, list]:
        """Aggregate active SAN medications → (sedation, analgesia, nmb) name lists."""
        sedation = []
        analgesia = []
        nmb = []
        for m in medications:
            if m.get("status") != "active" or not m.get("san_category"):
                continue
            label = m.get("generic_name") or m.get("name", "")
            if m["san_category"] == "S" and label not in sedation:
                sedation.append(label)
            elif m["san_category"] == "A" and label not in analgesia:
                analgesia.append(label)
            elif m["san_category"] == "N" and label not in nmb:
                nmb.append(label)
        return sedation, analgesia, nmb

    @staticmethod
    def _derive_ventilator_days(all_orders: list) -> int:
        """Sum TOTAL_QTY from D3 (ventilator) orders."""
        total = 0
        for o in all_orders:
            if str(o.get("MAJOR_CLASS", "")).strip() == "D3":
                try:
                    total += int(float(o.get("TOTAL_QTY", 0)))
                except (ValueError, TypeError):
                    pass
        return total

    def _parse_dnr_consent(self) -> Tuple[Optional[str], list]:
        """Parse DNR_CONSENT bitmask → (consent_status, alert_strings).

        Format: 院區,簽署日期,員編,YYYMMDDHHMMSS,不實施項目代碼
        Items: 1=氣管內插管 2=體外心臟按壓 3=急救藥物注射 4=心臟電擊
               5=心臟人工調頻 6=人工呼吸 7=其他
        """
        rows = self._load("getPatient.json")
        if not rows:
            return None, []
        p = rows[0]
        raw = p.get("DNR_CONSENT")
        if not raw or not raw.strip():
            if p.get("DNR_IC_FLAG"):
                return "DNR signed", ["DNR: 已簽署意願書"]
            return None, []

        parts = raw.strip().split(",")
        items_code = parts[4] if len(parts) >= 5 else ""
        _DNR_ITEMS = {
            "1": "氣管內插管", "2": "體外心臟按壓", "3": "急救藥物注射",
            "4": "心臟電擊", "5": "心臟人工調頻", "6": "人工呼吸", "7": "其他",
        }
        refused = [_DNR_ITEMS[c] for c in items_code if c in _DNR_ITEMS]
        sign_date = _roc_to_date(parts[1]) if len(parts) >= 2 else None

        alert_parts = ["DNR: 不實施 " + "、".join(refused)] if refused else ["DNR signed"]
        if sign_date:
            alert_parts[0] += f" (簽署 {sign_date.isoformat()})"

        return "DNR signed", alert_parts

    # ------------------------------------------------------------------ #
    # Master convert
    # ------------------------------------------------------------------ #

    def convert_all(self) -> Dict[str, Any]:
        """Convert all data and return a summary dict."""
        patient = self.convert_patient()
        if not patient:
            return {"error": f"No patient data found in {self.patient_dir}"}

        medications = self.convert_medications()
        lab_data = self.convert_lab_data()
        cultures = self.convert_culture_results()
        reports = self.convert_diagnostic_reports()
        surgery_reports = self.convert_surgery()
        ai_reports = self.convert_ai_results()
        vital_signs = self.convert_vital_signs()
        clinical_scores = self.convert_clinical_scores()

        # Merge all diagnostic reports
        all_reports = reports + surgery_reports + ai_reports

        # --- Enrich patient from derived data ---
        # Step 2: SAN auto-derive
        sedation, analgesia, nmb = self._derive_san(medications)
        patient["sedation"] = sedation
        patient["analgesia"] = analgesia
        patient["nmb"] = nmb

        # Step 4: DNR consent
        consent_status, dnr_alerts = self._parse_dnr_consent()
        if consent_status:
            patient["consent_status"] = consent_status
        if dnr_alerts:
            patient["alerts"] = list(set((patient.get("alerts") or []) + dnr_alerts))

        # Step 6: Ventilator days from D3 orders
        all_orders = self._load("getAllOrder.json")
        patient["ventilator_days"] = self._derive_ventilator_days(all_orders)

        # Allergies must come from a structured source field. SOAP text such as
        # "allergy: denied" is not an allergy substance.
        patient["allergies"] = self._extract_food_allergy()
        patient["allergies_from_his"] = bool(patient["allergies"])

        return {
            "patient": patient,
            "medications": medications,
            "lab_data": lab_data,
            "culture_results": cultures,
            "diagnostic_reports": all_reports,
            "vital_signs": vital_signs,
            "clinical_scores": clinical_scores,
            "summary": {
                "patient_name": patient["name"],
                "medical_record_number": patient["medical_record_number"],
                "medications_count": len(medications),
                "lab_records_count": len(lab_data),
                "lab_items_total": sum(
                    sum(len(v) for v in rec.values() if isinstance(v, dict))
                    for rec in lab_data
                ),
                "culture_results_count": len(cultures),
                "diagnostic_reports_count": len(all_reports),
                "vital_signs_count": len(vital_signs),
                "clinical_scores_count": len(clinical_scores),
                "surgery_reports_count": len(surgery_reports),
                "ecg_ai_reports_count": len(ai_reports),
                "sedation_drugs": sedation,
                "analgesia_drugs": analgesia,
                "nmb_drugs": nmb,
                "ventilator_days": patient["ventilator_days"],
                "consent_status": patient["consent_status"],
            },
        }
