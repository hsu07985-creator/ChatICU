"""T5 (llm-4) — snapshot medication formatter edge cases.

Paired with test_citation_audit.py's llm-2 tests; both trace to
docs/codebase-health/codebase-systematic-review-2026-06-03.md.
"""

from app.models.medication import Medication
from app.services.patient_context_builder.formatters import _fmt_med_section


def _med(**kw):
    base = dict(
        id="med_t5", patient_id="pat_001", name="Meropenem",
        dose="500", unit="mg", frequency="Q8H", route="IV", status="active",
    )
    base.update(kw)
    return Medication(**base)


def test_med_with_unit_renders_dose_unit():
    out = _fmt_med_section([_med()])
    assert "Meropenem 500mg Q8H IV" in out


def test_med_without_unit_marks_missing_unit():
    """llm-4: HIS DOSE_UNIT can be empty — a bare number reads as an
    implied unit (500 what?) and invites the LLM to guess one. The
    snapshot must say the unit is unrecorded instead."""
    out = _fmt_med_section([_med(unit=None)])
    assert "Meropenem 500(單位未記錄) Q8H IV" in out
    out = _fmt_med_section([_med(unit="")])
    assert "Meropenem 500(單位未記錄) Q8H IV" in out


def test_med_without_dose_has_no_unit_marker():
    """No dose at all → nothing to mark; keep the plain name."""
    out = _fmt_med_section([_med(dose=None, unit=None)])
    assert "Meropenem Q8H IV" in out
    assert "單位未記錄" not in out
