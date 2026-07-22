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

from app.fhir.allergy_parser import parse_allergy_texts
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
    _DDI_ALIAS_MAP,
    _DDI_EXCLUSION_SET,
    _FORMULARY_MAP,
    _SITE_CONFIG,
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

        # Archived (deceased)
        archived = bool(p.get("DEAD_DATE"))

        # Diagnosis from getOpd ICD codes
        diagnosis = self._extract_diagnosis()

        # Department and attending physician from getOpd
        dept, doctor = self._extract_dept_doctor()

        # Admission date from getIPD or earliest order
        admission_date, icu_admission_date = self._extract_admission_dates()

        # SMARTBED-derived vitals-adjacent fields (2026-07-21 nested snapshot):
        # bed from the in-bed roster, anthropometrics from nutrition assessment,
        # airway status from the tube list. All emitted as real values so the
        # PRESERVE_EXISTING merge overwrites when HIS has data and keeps the
        # manual value when it does not (see snapshot_sync._is_meaningful).
        bed_number = self._extract_bed_number()
        height, weight, bmi = self._extract_anthropometrics()
        intubated, tracheostomy, tracheostomy_date = self._extract_airway()

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
            "blood_type": blood_type,
            "code_status": code_status,
            "has_dnr": has_dnr,
            "is_isolated": False,
            "archived": archived,
            "campus": None,
            "last_update": None,
        }

    def _extract_diagnosis(self) -> Optional[str]:
        """Extract admission diagnosis from getIPD.json ICD codes.

        getIPD.json contains the true inpatient admission diagnosis with
        ICD codes that already include Chinese descriptions (e.g.
        "A41.9敗血症，未明示病原體").  Falls back to getOpd.json OPD_SW=1
        records only when getIPD.json is unavailable.
        """
        # Primary: getIPD.json — real admission diagnosis.
        # Use the most recent admission row (last in file order).
        ipd_rows = self._load("getIPD.json")
        if ipd_rows:
            chosen = ipd_rows[-1]
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

    # ICU internal medicine attendings — loaded from his_site_config.json.
    # To add/remove doctors, edit that file and re-run import_his_patients.py.
    _ICU_INTERNAL_MED_DOCTORS: set = set(
        _SITE_CONFIG.get("icu_internal_medicine_doctors", ["黃英哲", "李穎灝"])
    )

    def _extract_dept_doctor(self) -> Tuple[Optional[str], Optional[str]]:
        """Extract department and ICU attending physician.

        Logic:
          1. Determine if patient is surgical or internal medicine.
             - Surgical: the primary ICU prescriber also appears as surgeon
               in getSurgery.json.
             - Internal medicine: all other cases.
          2. Surgical → use the surgeon as attending + their dept.
          3. Internal medicine → attending must be 黃英哲 or 李穎灝;
             pick whichever has more OPD_SW='I' medication orders.
          4. Fallback: getIPD.json DR_NAME, then getOpd.json DR_NAME.
        """
        from collections import Counter

        med_rows = self._load("getAllMedicine.json")
        icu_meds = [r for r in med_rows if str(r.get("OPD_SW", "")) == "I"] if med_rows else []

        if icu_meds:
            user_counter = Counter(
                r.get("USER_NAME", "") for r in icu_meds if r.get("USER_NAME")
            )

            # Collect all doctors who have performed surgeries on this patient.
            surg_rows = self._load("getSurgery.json")
            surgery_doctors = {r.get("DR_NAME") for r in surg_rows if r.get("DR_NAME")} if surg_rows else set()

            top_doctor = user_counter.most_common(1)[0][0]
            is_surgical = top_doctor in surgery_doctors

            if is_surgical:
                # Surgical patient: attending is the surgeon
                attending = top_doctor
            else:
                # Internal medicine patient: attending must be one of the two
                # ICU internal medicine doctors
                im_counter = Counter(
                    r.get("USER_NAME", "")
                    for r in icu_meds
                    if r.get("USER_NAME") in self._ICU_INTERNAL_MED_DOCTORS
                )
                if im_counter:
                    attending = im_counter.most_common(1)[0][0]
                else:
                    # No ICU internal med doctor found — fall back to top prescriber
                    attending = top_doctor

            dept_counter = Counter(
                r.get("HDEPT_NAME", "")
                for r in icu_meds
                if r.get("USER_NAME") == attending and r.get("HDEPT_NAME")
            )
            dept = dept_counter.most_common(1)[0][0] if dept_counter else None
            return dept, attending

        # Fallback 1: getIPD.json — direct inpatient attending record
        ipd_rows = self._load("getIPD.json")
        if ipd_rows:
            r = ipd_rows[0]
            if r.get("DR_NAME"):
                return r.get("HDEPT_NAME"), r.get("DR_NAME")

        # Fallback 2: getOpd.json inpatient record (emergency admission doctor)
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
        """Extract admission dates from getIPD or earliest medicine order."""
        ipd_rows = self._load("getIPD.json")
        if ipd_rows:
            ipd = ipd_rows[-1]  # most recent admission
            admission = _roc_to_date(ipd.get("IPD_DATE"))
            return admission, admission  # ICU admission ≈ admission for ICU patients

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
    ) -> Tuple[bool, bool, Optional[date]]:
        """(intubated, tracheostomy, tracheostomy_date) from sbTube PIPE_ALIASES.

        ``Endo*`` = endotracheal tube (intubated), ``Tr*`` = tracheostomy. Only
        a present-in-place tube counts — one whose END_DATE is unset or not yet
        past the snapshot date (a removed line keeps its historical row).
        """
        intubated = tracheostomy = False
        trach_date: Optional[date] = None
        today = date.today()
        for tube in self._load_sb("sbTube"):
            alias = str(tube.get("PIPE_ALIASES") or "")
            end = _roc_to_date(tube.get("END_DATE"))
            if end is not None and end < today:
                continue  # already removed
            if alias.startswith("Endo"):
                intubated = True
            elif alias.startswith("Tr"):
                tracheostomy = True
                put = _roc_to_date(tube.get("PUT_DATE"))
                if put and (trach_date is None or put < trach_date):
                    trach_date = put
        return intubated, tracheostomy, trach_date

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
        """getAllMedicine.json → list of medications table dicts.

        Uses _load_all() so medications from secondary campuses (ExtraFactories)
        are merged with the primary campus. Without this, cross-campus
        outpatient Rx (e.g. 70117162's 10 emergency-department meds at
        Factory_F) are silently dropped.
        """
        rows = self._load_all("getAllMedicine.json")
        patient = self.convert_patient()
        if not patient:
            return []
        pat_id = patient["id"]

        medications = []
        for m in rows:
            raw_name = m.get("ODR_NAME", "")
            clean_name, rule_generic = _clean_drug_name(raw_name)
            odr_code = (m.get("ODR_CODE") or "").strip()

            # generic_name precedence (name = clean_name stays trade+strength):
            #  1. _DDI_ALIAS_MAP — curated DDI vocabulary (class names + Lexicomp
            #     tall-man spellings); load-bearing for class-level DDI matching.
            #  2. _DDI_EXCLUSION_SET — IV fluids / non-drugs → None (suppress noise).
            #  3. HIS DRUG_NAME — clean ingredient name (Quetiapine, not brand
            #     "Seroquel"); commas (combos) → " / " so ddi_check can expand them.
            #  4. rule-derived first word — only when HIS ships no DRUG_NAME.
            if odr_code and odr_code in _DDI_ALIAS_MAP:
                generic = " / ".join(_DDI_ALIAS_MAP[odr_code])
            elif odr_code and odr_code in _DDI_EXCLUSION_SET:
                generic = None
            else:
                # HIS DRUG_NAME → clean generic; combos (,;+/) split to " / " with
                # strengths/forms stripped so DDI name matching (medications.py:181,
                # split on " / ") can expand each ingredient. Falls back to the
                # rule-derived first word only when HIS ships no DRUG_NAME.
                generic = _combo_generic_from_his(m.get("DRUG_NAME") or "") or rule_generic

            freq_code = (m.get("FREQ_CODE") or "").strip().upper()
            route_code = (m.get("ROUTE_CODE") or "").strip().upper()

            # Determine PRN
            is_prn = "PRN" in freq_code

            # Source type (self-supplied detection is done at API layer)
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

            # Enrich with standardized ATC code from hospital formulary (PR-1)
            formulary_entry = _FORMULARY_MAP.get(odr_code) if odr_code else None
            if formulary_entry:
                atc_code = formulary_entry["atc_code"]
                is_antibiotic = formulary_entry["is_antibiotic"]
                kidney_relevant = formulary_entry["kidney_relevant"]
                coding_source = formulary_entry["source"]
            else:
                # Formulary miss. GAP-FILL ONLY — the formulary branch above is
                # never overridden, so DDI Path-2 vocabulary alignment (migration
                # 065) and curated is_antibiotic/kidney_relevant are preserved for
                # the 94.5% of rows the formulary covers.
                atc_code = None
                is_antibiotic = False
                kidney_relevant = None
                coding_source = "unmapped" if odr_code else None

                # Prefer the HIS-supplied ATC_CODE (100% filled in current
                # snapshots) over the offline RxNorm cache.
                his_atc = (m.get("ATC_CODE") or "").strip() or None
                if his_atc:
                    atc_code = his_atc
                    coding_source = "his_atc"
                    # Re-derive is_antibiotic from ATC. Systemic antibacterials/
                    # antifungals/antimycobacterials sit under J01/J02/J04/J05;
                    # P01AB = nitroimidazoles (metronidazole/tinidazole); A07AA =
                    # oral non-absorbed antibacterials (vancomycin/neomycin/
                    # rifaximin/colistin). J06/J07 (vaccines/Ig) excluded.
                    is_antibiotic = his_atc[:3] in ("J01", "J02", "J04", "J05") or his_atc[:5] in ("P01AB", "A07AA")
                else:
                    # PR-2: cache-only RxNorm fallback (near-dead now HIS ATC=100%).
                    # Cache is prebuilt offline; production syncs never hit network.
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
                "category": _classify_category(raw_name),
                "san_category": _classify_san(raw_name, atc_code),
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
                "source_campus": None,
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

        # Group by report timestamp
        grouped: Dict[str, List[dict]] = defaultdict(list)
        for r in rows:
            ts_key = f"{r.get('REPORT_DATE', '')}_{r.get('REPORT_TIME', '')}"
            grouped[ts_key].append(r)

        lab_records = []
        for ts_key, items in sorted(grouped.items()):
            parts = ts_key.split("_")
            timestamp = _roc_to_datetime(parts[0], parts[1] if len(parts) > 1 else None)
            if not timestamp:
                continue

            lab_id = _gen_id("lab", self.pat_no, ts_key)

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

                # Skip non-numeric categories (culture, susceptibility, etc.)
                if cat in ("culture", "susceptibility", "gram_stain",
                           "molecular", "rapid_antigen"):
                    continue

                # Map to parent category if not in our JSONB columns
                if cat in ("glycated",):
                    cat = "other"  # frontend expects HbA1C in "other"
                elif cat in ("serology", "tumor_marker", "allergy", "tdm"):
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
                }

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

        # Group culture items by SHEET_NO
        culture_groups: Dict[str, List[dict]] = defaultdict(list)
        for r in rows:
            lab_code = r.get("LAB_CODE", "")
            mapping = HIS_LAB_MAP.get(lab_code)
            if not mapping:
                continue
            cat = mapping[0]
            if cat in ("culture", "susceptibility", "gram_stain"):
                sheet_no = r.get("SHEET_NO", "unknown")
                culture_groups[sheet_no].append(r)

        results = []
        for sheet_no, items in culture_groups.items():
            first = items[0]
            cul_id = _gen_id("cul", self.pat_no, sheet_no)

            # First pass: collect metadata, colonies, isolates
            isolate_map: Dict[str, dict] = {}  # _Isolate1 → {organism, code, colonies}
            colonies_map: Dict[str, str] = {}  # _Colonies1 → value
            susceptibility = []
            q_score = None
            result_text = None
            alerts: List[str] = []
            aerobic_result = None
            anaerobic_result = None

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
                    elif key in ("_Comment", "_Comment2") and result_val:
                        val = result_val.strip()
                        if val and ("抗藥" in val or "MDR" in val or "Carbapenem" in val or "危急" in val):
                            alerts.append(val)
                    elif key == "_CriticalAlert" and result_val and result_val.strip():
                        alerts.append(result_val.strip())

                elif cat == "susceptibility" and not key.endswith("_MIC"):
                    if result_val and result_val.strip():
                        susceptibility.append({
                            "antibiotic": name,
                            "code": lab_code,
                            "result": result_val.strip(),  # S, I, R
                        })

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

            # Note: alerts / aerobic_result / anaerobic_result are intentionally
            # NOT included in the output dict because the DB table has no columns
            # for them.  The import script dynamically maps dict keys → SQL columns,
            # so extra keys would cause a crash.  These values remain accessible in
            # the raw HIS JSON if needed in the future.

            results.append({
                "id": cul_id,
                "patient_id": pat_id,
                "sheet_number": sheet_no,
                "specimen": first.get("ITEM_NAME", ""),
                "specimen_code": first.get("ITEM_CODE", ""),
                "department": first.get("HDEPT_NAME", ""),
                "collected_at": _roc_to_datetime(first.get("SIGN_DATE"), first.get("SIGN_TIME")),
                "reported_at": _roc_to_datetime(first.get("REPORT_DATE"), first.get("REPORT_TIME")),
                "isolates": isolates,
                "susceptibility": susceptibility,
                "q_score": q_score,
                "result": result_text,
            })

        return results

    # ------------------------------------------------------------------ #
    # Diagnostic Reports (from getAllOrder imaging/procedure orders)
    # ------------------------------------------------------------------ #

    def convert_diagnostic_reports(self) -> List[Dict[str, Any]]:
        """getAllOrder.json → diagnostic_reports dicts (imaging/procedures only)."""
        rows = self._load_all("getAllOrder.json")
        patient = self.convert_patient()
        if not patient or not rows:
            return []
        pat_id = patient["id"]

        # Filter imaging/procedure orders
        # MAJOR_CLASS patterns: 20=lab, 22/23=imaging, 25/26=therapy
        imaging_classes = {"22", "23"}
        reports = []
        for order in rows:
            mc = str(order.get("MAJOR_CLASS", "")).strip()
            if mc not in imaging_classes:
                continue

            report_id = _gen_id("diag", self.pat_no, str(order.get("ODR_SEQ", "")),
                                order.get("PAT_SEQ", ""))
            reports.append({
                "id": report_id,
                "patient_id": pat_id,
                "report_type": "imaging",
                "exam_name": order.get("ODR_NAME", ""),
                "exam_date": _roc_to_datetime(order.get("START_DATE"), order.get("START_TIME")),
                "body_text": order.get("NOTES", "") or "",
                "impression": None,
                "reporter_name": order.get("USER_NAME"),
                "status": "final",
            })

        return reports

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
        for i, rec in enumerate(rows):
            report_id = _gen_id("diag", self.pat_no, "surg", str(i))
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
        for i, rec in enumerate(rows):
            report_id = _gen_id("diag", self.pat_no, "ecgai", str(i))

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
    # Allergy extraction from SOAP notes
    # ------------------------------------------------------------------ #

    def _extract_allergies(self) -> Dict[str, Any]:
        """Extract structured allergy data from the getSO SOAP narrative.

        Reads through the snapshot loader (flat ``getSO_AllPatientSeq.json`` or
        the same key inside ALL_MERGED.json), so both snapshot layouts work.

        Returns:
            {"status": "nka"|"has_allergies"|"unknown",
             "allergies": [{"substance": str, "reaction": str|None, ...}]}
        """
        texts = [
            item.get("SUBJECTIVE", "")
            for item in self._load_seq("getSO")
            if item.get("SUBJECTIVE")
        ]
        return parse_allergy_texts(texts)

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

        # Step 7: Allergies — SOAP-parsed substances (getSO) unioned with the
        # structured food-allergy field (sbDisease). Either source alone is
        # sparse; combining keeps whichever is present. Empty result leaves the
        # placeholder [] so the PRESERVE merge keeps any manual allergy list.
        allergies: List[str] = []
        allergy_result = self._extract_allergies()
        if allergy_result["status"] == "has_allergies":
            allergies.extend(a["substance"] for a in allergy_result["allergies"])
        for food in self._extract_food_allergy():
            if food not in allergies:
                allergies.append(food)
        if allergies:
            patient["allergies"] = allergies

        return {
            "patient": patient,
            "medications": medications,
            "lab_data": lab_data,
            "culture_results": cultures,
            "diagnostic_reports": all_reports,
            "vital_signs": vital_signs,
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
                "surgery_reports_count": len(surgery_reports),
                "ecg_ai_reports_count": len(ai_reports),
                "sedation_drugs": sedation,
                "analgesia_drugs": analgesia,
                "nmb_drugs": nmb,
                "ventilator_days": patient["ventilator_days"],
                "consent_status": patient["consent_status"],
            },
        }
