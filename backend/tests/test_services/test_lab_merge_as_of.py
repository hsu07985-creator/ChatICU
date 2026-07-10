"""Tests for svc-2: per-item as-of tracking on merged lab rows.

`_merge_lab_rows` (repository.py) deliberately merges across unlimited time —
a legit CBC draw can be 24-48h older than the latest chemistry draw, and an
earlier attempt to bound the merge with a 12h window was reverted because it
silently dropped a real, clinically vital value (a 29h-old PLT 61). The fix
implemented here never drops data; it tracks each item's source-row
timestamp in the transient `_item_as_of` attribute and `_fmt_lab_section`
(formatters.py) annotates any item pulled from a row >24h older than the
merged/displayed timestamp so the LLM doesn't mistake a stale value for
today's.
"""
from datetime import datetime, timezone

from app.services.patient_context_builder import _fmt_lab_section, _merge_lab_rows


class _FakeLab:
    """Lightweight stand-in for LabData ORM row (attributes only)."""

    def __init__(self, **kwargs):
        for name in (
            "biochemistry", "hematology", "blood_gas", "venous_blood_gas",
            "inflammatory", "coagulation", "cardiac", "thyroid",
            "hormone", "lipid", "other",
        ):
            setattr(self, name, None)
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_merge_lab_rows_tracks_per_item_as_of_across_split_rows():
    """Two rows 3 days apart: the newest-sourced item's as-of equals the
    merged timestamp; the older-sourced item carries its own (older) as-of
    instead of silently inheriting the newest row's timestamp."""
    latest = _FakeLab(
        id="lab_latest",
        patient_id="pat_001",
        timestamp=datetime(2026, 5, 12, 8, 0, tzinfo=timezone.utc),
        biochemistry={"Scr": {"value": 1.1}},
    )
    three_days_old = _FakeLab(
        id="lab_old",
        patient_id="pat_001",
        timestamp=datetime(2026, 5, 9, 8, 0, tzinfo=timezone.utc),  # 72h earlier
        hematology={"PLT": {"value": 61}},
    )

    merged = _merge_lab_rows([latest, three_days_old])

    assert merged.timestamp == latest.timestamp
    assert merged._item_as_of["biochemistry"]["Scr"] == latest.timestamp
    assert merged._item_as_of["hematology"]["PLT"] == three_days_old.timestamp
    # No data was dropped — the older item's value is still present.
    assert merged.hematology["PLT"]["value"] == 61


def test_fmt_lab_section_marks_stale_item_and_leaves_fresh_item_unchanged():
    """The snapshot renders a compact staleness marker on the item sourced
    from the older row, and nothing extra on the item sourced from the row
    whose timestamp is already shown in the section header."""
    latest = _FakeLab(
        id="lab_latest",
        patient_id="pat_001",
        timestamp=datetime(2026, 5, 12, 8, 0, tzinfo=timezone.utc),
        biochemistry={"Scr": {"value": 1.1}},
    )
    three_days_old = _FakeLab(
        id="lab_old",
        patient_id="pat_001",
        timestamp=datetime(2026, 5, 9, 8, 0, tzinfo=timezone.utc),  # 72h earlier
        hematology={"PLT": {"value": 61}},
    )

    merged = _merge_lab_rows([latest, three_days_old])
    text = _fmt_lab_section(merged, None)

    # Fresh item (same row as the displayed timestamp): trend marker only,
    # no staleness suffix.
    assert "Cr 1.1*" in text
    assert "Cr 1.1*(" not in text

    # Stale item: value is preserved, and a "(3天前)" marker is appended.
    assert "PLT 61.0" in text
    assert "PLT 61.0↓(3天前)" in text


def test_fmt_lab_section_uses_hour_format_under_48h():
    """28h-old item renders "(28h前)", not the day-granularity marker —
    matches the finding's example format."""
    latest = _FakeLab(
        id="lab_latest",
        patient_id="pat_001",
        timestamp=datetime(2026, 5, 12, 8, 0, tzinfo=timezone.utc),
        biochemistry={"Scr": {"value": 1.1}},
    )
    twenty_eight_h_old = _FakeLab(
        id="lab_28h",
        patient_id="pat_001",
        timestamp=datetime(2026, 5, 11, 4, 0, tzinfo=timezone.utc),  # 28h earlier
        hematology={"WBC": {"value": 12.5}},
    )

    merged = _merge_lab_rows([latest, twenty_eight_h_old])
    text = _fmt_lab_section(merged, None)

    assert "WBC 12.5*(28h前)" in text


def test_merge_lab_rows_single_row_produces_no_staleness_markers():
    """Single-row merge returns the row unchanged (no _item_as_of at all),
    and the formatter renders it exactly as it would today — no markers."""
    only = _FakeLab(
        id="lab_only",
        patient_id="pat_001",
        timestamp=datetime(2026, 5, 12, 8, 0, tzinfo=timezone.utc),
        biochemistry={"Scr": {"value": 1.1}},
        hematology={"PLT": {"value": 250}},
    )

    merged = _merge_lab_rows([only])

    assert merged is only
    assert not hasattr(merged, "_item_as_of")

    text = _fmt_lab_section(merged, None)
    assert "Cr 1.1*" in text
    assert "PLT 250.0" in text
    # No staleness annotation should appear anywhere ("前" only ever shows up
    # via the 24h-trend note or a staleness marker; prev_lab is None here so
    # the only possible source is staleness — must be absent).
    assert "前" not in text
