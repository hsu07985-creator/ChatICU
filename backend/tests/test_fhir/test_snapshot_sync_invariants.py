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
    SchemaInconsistencyError,
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


# ────────────────────────────────────────────────────────────────────────
# Step 3 batch refactor invariants (audit doc §D.8)
#
# These tests gate the upcoming change of insert_records / upsert_records
# from per-row SQL to multi-row VALUES + ON CONFLICT batching. They lock
# down the parts of the contract that the refactor must NOT break.
#
# Some tests already pass on the per-row implementation because the
# observable contract is identical (e.g. accidental last-write-wins via
# successive UPDATEs, len(records) return value, IntegrityError on dupe id
# inside insert_records). They are added here so the contract is explicit
# and so a future refactor cannot silently regress.
#
# Tests that exercise *new* behaviour (raising SchemaInconsistencyError)
# are marked xfail until the helper lands; remove the marker as part of
# the refactor commit.
# ────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upsert_records_batch_dedupes_within_chunk(db_session) -> None:
    """Same-id duplicates inside one batch must collapse to a single row,
    last-write-wins. Per-row code achieves this accidentally (second call
    UPDATEs the first); the batch refactor must keep the same semantics
    via explicit dedupe (audit doc §D.6) so PostgreSQL's
    "cannot affect row a second time" error never surfaces.
    """
    await _seed_patient(db_session)

    duplicates = [
        _med_record("med_dup", "pat_inv", "First write"),
        _med_record("med_dup", "pat_inv", "Second write"),
    ]
    await upsert_records(db_session, "medications", duplicates)
    await db_session.commit()

    rows = (
        await db_session.execute(select(Medication).where(Medication.id == "med_dup"))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].name == "Second write"


@pytest.mark.asyncio
async def test_upsert_records_returns_original_input_length_when_deduped(
    db_session,
) -> None:
    """Return count must equal len(input), not len(deduped). The number
    flows into reconcile_medications' summary["upserted"] which becomes the
    user-visible med_upserted statistic; leaking dedupe count would break
    the external contract (audit doc §D.6.1).
    """
    await _seed_patient(db_session)

    records = [
        _med_record("med_a", "pat_inv", "Alpha v1"),
        _med_record("med_a", "pat_inv", "Alpha v2"),  # dupe id
        _med_record("med_b", "pat_inv", "Beta"),
    ]
    count = await upsert_records(db_session, "medications", records)
    await db_session.commit()

    assert count == 3  # len(records), NOT len(deduped) which would be 2

    distinct_ids = {
        row
        for row, in (
            await db_session.execute(
                select(Medication.id).where(Medication.patient_id == "pat_inv")
            )
        ).all()
    }
    assert distinct_ids == {"med_a", "med_b"}


@pytest.mark.asyncio
async def test_upsert_records_raises_on_inconsistent_schema(db_session) -> None:
    """Effective-key-set mismatch between records must raise
    SchemaInconsistencyError so an upstream HISConverter regression
    surfaces immediately rather than silently misaligning columns inside
    a batch VALUES tuple. (audit doc §D.2)
    """
    await _seed_patient(db_session)

    inconsistent = [
        _med_record("med_a", "pat_inv", "Alpha"),
        # Same id-set keys plus an extra column the table actually has
        # ("dose"). On per-row code this just inserts with the extra col;
        # on batch code it must raise because column-tuple shape diverges.
        {**_med_record("med_b", "pat_inv", "Beta"), "dose": 5.0},
    ]
    with pytest.raises(SchemaInconsistencyError):
        await upsert_records(db_session, "medications", inconsistent)


@pytest.mark.asyncio
async def test_upsert_records_tolerates_extra_timestamp_keys(db_session) -> None:
    """Records may differ on whether they carry created_at / updated_at;
    those two fields are stripped from the INSERT column list and
    supplied by server defaults. The refactor must compare the *effective*
    key set (audit doc §D.2 v3 correction) so this case does NOT raise.
    """
    await _seed_patient(db_session)

    now = datetime(2026, 4, 28, 12, 0, tzinfo=timezone.utc)
    records = [
        # First record carries an explicit created_at
        {**_med_record("med_with_ts", "pat_inv", "With timestamp"), "created_at": now},
        # Second record omits both timestamp fields entirely
        _med_record("med_no_ts", "pat_inv", "No timestamp"),
    ]
    # Must not raise SchemaInconsistencyError despite the per-record key
    # difference, because both timestamp fields are excluded from the
    # effective comparison.
    await upsert_records(db_session, "medications", records)
    await db_session.commit()

    ids = {
        row
        for row, in (
            await db_session.execute(
                select(Medication.id).where(Medication.patient_id == "pat_inv")
            )
        ).all()
    }
    assert ids == {"med_with_ts", "med_no_ts"}


@pytest.mark.asyncio
async def test_insert_records_raises_on_duplicate_id_within_batch(db_session) -> None:
    """insert_records is the strict, no-dedupe path. Duplicate ids inside
    one batch must surface as a database integrity error so an upstream
    converter bug becomes visible immediately, instead of being silently
    collapsed by last-write-wins like upsert_records does (audit doc §D.6).

    The exact exception class differs between SQLite (IntegrityError) and
    Postgres (UniqueViolation) — we accept any subclass of
    sqlalchemy.exc.IntegrityError or its DBAPI wrappers.
    """
    from sqlalchemy.exc import IntegrityError

    await _seed_patient(db_session)

    duplicates = [
        {
            "id": "lab_clash",
            "patient_id": "pat_inv",
            "timestamp": datetime(2026, 4, 28, 8, 0, tzinfo=timezone.utc),
            "biochemistry": {"Na": {"value": "140"}},
        },
        {
            "id": "lab_clash",  # SAME id — strict path must raise
            "patient_id": "pat_inv",
            "timestamp": datetime(2026, 4, 28, 9, 0, tzinfo=timezone.utc),
            "biochemistry": {"Na": {"value": "138"}},
        },
    ]
    with pytest.raises(IntegrityError):
        await insert_records(db_session, "lab_data", duplicates)


@pytest.mark.asyncio
async def test_upsert_records_chunks_large_input(db_session) -> None:
    """A batch larger than CHUNK_SIZE must still process every row
    correctly. Lock the contract that callers can pass arbitrary-size
    lists without worrying about PostgreSQL's 32767 bind-parameter limit
    (audit doc §D.5). 600 rows comfortably exceeds the planned
    CHUNK_SIZE=500 so we exercise the chunking boundary.
    """
    await _seed_patient(db_session)

    records = [_med_record(f"med_bulk_{i:04d}", "pat_inv", f"Bulk {i}") for i in range(600)]

    count = await upsert_records(db_session, "medications", records)
    await db_session.commit()

    assert count == 600
    actual = (
        await db_session.execute(
            select(Medication.id).where(Medication.patient_id == "pat_inv")
        )
    ).all()
    assert len(actual) == 600


@pytest.mark.asyncio
async def test_replace_patient_records_still_executes_delete_before_insert(
    db_session, monkeypatch,
) -> None:
    """White-box guard: replace_patient_records must still issue a DELETE
    before re-populating. The Step 3 batch refactor only touches the
    SQL shape inside insert_records / upsert_records — the DELETE+INSERT
    structure of replace_patient_records is part of the public delta
    contract and must NOT be silently optimised into an upsert
    (audit doc §D.3).
    """
    await _seed_patient(db_session)

    # Seed two existing rows so a DELETE actually removes data.
    await insert_records(db_session, "lab_data", [
        {
            "id": "lab_existing_a",
            "patient_id": "pat_inv",
            "timestamp": datetime(2026, 4, 28, 8, 0, tzinfo=timezone.utc),
            "biochemistry": {"Na": {"value": "140"}},
        },
        {
            "id": "lab_existing_b",
            "patient_id": "pat_inv",
            "timestamp": datetime(2026, 4, 28, 9, 0, tzinfo=timezone.utc),
            "biochemistry": {"K": {"value": "4.1"}},
        },
    ])
    await db_session.commit()

    sql_log: list[str] = []
    original_execute = db_session.execute

    async def spy_execute(stmt, *args, **kwargs):
        sql_log.append(str(stmt))
        return await original_execute(stmt, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", spy_execute)

    await replace_patient_records(
        db_session,
        "lab_data",
        "pat_inv",
        [
            {
                "id": "lab_new",
                "patient_id": "pat_inv",
                "timestamp": datetime(2026, 4, 28, 10, 0, tzinfo=timezone.utc),
                "biochemistry": {"Cl": {"value": "102"}},
            }
        ],
    )
    await db_session.commit()

    delete_stmts = [s for s in sql_log if "DELETE FROM lab_data" in s.upper().replace(" ", " ")]
    # Match either "DELETE FROM lab_data" or its case variants
    delete_stmts_norm = [s for s in sql_log if "DELETE" in s.upper() and "lab_data" in s]
    assert len(delete_stmts_norm) >= 1, (
        "replace_patient_records must DELETE before INSERT to preserve "
        "the added/removed delta contract; observed SQL: " + "; ".join(sql_log)
    )


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
