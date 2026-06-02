"""Lab grouping helpers and ECG AI impression builder."""

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
