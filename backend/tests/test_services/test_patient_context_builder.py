"""Tests for patient_context_builder lab value extraction.

Regression: production `pat_a86cb503` returned only a lab timestamp with
no values because HIS import stores keys like `Scr`/`WBC`/`pH` wrapped in
`{"value": X, "unit": ...}`, but the extractor looked for flat lowercase
keys like `creatinine`/`wbc`/`ph`. These tests lock in the alias table
and value-unwrap behavior so both legacy flat seeds and HIS-imported rows
produce a real snapshot.
"""
from datetime import datetime, timezone

from app.services.patient_context_builder import (
    _fmt_data_freshness_section,
    _fmt_medication_safety_section,
    _fmt_renal_dosing_section,
    _get_lab_val,
    extract_snapshot_key_values,
)


class _FakeLab:
    """Lightweight stand-in for LabData ORM row (attributes only)."""

    def __init__(self, **kwargs):
        # Default all known categories to None so getattr(...) works for any name
        for name in (
            "biochemistry", "hematology", "blood_gas", "venous_blood_gas",
            "inflammatory", "coagulation", "cardiac", "thyroid",
            "hormone", "lipid", "other",
        ):
            setattr(self, name, None)
        for k, v in kwargs.items():
            setattr(self, k, v)


class _FakePatient:
    def __init__(self, **kwargs):
        defaults = dict(
            age=70,
            gender="M",
            weight=60,
            intubated=False,
            updated_at=datetime(2026, 5, 3, 0, 0, tzinfo=timezone.utc),
            last_update=None,
            created_at=None,
        )
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(self, k, v)


class _FakeMed:
    def __init__(self, **kwargs):
        defaults = dict(
            name="Acetaminophen",
            generic_name="Acetaminophen",
            kidney_relevant=False,
            updated_at=datetime(2026, 5, 3, 1, 0, tzinfo=timezone.utc),
            created_at=None,
        )
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(self, k, v)


class _FakeVital:
    def __init__(self, **kwargs):
        defaults = dict(
            timestamp=datetime(2026, 5, 3, 2, 0, tzinfo=timezone.utc),
            body_weight=None,
        )
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(self, k, v)


# ── _get_lab_val ──────────────────────────────────────────────────────────────


def test_get_lab_val_his_wrapped_format():
    """HIS wraps each value as {'value': X, 'unit': ...}; extractor unwraps it."""
    lab = _FakeLab(
        biochemistry={
            "Scr": {"value": 2.3, "unit": "mg/dL", "referenceRange": "0.7-1.3", "isAbnormal": True},
            "BUN": {"value": 45,  "unit": "mg/dL", "referenceRange": "8-20",    "isAbnormal": True},
            "K":   {"value": 4.1, "unit": "mEq/L", "referenceRange": "3.5-5.0", "isAbnormal": False},
            "Na":  {"value": 138, "unit": "mEq/L"},
            "ALT": {"value": 55,  "unit": "U/L"},
            "AST": {"value": 62,  "unit": "U/L"},
            "Alb": {"value": 2.8, "unit": "g/dL"},
            "eGFR": {"value": 29, "unit": "mL/min/1.73m²"},
        },
        hematology={
            "WBC": {"value": 15.2, "unit": "K/uL"},
            "Hb":  {"value": 9.8,  "unit": "g/dL"},
            "PLT": {"value": 180,  "unit": "K/uL"},
        },
        blood_gas={
            "pH":      {"value": 7.31},
            "PCO2":    {"value": 48},
            "PO2":     {"value": 72},
            "HCO3":    {"value": 19},
            "Lactate": {"value": 3.4},
        },
        inflammatory={
            "CRP": {"value": 120, "unit": "mg/L"},
            "PCT": {"value": 2.3, "unit": "ng/mL"},
        },
        coagulation={
            "INR":    {"value": 1.4},
            "aPTT":   {"value": 38},
            "DDimer": {"value": 1.2},
        },
    )

    # biochemistry
    assert _get_lab_val(lab, "biochemistry", "creatinine") == 2.3
    assert _get_lab_val(lab, "biochemistry", "bun") == 45.0
    assert _get_lab_val(lab, "biochemistry", "potassium") == 4.1
    assert _get_lab_val(lab, "biochemistry", "sodium") == 138.0
    assert _get_lab_val(lab, "biochemistry", "alt") == 55.0
    assert _get_lab_val(lab, "biochemistry", "ast") == 62.0
    assert _get_lab_val(lab, "biochemistry", "albumin") == 2.8
    assert _get_lab_val(lab, "biochemistry", "egfr") == 29.0

    # hematology
    assert _get_lab_val(lab, "hematology", "wbc") == 15.2
    assert _get_lab_val(lab, "hematology", "hemoglobin") == 9.8
    assert _get_lab_val(lab, "hematology", "platelet") == 180.0

    # blood_gas
    assert _get_lab_val(lab, "blood_gas", "ph") == 7.31
    assert _get_lab_val(lab, "blood_gas", "pco2") == 48.0
    assert _get_lab_val(lab, "blood_gas", "po2") == 72.0
    assert _get_lab_val(lab, "blood_gas", "hco3") == 19.0
    assert _get_lab_val(lab, "blood_gas", "lactate") == 3.4

    # inflammatory
    assert _get_lab_val(lab, "inflammatory", "crp") == 120.0
    assert _get_lab_val(lab, "inflammatory", "pct") == 2.3

    # coagulation
    assert _get_lab_val(lab, "coagulation", "inr") == 1.4
    assert _get_lab_val(lab, "coagulation", "aptt") == 38.0
    assert _get_lab_val(lab, "coagulation", "d_dimer") == 1.2


def test_get_lab_val_legacy_flat_format():
    """Legacy seeds stored flat numeric values. Extractor must still work."""
    lab = _FakeLab(
        biochemistry={"creatinine": 1.2, "potassium": 3.8, "sodium": 140},
        hematology={"wbc": 9.5, "hemoglobin": 11.2, "platelet": 220},
        blood_gas={"ph": 7.40, "lactate": 1.1},
        inflammatory={"crp": 15},
    )
    assert _get_lab_val(lab, "biochemistry", "creatinine") == 1.2
    assert _get_lab_val(lab, "biochemistry", "potassium") == 3.8
    assert _get_lab_val(lab, "biochemistry", "sodium") == 140.0
    assert _get_lab_val(lab, "hematology", "wbc") == 9.5
    assert _get_lab_val(lab, "hematology", "hemoglobin") == 11.2
    assert _get_lab_val(lab, "hematology", "platelet") == 220.0
    assert _get_lab_val(lab, "blood_gas", "ph") == 7.40
    assert _get_lab_val(lab, "blood_gas", "lactate") == 1.1
    assert _get_lab_val(lab, "inflammatory", "crp") == 15.0


def test_get_lab_val_missing_or_non_numeric_returns_none():
    lab = _FakeLab(
        biochemistry={"Scr": {"value": "N/A"}, "K": None},
        hematology={},
    )
    assert _get_lab_val(lab, "biochemistry", "creatinine") is None
    assert _get_lab_val(lab, "biochemistry", "potassium") is None
    assert _get_lab_val(lab, "hematology", "wbc") is None
    # Category missing entirely
    assert _get_lab_val(lab, "coagulation", "inr") is None
    # Whole lab row missing
    assert _get_lab_val(None, "biochemistry", "creatinine") is None


def test_get_lab_val_unwraps_missing_value_key():
    """If HIS dict has no 'value' key, treat as missing rather than crashing."""
    lab = _FakeLab(biochemistry={"Scr": {"unit": "mg/dL"}})
    assert _get_lab_val(lab, "biochemistry", "creatinine") is None


# ── extract_snapshot_key_values ───────────────────────────────────────────────


def test_extract_snapshot_key_values_his_format():
    """extract_snapshot_key_values is the delta-tracking entry point; it must
    produce real numbers from HIS-wrapped lab rows or the delta detector will
    never fire and the chat will never warn about trend changes."""
    lab = _FakeLab(
        biochemistry={"Scr": {"value": 1.8}},
        hematology={"WBC": {"value": 14.2}, "PLT": {"value": 180}},
        blood_gas={"Lactate": {"value": 2.7}},
        inflammatory={"CRP": {"value": 95}},
    )
    kvs = extract_snapshot_key_values(lab, [])
    assert kvs["cr"] == 1.8
    assert kvs["wbc"] == 14.2
    assert kvs["plt"] == 180.0
    assert kvs["lactate"] == 2.7
    assert kvs["crp"] == 95.0
    assert kvs["vasopressor_ne_dose"] is None


def test_extract_snapshot_key_values_all_missing():
    lab = _FakeLab(biochemistry={}, hematology={}, blood_gas={}, inflammatory={})
    kvs = extract_snapshot_key_values(lab, [])
    assert kvs == {
        "cr": None,
        "wbc": None,
        "crp": None,
        "lactate": None,
        "plt": None,
        "vasopressor_ne_dose": None,
    }


# ── Phase 1 snapshot additions ───────────────────────────────────────────────


def test_renal_dosing_section_calculates_crcl_and_flags_renal_meds():
    lab = _FakeLab(
        biochemistry={
            "Scr": {"value": 1.2},
            "BUN": {"value": 32},
            "eGFR": {"value": 55},
        }
    )
    patient = _FakePatient(age=70, gender="M", weight=60)
    meds = [
        _FakeMed(generic_name="Vancomycin", kidney_relevant=True),
        _FakeMed(generic_name="Acetaminophen", kidney_relevant=False),
    ]

    text = _fmt_renal_dosing_section(patient, lab, meds, None)

    assert "【腎功能/給藥摘要】" in text
    assert "Scr 1.2 mg/dL" in text
    assert "eGFR 55" in text
    assert "BUN 32" in text
    assert "CrCl 約 48.6 mL/min" in text
    assert "Vancomycin" in text
    assert "Acetaminophen" not in text


def test_renal_dosing_section_reports_missing_inputs_without_guessing():
    lab = _FakeLab(biochemistry={})
    patient = _FakePatient(age=70, gender="F", weight=None)

    text = _fmt_renal_dosing_section(patient, lab, [], None)

    assert "腎功能: 無近期 Scr/eGFR/BUN" in text
    assert "CrCl: 無法計算" in text
    assert "Scr" in text
    assert "體重" in text


def test_data_freshness_section_lists_timestamps_and_missing_gaps():
    patient = _FakePatient()
    lab = _FakeLab(
        timestamp=datetime(2026, 5, 3, 0, 30, tzinfo=timezone.utc),
        biochemistry={"Scr": {"value": 1.2}},
    )
    meds = [_FakeMed()]
    vital = _FakeVital()
    extra = {
        "culture_results": datetime(2026, 5, 2, 22, 0, tzinfo=timezone.utc),
        "medication_administrations": None,
        "pharmacy_advices": datetime(2026, 5, 3, 3, 0, tzinfo=timezone.utc),
    }

    text = _fmt_data_freshness_section(
        patient, lab, meds, vital, None, [], [], extra
    )

    assert "【資料狀態】" in text
    assert "病患主檔: 2026-05-03 08:00" in text
    assert "檢驗: 2026-05-03 08:30" in text
    assert "用藥: 2026-05-03 09:00" in text
    assert "培養: 2026-05-03 06:00" in text
    assert "藥師建議: 2026-05-03 11:00" in text
    assert "無 MAR/實際給藥資料" in text


def test_data_freshness_section_marks_deferred_sections():
    patient = _FakePatient(intubated=True)

    text = _fmt_data_freshness_section(
        patient,
        None,
        [],
        None,
        None,
        [],
        [],
        {},
        deferred_sections={"ventilator_settings", "diagnostic_reports", "clinical_scores"},
    )

    assert "呼吸器: 延後載入" in text
    assert "影像/報告: 延後載入" in text
    assert "臨床評分: 延後載入" in text
    assert "插管中但無呼吸器資料" not in text


# ── Phase 2 snapshot additions ───────────────────────────────────────────────


def test_medication_safety_section_flags_allergy_and_risk_buckets():
    patient = _FakePatient(allergies=[{"drug": "Penicillin"}])
    meds = [
        _FakeMed(generic_name="Piperacillin/Tazobactam"),
        _FakeMed(generic_name="Ondansetron"),
    ]
    warnings = [
        {
            "level": "high",
            "mechanism": "qtc_prolonging",
            "members": ["Ondansetron", "Haloperidol"],
        },
        {
            "level": "critical",
            "mechanism": "bleeding_risk",
            "members": ["Warfarin", "Aspirin"],
        },
        {
            "level": "high",
            "mechanism": "nephrotoxic_triple_whammy",
            "members": ["Ibuprofen", "Lisinopril", "Furosemide"],
        },
        {
            "level": "moderate",
            "mechanism": "cns_depressant",
            "members": ["Morphine", "Midazolam"],
        },
    ]

    text = _fmt_medication_safety_section(patient, meds, warnings)

    assert "【用藥安全摘要】" in text
    assert "過敏衝突: Penicillin ↔ Piperacillin/Tazobactam" in text
    assert "自動警示: 共 4 筆" in text
    assert "critical 1" in text
    assert "high 2" in text
    assert "moderate 1" in text
    assert "QT/心律風險: high - qtc_prolonging" in text
    assert "出血風險: critical - bleeding_risk" in text
    assert "腎毒性風險: high - nephrotoxic_triple_whammy" in text
    assert "CNS/鎮靜呼吸風險: moderate - cns_depressant" in text


def test_medication_safety_section_does_not_create_false_warnings():
    patient = _FakePatient(allergies="NKDA")
    meds = [_FakeMed(generic_name="Acetaminophen")]

    text = _fmt_medication_safety_section(patient, meds, [])

    assert "過敏衝突: 過敏欄位無資料/未記載" in text
    assert "自動警示: 無 critical/high/moderate" in text
    assert "QT/心律風險" not in text
    assert "出血風險" not in text


def test_medication_safety_section_truncates_large_warning_bucket():
    patient = _FakePatient()
    meds = [_FakeMed(generic_name="Ondansetron")]
    warnings = [
        {
            "level": "high",
            "mechanism": "qtc_prolonging",
            "members": [f"Drug{i}", f"Drug{i + 1}"],
        }
        for i in range(7)
    ]

    text = _fmt_medication_safety_section(patient, meds, warnings)

    assert "QT/心律風險:" in text
    assert "另有 2 筆未列出" in text
