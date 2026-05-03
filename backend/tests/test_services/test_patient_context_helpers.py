"""W3-T3 / T4 / T5 regression guards for patient_context_builder helpers.

These pin the behaviour change boundaries so future refactors don't
silently re-introduce the bugs that motivated the fix.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone

import pytest

from app.models.medication import Medication
from app.services.clinical_thresholds import (
    LAB_THRESHOLDS,
    VENT_THRESHOLDS,
    VITAL_THRESHOLDS,
    flag_only,
    mark,
)
from app.services.patient_context_builder import (
    TAIPEI_TZ,
    _now_taipei,
    _vasopressor_ne_dose,
)


# ── W3-T3: Taipei timezone ────────────────────────────────────────────────────

def test_now_taipei_returns_aware_taipei_datetime():
    now = _now_taipei()
    assert now.tzinfo is not None
    assert now.utcoffset().total_seconds() == 8 * 3600


def test_now_taipei_is_8h_ahead_of_utc():
    taipei = _now_taipei()
    utc = datetime.now(timezone.utc)
    diff = (taipei.replace(tzinfo=None) - utc.replace(tzinfo=None)).total_seconds()
    # within 1 second tolerance
    assert abs(diff - 8 * 3600) < 1


# ── W3-T4: clinical thresholds ─────────────────────────────────────────────────

def test_mark_flags_outside_range():
    rng = (3.5, 5.0)  # K
    assert mark(2.5, rng) == "2.5↓"
    assert mark(5.5, rng) == "5.5↑"
    assert mark(4.0, rng) == "4.0"
    assert mark(None, rng) == "—"


def test_mark_handles_one_sided_range():
    # eGFR — only "low" defined
    rng = LAB_THRESHOLDS["eGFR"]
    assert rng == (60, None)
    assert mark(45, rng) == "45↓"
    assert mark(120, rng) == "120"


def test_flag_only_returns_arrow_or_empty():
    rng = LAB_THRESHOLDS["AST"]  # (None, 40)
    assert flag_only(50, rng) == "↑"
    assert flag_only(20, rng) == ""
    assert flag_only(None, rng) == ""


def test_thresholds_match_pre_extraction_constants():
    """Pin the values that were inline before. Regression guard against
    accidental edits to the centralised file."""
    assert LAB_THRESHOLDS["K"] == (3.5, 5.0)
    assert LAB_THRESHOLDS["Na"] == (135, 145)
    assert LAB_THRESHOLDS["AST"] == (None, 40)
    assert LAB_THRESHOLDS["pH"] == (7.35, 7.45)
    assert LAB_THRESHOLDS["pO2"] == (60, None)
    assert LAB_THRESHOLDS["Hb"] == (8, None)
    assert LAB_THRESHOLDS["PLT"] == (100, None)
    assert VITAL_THRESHOLDS["MAP"] == (65, None)
    assert VITAL_THRESHOLDS["SpO2"] == (92, None)
    assert VITAL_THRESHOLDS["Temp"] == (36.0, 37.5)
    assert VENT_THRESHOLDS["FiO2"] == (None, 50)
    assert VENT_THRESHOLDS["PEEP"] == (None, 8)


# ── W3-T5: NE dose regex parse ─────────────────────────────────────────────────

def _med(name: str, dose: str) -> Medication:
    return Medication(
        id="med_test",
        patient_id="pat_test",
        name=name,
        generic_name=name,
        dose=dose,
        route=None,
        frequency=None,
        status="active",
    )


@pytest.mark.parametrize("dose,expected", [
    ("0.08", 0.08),
    ("0.08 mcg/kg/min", 0.08),
    ("  0.15  mcg/kg/min", 0.15),
    ("0.5mcg/kg/min", 0.5),
    ("12 mcg", 12.0),
    ("3.14e-2 mcg/kg/min", 3.14),  # we only take the leading numeric, e-notation tail is ignored
])
def test_ne_dose_regex_extracts_leading_number(dose, expected):
    val = _vasopressor_ne_dose([_med("Norepinephrine", dose)])
    assert val == pytest.approx(expected)


def test_ne_dose_returns_none_for_missing_or_unparseable():
    assert _vasopressor_ne_dose([]) is None
    assert _vasopressor_ne_dose([_med("Norepinephrine", "")]) is None
    assert _vasopressor_ne_dose([_med("Norepinephrine", "as titrated")]) is None
    assert _vasopressor_ne_dose([_med("Insulin", "0.5")]) is None  # not NE


def test_ne_dose_matches_legacy_synonyms():
    for name in ["Norepinephrine", "Noradrenaline", "NE", "Levophed"]:
        assert _vasopressor_ne_dose([_med(name, "0.08 mcg/kg/min")]) == 0.08
