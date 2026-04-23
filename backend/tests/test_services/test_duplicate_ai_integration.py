"""Integration tests for duplicate-medication warnings in the AI clinical snapshot.

Wave 3 — docs/duplicate-medication-integration-plan.md §4.2.

Covers the wiring between ``app.services.patient_context_builder.build_clinical_snapshot``
and ``app.utils.duplicate_check.format_duplicate_metadata``:

  * dual PPI → snapshot text contains the "重複用藥警示" block.
  * clean med list → no duplicate block, snapshot still renders cleanly.
  * detector crash → snapshot still renders; no duplicate block; no exception.

The underlying DuplicateDetector has its own coverage in
``test_duplicate_detector.py``; here we test only the plumbing.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, List, Optional
from unittest.mock import AsyncMock, patch

import pytest

from app.services import patient_context_builder as pcb


# ── Minimal stand-ins for ORM rows ──────────────────────────────────────────


class _FakePatient:
    """Shape-compatible stand-in for the Patient ORM row used by snapshot fns."""

    def __init__(self, unit: Optional[str] = None):
        self.id = "pat_test"
        self.name = "王○明"
        self.age = 70
        self.gender = "男"
        self.bed_number = "I-01"
        self.diagnosis = "Sepsis, AKI"
        self.icu_admission_date = date(2026, 4, 20)
        self.ventilator_days = 2
        self.intubated = True
        self.has_dnr = False
        self.allergies = None
        self.alerts = None
        self.unit = unit  # drives _infer_duplicate_context


class _FakeMed:
    """Minimal Medication stand-in that _fmt_med_section / normaliser tolerate."""

    def __init__(
        self,
        *,
        id: str,
        generic_name: str,
        atc_code: Optional[str] = None,
        route: str = "PO",
    ):
        self.id = id
        self.name = generic_name
        self.generic_name = generic_name
        self.atc_code = atc_code
        self.route = route
        self.dose = None
        self.unit = None
        self.frequency = None
        self.san_category = None
        self.is_external = False
        self.source_type = "inpatient"
        self.prn = False
        self.status = "active"
        self.end_date = None
        self.updated_at = datetime(2026, 4, 22, 8, 0, tzinfo=timezone.utc)


# ── Fixture: stub out every DB helper except _get_active_medications ─────────


@pytest.fixture
def _stub_snapshot_db():
    """Patch the per-section DB fetchers so build_clinical_snapshot runs pure-in-memory.

    Yields a dict the test can mutate to control which patient / meds are returned.
    """
    state: dict = {
        "patient": _FakePatient(unit="ICU"),
        "meds": [],
    }

    async def _patient(_db, _pid):
        return state["patient"]

    async def _meds(_db, _pid):
        return state["meds"]

    async def _none(*_a, **_k):
        return None

    async def _empty_list(*_a, **_k):
        return []

    with patch.object(pcb, "_get_patient", side_effect=_patient), \
         patch.object(pcb, "_get_active_medications", side_effect=_meds), \
         patch.object(pcb, "_get_latest_lab", side_effect=_none), \
         patch.object(pcb, "_get_lab_before_24h", side_effect=_none), \
         patch.object(pcb, "_get_latest_vital", side_effect=_none), \
         patch.object(pcb, "_get_latest_vent", side_effect=_none), \
         patch.object(pcb, "_get_recent_reports", side_effect=_empty_list), \
         patch.object(pcb, "_get_latest_scores", side_effect=_empty_list):
        yield state


# ── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_snapshot_contains_duplicate_block_for_dual_ppi(_stub_snapshot_db):
    """Dual PPI → format_duplicate_metadata returns warnings → snapshot embeds block."""
    _stub_snapshot_db["meds"] = [
        _FakeMed(id="m1", generic_name="Esomeprazole", atc_code="A02BC05"),
        _FakeMed(id="m2", generic_name="Pantoprazole", atc_code="A02BC02"),
    ]

    fake_warnings = [
        {
            "level": "high",
            "layer": "L2",
            "mechanism": "PPI × PPI",
            "members": ["Esomeprazole", "Pantoprazole"],
            "recommendation": "停用其中一 PPI；若為換藥過渡期，overlap ≤ 48h 後應停單方。",
            "auto_downgraded": False,
        }
    ]

    fake_fmt = AsyncMock(return_value=fake_warnings)
    with patch.object(pcb, "format_duplicate_metadata", fake_fmt):
        snapshot = await pcb.build_clinical_snapshot("pat_test", db=AsyncMock())

    # format_duplicate_metadata was invoked with the active meds + ICU context
    assert fake_fmt.await_count == 1
    _, kwargs = fake_fmt.call_args
    # context is passed by keyword in build_clinical_snapshot
    assert kwargs.get("context") == "icu"

    # Snapshot carries the header + mechanism + recommendation
    assert "[重複用藥警示（自動偵測）]" in snapshot
    assert "PPI × PPI" in snapshot
    assert "Esomeprazole + Pantoprazole" in snapshot
    assert "建議：" in snapshot
    # And still shows the patient + med sections around it
    assert "【用藥】" in snapshot
    assert "=== 快照結束 ===" in snapshot


@pytest.mark.asyncio
async def test_snapshot_omits_duplicate_block_when_no_warnings(_stub_snapshot_db):
    """Single med / no duplicates → no header text leaks into the snapshot."""
    _stub_snapshot_db["meds"] = [
        _FakeMed(id="m1", generic_name="Esomeprazole", atc_code="A02BC05"),
    ]

    fake_fmt = AsyncMock(return_value=[])
    with patch.object(pcb, "format_duplicate_metadata", fake_fmt):
        snapshot = await pcb.build_clinical_snapshot("pat_test", db=AsyncMock())

    assert fake_fmt.await_count == 1
    assert "[重複用藥警示（自動偵測）]" not in snapshot
    # Snapshot must still render (med section present, not an error payload)
    assert "【用藥】" in snapshot
    assert "=== 快照結束 ===" in snapshot


@pytest.mark.asyncio
async def test_snapshot_survives_duplicate_detector_crash(_stub_snapshot_db):
    """Detector exception must NOT bubble up or corrupt the snapshot."""
    _stub_snapshot_db["meds"] = [
        _FakeMed(id="m1", generic_name="Esomeprazole", atc_code="A02BC05"),
        _FakeMed(id="m2", generic_name="Pantoprazole", atc_code="A02BC02"),
    ]

    async def _boom(*_a, **_k):
        raise RuntimeError("detector unavailable")

    with patch.object(pcb, "format_duplicate_metadata", side_effect=_boom):
        snapshot = await pcb.build_clinical_snapshot("pat_test", db=AsyncMock())

    # No duplicate block, but snapshot is fully intact
    assert "[重複用藥警示（自動偵測）]" not in snapshot
    assert "【用藥】" in snapshot
    assert "=== 快照結束 ===" in snapshot


@pytest.mark.asyncio
async def test_snapshot_uses_inpatient_context_for_non_icu_unit(_stub_snapshot_db):
    """Non-ICU ward → context='inpatient'."""
    _stub_snapshot_db["patient"] = _FakePatient(unit="General Ward 7B")
    _stub_snapshot_db["meds"] = [
        _FakeMed(id="m1", generic_name="Esomeprazole", atc_code="A02BC05"),
    ]

    fake_fmt = AsyncMock(return_value=[])
    with patch.object(pcb, "format_duplicate_metadata", fake_fmt):
        await pcb.build_clinical_snapshot("pat_test", db=AsyncMock())

    _, kwargs = fake_fmt.call_args
    assert kwargs.get("context") == "inpatient"
