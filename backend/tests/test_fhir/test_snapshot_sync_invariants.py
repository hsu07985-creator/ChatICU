"""Invariants that must hold across the snapshot_sync refactor (audit doc #3).

These tests lock down the observable contract of insert_records, upsert_records,
reconcile_medications, and replace_patient_records before changing the SQL
implementation from per-row SELECT-then-INSERT/UPDATE to PostgreSQL native
``INSERT ... ON CONFLICT DO UPDATE`` + multi-row VALUES batches.

Each test is named to explain the invariant; the body proves the contract on
the current code so the same assertions still pass after the refactor.

Companion to ``tests/test_fhir/test_snapshot_sync.py`` (happy-path coverage).
See docs/system-audit-2026-04-28.md §2.2 for the refactor plan.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.fhir.snapshot_sync import (
    insert_records,
    reconcile_medications,
    replace_patient_records,
    upsert_records,
)
from app.models.lab_data import LabData
from app.models.medication import Medication
from app.models.medication_administration import MedicationAdministration
from app.models.patient import Patient


# ────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────


async def _seed_patient(db_session, patient_id: str = "pat_inv") -> Patient:
    patient = Patient(
        id=patient_id,
        name="不變量測試",
        bed_number="I-99",
        medical_record_number="99000001",
        age=70,
        gender="女",
        diagnosis="testing",
        intubated=False,
        ventilator_days=0,
    )
    db_session.add(patient)
    await db_session.commit()
    return patient


def _med_record(med_id: str, patient_id: str, name: str, status: str = "active") -> dict:
    """Minimal medication record shape that mirrors what HISConverter produces."""
    return {
        "id": med_id,
        "patient_id": patient_id,
        "name": name,
        "status": status,
        "prn": False,
        "source_type": "inpatient",
        "is_external": False,
    }


# ────────────────────────────────────────────────────────────────────────
# upsert_records — created_at preservation (most critical invariant)
# ────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upsert_records_preserves_created_at_on_update(db_session) -> None:
    """When a row is updated via upsert, created_at MUST remain the original
    insertion timestamp. After refactoring to ``INSERT ... ON CONFLICT DO
    UPDATE``, callers must NOT include ``excluded.created_at`` in the SET
    clause — otherwise audit/billing trails become wrong.
    """
    await _seed_patient(db_session)

    # First insert via upsert path.
    await upsert_records(
        db_session,
        "medications",
        [_med_record("med_inv_1", "pat_inv", "Original name")],
    )
    await db_session.commit()

    original_created_at = (
        await db_session.execute(
            select(Medication.created_at).where(Medication.id == "med_inv_1")
        )
    ).scalar_one()
    assert original_created_at is not None

    # Sleep enough for any naive ``CURRENT_TIMESTAMP`` re-evaluation to differ.
    await asyncio.sleep(0.05)

    # Second call updates the same id with new fields.
    await upsert_records(
        db_session,
        "medications",
        [_med_record("med_inv_1", "pat_inv", "Renamed", status="discontinued")],
    )
    await db_session.commit()

    after_update = (
        await db_session.execute(
            select(Medication).where(Medication.id == "med_inv_1")
        )
    ).scalar_one()

    assert after_update.name == "Renamed"
    assert after_update.status == "discontinued"
    # The contract: created_at frozen at first insert.
    assert after_update.created_at == original_created_at


@pytest.mark.asyncio
async def test_upsert_records_is_idempotent(db_session) -> None:
    """Calling upsert with identical input twice must not duplicate rows
    and must not raise, regardless of underlying SQL strategy."""
    await _seed_patient(db_session)
    record = _med_record("med_idem", "pat_inv", "Idempotent")

    first = await upsert_records(db_session, "medications", [record])
    await db_session.commit()
    second = await upsert_records(db_session, "medications", [record])
    await db_session.commit()

    assert first == 1
    assert second == 1

    rows = (
        await db_session.execute(select(Medication).where(Medication.id == "med_idem"))
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_upsert_records_handles_empty_list(db_session) -> None:
    """Empty input must return 0 and execute zero SQL — refactor to batch
    VALUES tuples must guard against empty input (Postgres rejects
    ``INSERT ... VALUES`` with no tuples)."""
    await _seed_patient(db_session)

    count = await upsert_records(db_session, "medications", [])
    await db_session.commit()

    assert count == 0


# ────────────────────────────────────────────────────────────────────────
# insert_records — empty input + ordering (matters for batch refactor)
# ────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_insert_records_handles_empty_list(db_session) -> None:
    await _seed_patient(db_session)

    count = await insert_records(db_session, "lab_data", [])
    await db_session.commit()

    assert count == 0


@pytest.mark.asyncio
async def test_insert_records_returns_inserted_count(db_session) -> None:
    """Return value must equal len(records) — both summary and downstream
    coverage reports rely on this number."""
    await _seed_patient(db_session)

    records = [
        {
            "id": f"lab_seq_{i}",
            "patient_id": "pat_inv",
            "timestamp": datetime(2026, 4, 20, 8, i, tzinfo=timezone.utc),
            "biochemistry": {"Na": {"value": str(140 + i)}},
        }
        for i in range(5)
    ]

    count = await insert_records(db_session, "lab_data", records)
    await db_session.commit()

    assert count == 5

    actual_ids = {
        row
        for row, in (
            await db_session.execute(
                select(LabData.id).where(LabData.patient_id == "pat_inv")
            )
        ).all()
    }
    assert actual_ids == {f"lab_seq_{i}" for i in range(5)}


# ────────────────────────────────────────────────────────────────────────
# reconcile_medications — boundary cases that must keep working
# ────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reconcile_medications_with_empty_incoming_protects_admins_only(
    db_session,
) -> None:
    """If HIS returns no medications, every existing med becomes stale.
    Those with administrations MUST be discontinued (not deleted); those
    without MUST be deleted. This guard exists because deleting a med with
    administrations would orphan the audit trail and break MAR display.
    """
    await _seed_patient(db_session)

    db_session.add_all([
        Medication(
            id="med_protected",
            patient_id="pat_inv",
            name="Has admins",
            status="active",
        ),
        Medication(
            id="med_deletable",
            patient_id="pat_inv",
            name="No admins",
            status="active",
        ),
    ])
    db_session.add(
        MedicationAdministration(
            id="admin_protect",
            medication_id="med_protected",
            patient_id="pat_inv",
            scheduled_time=datetime(2026, 4, 20, 8, 0, tzinfo=timezone.utc),
            status="scheduled",
        )
    )
    await db_session.commit()

    summary = await reconcile_medications(db_session, "pat_inv", [])
    await db_session.commit()

    assert summary["upserted"] == 0
    assert summary["added"] == 0
    assert summary["deleted"] == 1
    assert summary["protected"] == 1
    assert summary["deleted_ids"] == ["med_deletable"]
    assert summary["protected_ids"] == ["med_protected"]

    # Confirm DB state matches the summary exactly.
    remaining = (
        await db_session.execute(
            select(Medication.id, Medication.status).where(
                Medication.patient_id == "pat_inv"
            )
        )
    ).all()
    remaining_map = {row.id: row.status for row in remaining}
    assert remaining_map == {"med_protected": "discontinued"}


@pytest.mark.asyncio
async def test_reconcile_medications_mixed_added_protected_deleted(db_session) -> None:
    """Mixed scenario: some incoming new, some kept, some stale-with-admins,
    some stale-without-admins. All four counters must be correct
    simultaneously — protected_ids and deleted_ids must be disjoint, and
    added_ids must not include kept ids.
    """
    await _seed_patient(db_session)

    db_session.add_all([
        Medication(id="med_kept", patient_id="pat_inv", name="Kept", status="active"),
        Medication(
            id="med_stale_protected",
            patient_id="pat_inv",
            name="Stale w/ admin",
            status="active",
        ),
        Medication(
            id="med_stale_deletable_a",
            patient_id="pat_inv",
            name="Stale no admin A",
            status="active",
        ),
        Medication(
            id="med_stale_deletable_b",
            patient_id="pat_inv",
            name="Stale no admin B",
            status="active",
        ),
    ])
    db_session.add(
        MedicationAdministration(
            id="admin_mixed",
            medication_id="med_stale_protected",
            patient_id="pat_inv",
            scheduled_time=datetime(2026, 4, 20, 8, 0, tzinfo=timezone.utc),
            status="scheduled",
        )
    )
    await db_session.commit()

    incoming = [
        _med_record("med_kept", "pat_inv", "Kept (renamed)"),
        _med_record("med_new_x", "pat_inv", "New X"),
        _med_record("med_new_y", "pat_inv", "New Y"),
    ]
    summary = await reconcile_medications(db_session, "pat_inv", incoming)
    await db_session.commit()

    assert summary["upserted"] == 3
    assert summary["added"] == 2
    assert sorted(summary["added_ids"]) == ["med_new_x", "med_new_y"]
    assert summary["deleted"] == 2
    assert sorted(summary["deleted_ids"]) == [
        "med_stale_deletable_a",
        "med_stale_deletable_b",
    ]
    assert summary["protected"] == 1
    assert summary["protected_ids"] == ["med_stale_protected"]

    # Disjointness: an id is never simultaneously protected and deleted.
    assert set(summary["protected_ids"]).isdisjoint(set(summary["deleted_ids"]))

    # Final DB state.
    remaining = (
        await db_session.execute(
            select(Medication.id, Medication.status).where(
                Medication.patient_id == "pat_inv"
            )
        )
    ).all()
    remaining_map = {row.id: row.status for row in remaining}
    assert remaining_map == {
        "med_kept": "active",
        "med_new_x": "active",
        "med_new_y": "active",
        "med_stale_protected": "discontinued",
    }


# ────────────────────────────────────────────────────────────────────────
# replace_patient_records — boundary cases
# ────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_replace_patient_records_with_empty_incoming_removes_all(
    db_session,
) -> None:
    """Empty incoming → existing rows become removed_ids; total inserted is 0.
    Required because lab/culture/diagnostic_reports have no
    administration-style protection — they are fully replaced each tick.
    """
    await _seed_patient(db_session)

    db_session.add_all([
        LabData(
            id="lab_will_remove_a",
            patient_id="pat_inv",
            timestamp=datetime(2026, 4, 20, 8, 0, tzinfo=timezone.utc),
            biochemistry={"Na": {"value": "140"}},
        ),
        LabData(
            id="lab_will_remove_b",
            patient_id="pat_inv",
            timestamp=datetime(2026, 4, 20, 9, 0, tzinfo=timezone.utc),
            biochemistry={"K": {"value": "4.1"}},
        ),
    ])
    await db_session.commit()

    delta = await replace_patient_records(db_session, "lab_data", "pat_inv", [])
    await db_session.commit()

    assert delta["total"] == 0
    assert delta["added"] == 0
    assert delta["removed"] == 2
    assert sorted(delta["removed_ids"]) == ["lab_will_remove_a", "lab_will_remove_b"]
    assert delta["added_ids"] == []

    remaining = (
        await db_session.execute(
            select(LabData.id).where(LabData.patient_id == "pat_inv")
        )
    ).all()
    assert remaining == []


@pytest.mark.asyncio
async def test_replace_patient_records_with_unchanged_set_reports_zero_delta(
    db_session,
) -> None:
    """If incoming and existing IDs match exactly, added/removed must be
    zero even though the implementation still does DELETE + re-INSERT.
    Frontend toast logic skips zero-delta events; the contract is critical.
    """
    await _seed_patient(db_session)

    initial = [
        {
            "id": "lab_same_a",
            "patient_id": "pat_inv",
            "timestamp": datetime(2026, 4, 20, 8, 0, tzinfo=timezone.utc),
            "biochemistry": {"Na": {"value": "140"}},
        },
        {
            "id": "lab_same_b",
            "patient_id": "pat_inv",
            "timestamp": datetime(2026, 4, 20, 9, 0, tzinfo=timezone.utc),
            "biochemistry": {"K": {"value": "4.1"}},
        },
    ]
    await insert_records(db_session, "lab_data", initial)
    await db_session.commit()

    # Re-supply the same IDs (values may differ — we only care about ID set).
    delta = await replace_patient_records(db_session, "lab_data", "pat_inv", initial)
    await db_session.commit()

    assert delta["total"] == 2
    assert delta["added"] == 0
    assert delta["removed"] == 0
    assert delta["added_ids"] == []
    assert delta["removed_ids"] == []

    remaining = (
        await db_session.execute(
            select(LabData.id).where(LabData.patient_id == "pat_inv")
        )
    ).all()
    remaining_ids = {row[0] for row in remaining}
    assert remaining_ids == {"lab_same_a", "lab_same_b"}
