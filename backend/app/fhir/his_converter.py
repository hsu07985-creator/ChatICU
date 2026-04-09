"""HIS JSON → ChatICU DB dict converter.

Converts raw HIS API responses (getPatient, getAllMedicine, getLabResult, etc.)
into dicts that can be directly inserted into ChatICU database tables.

Usage:
    from app.fhir.his_converter import HISConverter

    converter = HISConverter(patient_dir="/path/to/patient/50045203")
    patient = converter.convert_patient()
    medications = converter.convert_medications()
    lab_records = converter.convert_lab_data()
"""

import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.fhir.his_lab_mapping import HIS_LAB_MAP


# ---------------------------------------------------------------------------
# Date/time helpers
# ---------------------------------------------------------------------------

def _roc_to_date(roc_str: Optional[str]) -> Optional[date]:
    """民國年字串 → date。支援格式：YYYMMDD (7碼) 或 YYMMDD (6碼)。

    Examples:
        "1150407" → 2026-04-07
        "0530405" → 1964-04-05
        "1140101" → 2025-01-01
    """
    if not roc_str or not roc_str.strip():
        return None
    s = roc_str.strip()
    # Remove any separators
    s = s.replace("/", "").replace("-", "")
    if not s.isdigit():
        return None
    if len(s) == 7:
        roc_year = int(s[:3])
        month = int(s[3:5])
        day = int(s[5:7])
    elif len(s) == 6:
        roc_year = int(s[:2])
        month = int(s[2:4])
        day = int(s[4:6])
    else:
        return None
    western_year = roc_year + 1911
    try:
        return date(western_year, month, day)
    except ValueError:
        return None


def _roc_to_datetime(roc_date: Optional[str], time_str: Optional[str] = None) -> Optional[datetime]:
    """民國年日期 + HHMM 時間 → datetime(UTC)。

    HIS timestamps are Taiwan local time (UTC+8).  We parse as local
    then convert to UTC for storage.
    """
    d = _roc_to_date(roc_date)
    if d is None:
        return None
    hour, minute = 0, 0
    if time_str and len(time_str) >= 4 and time_str[:4].isdigit():
        hour = int(time_str[:2])
        minute = int(time_str[2:4])
    _TW = timezone(timedelta(hours=8))
    try:
        return datetime(d.year, d.month, d.day, hour, minute, tzinfo=_TW).astimezone(timezone.utc)
    except ValueError:
        return datetime(d.year, d.month, d.day, tzinfo=_TW).astimezone(timezone.utc)


def _roc_birthday_to_age(birthday: Optional[str]) -> Optional[int]:
    """民國年生日 → 年齡。"""
    bd = _roc_to_date(birthday)
    if bd is None:
        return None
    today = date.today()
    age = today.year - bd.year
    if (today.month, today.day) < (bd.month, bd.day):
        age -= 1
    return max(0, min(age, 200))


def _gen_id(prefix: str, *parts: str) -> str:
    """Generate a deterministic short ID from parts."""
    raw = "|".join(str(p) for p in parts)
    h = hashlib.md5(raw.encode()).hexdigest()[:8]
    return f"{prefix}_{h}"


# ---------------------------------------------------------------------------
# Medicine helpers
# ---------------------------------------------------------------------------

_FREQ_MAP = {
    "STAT": "stat",
    "QD": "qd", "QDAM": "qd", "QDPM": "qd",
    "QDAC": "qd ac", "QDAC30M": "qd ac",
    "QDPC": "qd pc",
    "QDHS": "qd hs",
    "QN": "qn",
    "BID": "bid", "BIDAC30M": "bid ac", "BIDPC": "bid pc",
    "TID": "tid", "TIDAC": "tid ac", "TIDPC": "tid pc", "TIDWM": "tid",
    "QID": "qid", "QIDPC": "qid pc",
    "Q4H": "q4h", "Q4HPRN": "q4h",
    "Q6H": "q6h", "Q6HPRN": "q6h",
    "Q8H": "q8h", "Q8HPRN": "q8h",
    "Q12H": "q12h", "Q12HPRN": "q12h",
    "HS": "hs", "HSPRN": "hs",
    "PRN": "prn",
    "QOD": "qod", "QODHS": "qod hs",
    "Q3D": "q3d",
    "QW1": "qw",
    "QW": "qw",
    "QW4": "q4w",
    "BIW14": "biw",
    "QDAMAC": "qd ac",
    "Q1HPRN": "q1h prn",
    "AS ORDER": "as ordered",
}

_ROUTE_MAP = {
    "IV": "IV",
    "IVD": "IV infusion",
    "PO": "PO",
    "SC": "SC",
    "IM": "IM",
    "INHL": "INH",
    "RECT": "PR",
    "EXT": "EXT",
    "TOPI": "TOP",
    "OU": "EYE",
    "OS": "EYE",
    "IRRI": "IRRI",
    "LA": "LA",
    "LI": "LI",
}

_OPD_SW_MAP = {
    "I": "inpatient",
    "O": "outpatient",
    "0": "inpatient",
    "1": "inpatient",
}

# Drug name patterns for SAN classification
_SAN_PATTERNS = {
    "S": [
        "propofol", "midazolam", "dormicum", "lorazepam", "ativan",
        "dexmedetomidine", "precedex", "ketamine",
        "haloperidol", "haldol", "quetiapine", "seroquel",
    ],
    "A": [
        "morphine", "fentanyl", "meperidine", "demerol", "tramadol",
        "acetaminophen", "panadol", "ketorolac",
        "diclofenac", "voltaren", "nefopam", "acupan",
    ],
    "N": [
        "cisatracurium", "nimbex", "rocuronium", "esmeron",
        "atracurium", "vecuronium", "succinylcholine",
    ],
}


def _classify_san(drug_name: str) -> Optional[str]:
    """Classify drug into S/A/N category by name pattern."""
    lower = drug_name.lower()
    for cat, patterns in _SAN_PATTERNS.items():
        for p in patterns:
            if p in lower:
                return cat
    return None


def _classify_category(drug_name: str) -> Optional[str]:
    """Classify drug into therapeutic category by name."""
    lower = drug_name.lower()
    categories = {
        "antibiotic": ["vancomycin", "meropenem", "ceftriaxone", "cefazolin",
                       "piperacillin", "tazobactam", "levofloxacin", "ciprofloxacin",
                       "metronidazole", "ampicillin", "amoxicillin", "azithromycin",
                       "colistin", "linezolid", "teicoplanin", "ceftazidime",
                       "cefepime", "imipenem", "ertapenem", "doxycycline",
                       "fluconazole", "voriconazole", "caspofungin", "anidulafungin",
                       "acyclovir", "ganciclovir", "oseltamivir"],
        "vasopressor": ["norepinephrine", "levophed", "epinephrine", "vasopressin",
                        "dopamine", "dobutamine", "milrinone", "phenylephrine"],
        "sedative": ["propofol", "midazolam", "dormicum", "lorazepam", "ativan",
                     "dexmedetomidine", "precedex", "ketamine", "haloperidol"],
        "analgesic": ["morphine", "fentanyl", "meperidine", "tramadol",
                      "acetaminophen", "panadol", "ketorolac", "nefopam"],
        "anticoagulant": ["heparin", "enoxaparin", "warfarin", "rivaroxaban"],
        "ppi": ["pantoprazole", "omeprazole", "esomeprazole", "lansoprazole",
                "famotidine", "ranitidine"],
        "electrolyte": ["kcl", "potassium", "calcium gluconate", "magnesium",
                        "sodium bicarbonate", "nacl"],
        "diuretic": ["furosemide", "lasix", "spironolactone", "mannitol",
                     "bumetanide", "hydrochlorothiazide", "albumin"],
        "antiepileptic": ["levetiracetam", "keppra", "phenytoin", "valproic",
                          "carbamazepine", "lacosamide", "phenobarbital"],
        "antihypertensive": ["amlodipine", "nicardipine", "labetalol", "esmolol",
                             "nitroglycerin", "nitroprusside", "hydralazine"],
        "insulin": ["insulin", "novolin", "novorapid", "lantus", "humalog"],
        "steroid": ["methylprednisolone", "hydrocortisone", "dexamethasone",
                    "prednisolone", "prednisone", "fludrocortisone"],
        "bronchodilator": ["salbutamol", "ventolin", "ipratropium", "combivent",
                           "aminophylline", "theophylline"],
        "nmb": ["cisatracurium", "nimbex", "rocuronium", "vecuronium",
                "succinylcholine", "atracurium"],
    }
    for cat, patterns in categories.items():
        for p in patterns:
            if p in lower:
                return cat
    return None


def _clean_drug_name(raw_name: str) -> Tuple[str, Optional[str]]:
    """Clean HIS drug name, extract trade name and generic name.

    Input:  "Fentanyl【#】0.05mg/ml 10ml inj(管2)(總量以amp計)"
    Output: ("Fentanyl 0.05mg/ml 10ml inj", "Fentanyl")
    """
    # Remove control marks like 【#】, (管2), (總量以amp計)
    name = re.sub(r'【[^】]*】', ' ', raw_name)
    name = re.sub(r'\(管\d\)', '', name)
    name = re.sub(r'\(總量[^)]*\)', '', name)
    name = re.sub(r'\(自費\)', '', name)
    name = re.sub(r'\(健保\)', '', name)
    name = re.sub(r'\[注射劑\]', ' inj ', name)
    name = re.sub(r'\[錠劑\]', ' tab ', name)
    name = re.sub(r'\[膠囊\]', ' cap ', name)
    name = re.sub(r'\s+', ' ', name).strip()

    # Extract generic name (first word, typically English drug name)
    generic_match = re.match(r'^([A-Za-z][A-Za-z\-]+)', name)
    generic = generic_match.group(1) if generic_match else None

    return name, generic


# ---------------------------------------------------------------------------
# Lab grouping helper
# ---------------------------------------------------------------------------

# REP_TYPE_NAME → ChatICU lab_data JSONB category
_REP_TYPE_TO_CATEGORY = {
    "生化檢驗": "biochemistry",
    "血液檢驗": "hematology",
    "血液氣體": "blood_gas",
    "血液凝固檢驗": "coagulation",
    "內分泌檢驗": "thyroid",
    "醣化血色素": "glycated",
    "抗體免疫血清檢驗": "serology",
    "腫瘤標誌": "tumor_marker",
    "Random尿液檢驗": "urinalysis",
    "糞便檢驗": "stool",
    "抗原快速檢驗": "rapid_antigen",
    "細菌培養": "culture",
    "細菌染色": "gram_stain",
    "分生病毒檢驗": "molecular",
    "藥毒物檢驗": "tdm",
    "愛滋梅毒檢驗": "serology",
    "過敏檢驗": "allergy",
    "病毒細菌抗原抗體檢驗": "serology",
    "Pleural胸水": "pleural_fluid",
    "其他體液": "other",
}


# ---------------------------------------------------------------------------
# Main converter class
# ---------------------------------------------------------------------------

def _build_ecg_impression(content: dict) -> str:
    """Build a human-readable impression from ECG AI REPORT_CONTENT keys."""
    parts = []
    # Key cardiac metrics
    _KEYS = [
        ("heartrate", "HR", "bpm"),
        ("ECG-EF", "EF", "%"),
        ("ECG-K", "K", "mEq/L"),
        ("ECG-Hb", "Hb", "g/dL"),
        ("ECG-eGFR", "eGFR", "mL/min"),
        ("ECG-BNP", "BNP", "pg/mL"),
        ("PR", "PR", "ms"),
        ("QTc", "QTc", "ms"),
        ("QRS", "QRS", "ms"),
    ]
    for key, label, unit in _KEYS:
        item = content.get(key)
        if item and item.get("value"):
            parts.append(f"{label}={item['value']}{unit}")
    # Abnormal rhythm predictions (probability > 0.5)
    _RHYTHMS = [
        ("p. Afib", "Afib"), ("p. STEMI", "STEMI"), ("p. NSTEMI", "NSTEMI"),
        ("p. VT", "VT"), ("p. VF", "VF"), ("p. 1AVB", "1AVB"),
        ("p. 2AVB", "2AVB"), ("p. CAVB", "CAVB"),
        ("p. CLBBB", "CLBBB"), ("p. CRBBB", "CRBBB"),
    ]
    flagged = []
    for key, label in _RHYTHMS:
        item = content.get(key)
        if item and item.get("value"):
            try:
                prob = float(item["value"])
                # HIS values are already percentages (0-100), not 0-1
                if prob > 50:
                    flagged.append(f"{label}({prob:.1f}%)")
            except (ValueError, TypeError):
                pass
    if flagged:
        parts.append("Flagged: " + ", ".join(flagged))
    # Mortality
    for mkey, mlabel in [("Mortality_1m", "1m-mort"), ("Mortality_1y", "1y-mort")]:
        item = content.get(mkey)
        if item and item.get("value"):
            try:
                val = float(item["value"])
                # HIS values are already percentages (0-100)
                parts.append(f"{mlabel}={val:.1f}%")
            except (ValueError, TypeError):
                pass
    return "; ".join(parts) if parts else ""


class HISConverter:
    """Convert HIS JSON data for one patient → ChatICU DB dicts."""

    def __init__(self, patient_dir: str):
        self.patient_dir = patient_dir
        self.pat_no = os.path.basename(patient_dir)
        self._cache: Dict[str, Any] = {}

    def _load(self, filename: str) -> list:
        """Load a HIS JSON file, return Data array."""
        if filename in self._cache:
            return self._cache[filename]
        path = os.path.join(self.patient_dir, filename)
        if not os.path.exists(path):
            self._cache[filename] = []
            return []
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        result = data.get("Data", []) if isinstance(data, dict) else data
        if not isinstance(result, list):
            result = [result] if result else []
        self._cache[filename] = result
        return result

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

        return {
            "id": pat_id,
            "name": p.get("PAT_NAME", ""),
            "bed_number": "",  # HIS 無床號資料，需手動補
            "medical_record_number": self.pat_no,
            "age": age or 0,
            "gender": p.get("SEX", "M"),
            "height": None,
            "weight": None,
            "bmi": None,
            "diagnosis": diagnosis or "待確認",
            "symptoms": [],
            "intubated": False,
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
        """Extract primary diagnosis from getOpd ICD codes."""
        opd_rows = self._load("getOpd.json")
        if not opd_rows:
            return None
        # Use most recent visit
        latest = opd_rows[-1]
        icd_codes = []
        for i in range(1, 11):
            icd = latest.get(f"ICD_CODE{i}")
            if icd:
                icd_codes.append(icd)
        return "; ".join(icd_codes[:3]) if icd_codes else None

    def _extract_dept_doctor(self) -> Tuple[Optional[str], Optional[str]]:
        """Extract department and doctor from getOpd."""
        opd_rows = self._load("getOpd.json")
        if not opd_rows:
            return None, None
        latest = opd_rows[-1]
        return latest.get("HDEPT_NAME"), latest.get("DR_NAME")

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

    # ------------------------------------------------------------------ #
    # Medications
    # ------------------------------------------------------------------ #

    def convert_medications(self) -> List[Dict[str, Any]]:
        """getAllMedicine.json → list of medications table dicts."""
        rows = self._load("getAllMedicine.json")
        patient = self.convert_patient()
        if not patient:
            return []
        pat_id = patient["id"]

        medications = []
        for m in rows:
            raw_name = m.get("ODR_NAME", "")
            clean_name, generic = _clean_drug_name(raw_name)
            freq_code = (m.get("FREQ_CODE") or "").strip().upper()
            route_code = (m.get("ROUTE_CODE") or "").strip().upper()

            # Determine PRN
            is_prn = "PRN" in freq_code

            # Determine status
            dc_flag = m.get("DC_FLAG")
            if dc_flag == "Y" or m.get("END_DATE"):
                status = "discontinued"
            else:
                status = "active"

            # Source type
            opd_sw = m.get("OPD_SW", "I")
            source_type = _OPD_SW_MAP.get(opd_sw, "inpatient")

            med_id = _gen_id("med", self.pat_no, str(m.get("ODR_SEQ", "")),
                             m.get("PAT_SEQ", ""), m.get("ODR_CODE", ""))

            med_dict = {
                "id": med_id,
                "patient_id": pat_id,
                "name": clean_name,
                "generic_name": generic,
                "category": _classify_category(raw_name),
                "san_category": _classify_san(raw_name),
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
        """
        rows = self._load("getLabResult.json")
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
                is_abnormal = res_sw in ("H", "HH", "L", "LL", "A", "SP")

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
        rows = self._load("getLabResult.json")
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

            # Extract organism
            isolates = []
            susceptibility = []
            for item in items:
                mapping = HIS_LAB_MAP.get(item.get("LAB_CODE", ""))
                if not mapping:
                    continue
                cat, key, name = mapping
                result_val = item.get("RESULT", "")

                if cat == "culture" and key in ("_Isolate1", "_Isolate2", "_Isolate3"):
                    if result_val and result_val.strip():
                        isolates.append({
                            "organism": result_val.strip(),
                            "quantity": "",
                        })
                elif cat == "susceptibility" and not key.endswith("_MIC"):
                    if result_val and result_val.strip():
                        susceptibility.append({
                            "antibiotic": name,
                            "result": result_val.strip(),  # S, I, R
                        })

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
            })

        return results

    # ------------------------------------------------------------------ #
    # Diagnostic Reports (from getAllOrder imaging/procedure orders)
    # ------------------------------------------------------------------ #

    def convert_diagnostic_reports(self) -> List[Dict[str, Any]]:
        """getAllOrder.json → diagnostic_reports dicts (imaging/procedures only)."""
        rows = self._load("getAllOrder.json")
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
    # Summary / validation
    # ------------------------------------------------------------------ #

    # ------------------------------------------------------------------ #
    # Surgery Reports
    # ------------------------------------------------------------------ #

    def convert_surgery(self) -> List[Dict[str, Any]]:
        """getSurgery.json → diagnostic_reports dicts."""
        rows = self._load("getSurgery.json")
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
        rows = self._load("getAIResult.json")
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

        return {
            "patient": patient,
            "medications": medications,
            "lab_data": lab_data,
            "culture_results": cultures,
            "diagnostic_reports": all_reports,
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
                "surgery_reports_count": len(surgery_reports),
                "ecg_ai_reports_count": len(ai_reports),
                "sedation_drugs": sedation,
                "analgesia_drugs": analgesia,
                "nmb_drugs": nmb,
                "ventilator_days": patient["ventilator_days"],
                "consent_status": patient["consent_status"],
            },
        }
