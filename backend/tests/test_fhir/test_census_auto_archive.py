"""Census auto-archive: patients absent from the patient/ directory set.

A patient no longer exported by HIS (MRN not among the current patient/ dirs)
has been discharged. See docs/his-sync/census-left-unit-detection-design-2026-07-21.md
"""
from __future__ import annotations

import asyncio

from app.fhir.snapshot_sync import (
    CENSUS_MIN_PRESENT,
    _his_patient_id,
    archive_absent_his_patients,
    select_absent_his_patient_ids,
)


def test_absent_his_patient_is_selected() -> None:
    gone, here = "20096336", "50669055"
    rows = [(_his_patient_id(gone), gone), (_his_patient_id(here), here)]
    present = {here, "30546132", "50140472"}
    assert select_absent_his_patient_ids(rows, present) == [_his_patient_id(gone)]


def test_present_patient_is_spared() -> None:
    here = "50669055"  # e.g. 邱建陽 (RCW ward) — still exported, must not archive
    rows = [(_his_patient_id(here), here)]
    assert select_absent_his_patient_ids(rows, {here, "a", "b"}) == []


def test_non_his_identity_is_spared() -> None:
    # hand-set demo id whose MRN doesn't fingerprint back to it → never archived
    rows = [("pat_003", "123458")]
    assert select_absent_his_patient_ids(rows, {"x", "y", "z"}) == []


def test_null_mrn_is_spared() -> None:
    assert select_absent_his_patient_ids([("pat_whatever", None)], {"x", "y", "z"}) == []


def test_guard_refuses_implausibly_small_present_set() -> None:
    # present below the floor → skip without touching the session (empty/broken patient/)
    assert len({"only_one"}) < CENSUS_MIN_PRESENT
    res = asyncio.run(archive_absent_his_patients(object(), {"only_one"}))
    assert res["archived"] == 0 and res.get("skipped") == "present_too_small"
