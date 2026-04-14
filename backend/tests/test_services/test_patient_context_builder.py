"""Tests for patient_context_builder lab value extraction.

Regression: production `pat_a86cb503` returned only a lab timestamp with
no values because HIS import stores keys like `Scr`/`WBC`/`pH` wrapped in
`{"value": X, "unit": ...}`, but the extractor looked for flat lowercase
keys like `creatinine`/`wbc`/`ph`. These tests lock in the alias table
and value-unwrap behavior so both legacy flat seeds and HIS-imported rows
produce a real snapshot.
"""
from app.services.patient_context_builder import (
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
