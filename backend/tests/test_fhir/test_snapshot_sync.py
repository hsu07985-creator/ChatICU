from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.fhir.snapshot_sync import (
    merge_patient_payload,
    reconcile_medications,
    replace_patient_records,
    upsert_global_sync_status,
)
from app.models.lab_data import LabData
from app.models.medication import Medication
from app.models.medication_administration import MedicationAdministration
from app.models.patient import Patient
from app.models.sync_status import SyncStatus


def test_merge_patient_payload_preserves_manual_fields() -> None:
    existing = {
        "id": "pat_001",
        "name": "舊姓名",
        "medical_record_number": "16312169",
        "age": 70,
        "gender": "M",
        "diagnosis": "舊診斷",
        "bed_number": "ICU-8",
        "height": 170.0,
        "weight": 65.0,
        "bmi": 22.5,
        "symptoms": ["呼吸喘"],
        "intubated": True,
        "critical_status": "critical",
        "alerts": ["手動警示"],
        "allergies": ["Penicillin"],
        "is_isolated": True,
        "unit": "MICU",
        "campus": "仁愛",
        "last_update": datetime(2026, 4, 14, tzinfo=timezone.utc),
        "sedation": ["Midazolam"],
        "analgesia": [],
        "nmb": [],
        "ventilator_days": 5,
        "consent_status": "signed",
        "attending_physician": "舊醫師",
        "department": "舊科別",
        "admission_date": None,
        "icu_admission_date": None,
        "blood_type": None,
        "code_status": "Full Code",
        "has_dnr": False,
        "archived": False,
    }
    incoming = {
        "id": "pat_001",
        "name": "新姓名",
        "medical_record_number": "16312169",
        "age": 71,
        "gender": "F",
        "diagnosis": "新診斷",
        "bed_number": "",
        "height": None,
        "weight": None,
        "bmi": None,
        "symptoms": [],
        "intubated": False,
        "critical_status": None,
        "alerts": [],
        "allergies": [],
        "is_isolated": False,
        "unit": "ICU",
        "campus": None,
        "last_update": None,
        "sedation": ["Propofol"],
        "analgesia": ["Fentanyl"],
        "nmb": [],
        "ventilator_days": 0,
        "consent_status": None,
        "attending_physician": "新醫師",
        "department": "新科別",
        "admission_date": None,
        "icu_admission_date": None,
        "blood_type": "A+",
        "code_status": "DNR",
        "has_dnr": True,
        "archived": False,
    }

    merged = merge_patient_payload(existing, incoming)

    assert merged["name"] == "新姓名"
    assert merged["diagnosis"] == "新診斷"
    assert merged["attending_physician"] == "新醫師"
    assert merged["bed_number"] == "ICU-8"
    assert merged["height"] == 170.0
    assert merged["weight"] == 65.0
    assert merged["symptoms"] == ["呼吸喘"]
    assert merged["intubated"] is True
    assert merged["alerts"] == ["手動警示"]
    assert merged["allergies"] == ["Penicillin"]
    assert merged["is_isolated"] is True
    assert merged["sedation"] == ["Propofol"]
    assert merged["analgesia"] == ["Fentanyl"]
    assert merged["ventilator_days"] == 0
    assert merged["code_status"] == "DNR"
    assert merged["has_dnr"] is True


@pytest.mark.asyncio
async def test_replace_patient_records_reports_added_and_removed_ids(db_session) -> None:
    """replace_patient_records should compute the set-diff of existing vs
    incoming record IDs so the sync pipeline can surface 'N new lab results'
    notifications without a separate audit log."""
    patient = Patient(
        id="pat_replace",
        name="張測試",
        bed_number="I-2",
        medical_record_number="99999001",
        age=70,
        gender="女",
        diagnosis="敗血症",
        intubated=False,
        ventilator_days=0,
    )
    db_session.add(patient)
    # Seed two existing lab records: one will be kept, one will be removed.
    db_session.add_all([
        LabData(
            id="lab_old_keep",
            patient_id="pat_replace",
            timestamp=datetime(2026, 4, 15, 8, 0, tzinfo=timezone.utc),
            biochemistry={"Na": {"value": "140"}},
        ),
        LabData(
            id="lab_old_gone",
            patient_id="pat_replace",
            timestamp=datetime(2026, 4, 15, 9, 0, tzinfo=timezone.utc),
            biochemistry={"K": {"value": "4.1"}},
        ),
    ])
    await db_session.commit()

    incoming = [
        {
            "id": "lab_old_keep",
            "patient_id": "pat_replace",
            "timestamp": datetime(2026, 4, 15, 8, 0, tzinfo=timezone.utc),
            "biochemistry": {"Na": {"value": "140"}},
        },
        {
            "id": "lab_new_a",
            "patient_id": "pat_replace",
            "timestamp": datetime(2026, 4, 16, 8, 0, tzinfo=timezone.utc),
            "biochemistry": {"Na": {"value": "138"}},
        },
        {
            "id": "lab_new_b",
            "patient_id": "pat_replace",
            "timestamp": datetime(2026, 4, 16, 9, 0, tzinfo=timezone.utc),
            "biochemistry": {"Cl": {"value": "102"}},
        },
    ]

    delta = await replace_patient_records(
        db_session, "lab_data", "pat_replace", incoming
    )
    await db_session.commit()

    assert delta["total"] == 3
    assert delta["added"] == 2
    assert delta["removed"] == 1
    assert delta["added_ids"] == ["lab_new_a", "lab_new_b"]
    assert delta["removed_ids"] == ["lab_old_gone"]

    remaining_ids = {
        row
        for row, in (
            await db_session.execute(
                select(LabData.id).where(LabData.patient_id == "pat_replace")
            )
        ).all()
    }
    assert remaining_ids == {"lab_old_keep", "lab_new_a", "lab_new_b"}


@pytest.mark.asyncio
async def test_reconcile_medications_deletes_stale_without_admins_and_protects_with_admins(
    db_session,
) -> None:
    patient = Patient(
        id="pat_001",
        name="王測試",
        bed_number="I-1",
        medical_record_number="16312169",
        age=65,
        gender="男",
        diagnosis="肺炎",
        intubated=False,
        ventilator_days=0,
    )
    keep_stale = Medication(
        id="med_keep_stale",
        patient_id="pat_001",
        name="Keep stale",
        status="active",
    )
    delete_stale = Medication(
        id="med_delete_stale",
        patient_id="pat_001",
        name="Delete stale",
        status="active",
    )
    db_session.add_all([patient, keep_stale, delete_stale])
    db_session.add(
        MedicationAdministration(
            id="admin_001",
            medication_id="med_keep_stale",
            patient_id="pat_001",
            scheduled_time=datetime(2026, 4, 14, 0, 0, tzinfo=timezone.utc),
            status="scheduled",
        )
    )
    await db_session.commit()

    summary = await reconcile_medications(
        db_session,
        "pat_001",
        [
            {
                "id": "med_new",
                "patient_id": "pat_001",
                "name": "New med",
                "status": "active",
                "prn": False,
                "source_type": "inpatient",
                "is_external": False,
            }
        ],
    )
    await db_session.commit()

    meds = (
        await db_session.execute(select(Medication).where(Medication.patient_id == "pat_001"))
    ).scalars().all()
    med_ids = {med.id for med in meds}
    keep_status = (
        await db_session.execute(
            select(Medication.status).where(Medication.id == "med_keep_stale")
        )
    ).scalar_one()

    assert summary["upserted"] == 1
    assert summary["added"] == 1
    assert summary["added_ids"] == ["med_new"]
    assert summary["deleted"] == 1
    assert summary["protected"] == 1
    assert "med_new" in med_ids
    assert "med_delete_stale" not in med_ids
    assert "med_keep_stale" in med_ids
    assert keep_status == "discontinued"


@pytest.mark.asyncio
async def test_upsert_global_sync_status_persists_version_and_details(db_session) -> None:
    summary = {
        "patient_id": "pat_001",
        "patient_name": "王測試",
        "patient_mrn": "16312169",
        "snapshot_id": "20260412_010000",
        "snapshot_dir": "/tmp/patient/16312169/20260412_010000",
        "normalized_hash": "hash-001",
        "format_type": "hourly-latest",
        "medications": {"upserted": 10, "deleted": 1, "protected": 0},
        "lab_data": 5,
        "culture_results": 1,
        "diagnostic_reports": 2,
        "synced_at": "2026-04-14T00:00:00+00:00",
    }

    await upsert_global_sync_status(db_session, summary)
    await db_session.commit()

    row = (
        await db_session.execute(
            select(SyncStatus).where(SyncStatus.key == "his_snapshots")
        )
    ).scalar_one()

    assert row.version == "2026-04-14T00:00:00+00:00"
    assert row.source == "his_snapshots"
    assert row.details["patient_mrn"] == "16312169"
    assert row.details["medications"]["upserted"] == 10


@pytest.mark.asyncio
async def test_upsert_global_sync_status_accumulates_recent_deltas(db_session) -> None:
    """Two patients syncing in the same tick should both end up in the
    recent_deltas ring buffer so the frontend toast feed never loses an
    event to single-row overwrites."""
    first = {
        "patient_id": "pat_101",
        "patient_name": "林阿玉",
        "patient_mrn": "16312169",
        "snapshot_id": "20260412_010000",
        "snapshot_dir": "/tmp/patient/16312169/20260412_010000",
        "normalized_hash": "hash-101",
        "format_type": "hourly-latest",
        "medications": {
            "upserted": 10,
            "added": 1,
            "added_ids": ["med_new_1"],
            "deleted": 0,
            "deleted_ids": [],
            "protected": 0,
            "protected_ids": [],
        },
        "lab_data": {"total": 5, "added": 2, "removed": 0, "added_ids": ["lab_a", "lab_b"], "removed_ids": []},
        "culture_results": {"total": 1, "added": 1, "removed": 0, "added_ids": ["cul_a"], "removed_ids": []},
        "diagnostic_reports": {"total": 2, "added": 0, "removed": 0, "added_ids": [], "removed_ids": []},
        "synced_at": "2026-04-14T00:00:00+00:00",
    }
    second = {
        **first,
        "patient_id": "pat_102",
        "patient_name": "陳大明",
        "patient_mrn": "41113230",
        "snapshot_id": "20260412_020000",
        "normalized_hash": "hash-102",
        "medications": {
            "upserted": 8,
            "added": 0,
            "added_ids": [],
            "deleted": 0,
            "deleted_ids": [],
            "protected": 0,
            "protected_ids": [],
        },
        "lab_data": {"total": 7, "added": 3, "removed": 0, "added_ids": ["lab_x", "lab_y", "lab_z"], "removed_ids": []},
        "culture_results": {"total": 0, "added": 0, "removed": 0, "added_ids": [], "removed_ids": []},
        "diagnostic_reports": {"total": 1, "added": 1, "removed": 0, "added_ids": ["diag_a"], "removed_ids": []},
        "synced_at": "2026-04-14T00:05:00+00:00",
    }
    # This third sync has zero adds — should NOT enter the ring buffer.
    noop = {
        **first,
        "patient_id": "pat_103",
        "patient_name": "王無事",
        "patient_mrn": "99999999",
        "synced_at": "2026-04-14T00:10:00+00:00",
        "medications": {
            "upserted": 5,
            "added": 0,
            "added_ids": [],
            "deleted": 0,
            "deleted_ids": [],
            "protected": 0,
            "protected_ids": [],
        },
        "lab_data": {"total": 3, "added": 0, "removed": 0, "added_ids": [], "removed_ids": []},
        "culture_results": {"total": 0, "added": 0, "removed": 0, "added_ids": [], "removed_ids": []},
        "diagnostic_reports": {"total": 0, "added": 0, "removed": 0, "added_ids": [], "removed_ids": []},
    }

    await upsert_global_sync_status(db_session, first)
    await upsert_global_sync_status(db_session, second)
    await upsert_global_sync_status(db_session, noop)
    await db_session.commit()

    row = (
        await db_session.execute(
            select(SyncStatus).where(SyncStatus.key == "his_snapshots")
        )
    ).scalar_one()

    recent = row.details["recent_deltas"]
    assert len(recent) == 2
    assert [event["patient_id"] for event in recent] == ["pat_101", "pat_102"]
    assert recent[0]["added"]["lab_data"] == 2
    assert recent[0]["added"]["culture_results"] == 1
    assert recent[1]["added"]["lab_data"] == 3
    assert recent[1]["added"]["diagnostic_reports"] == 1
    # Noop third sync still advances the version but no delta event queued.
    assert row.version == "2026-04-14T00:10:00+00:00"


@pytest.mark.asyncio
async def test_upsert_global_sync_status_overwrites_existing_row(db_session) -> None:
    first = {
        "patient_id": "pat_001",
        "patient_name": "王測試",
        "patient_mrn": "16312169",
        "snapshot_id": "20260412_010000",
        "snapshot_dir": "/tmp/patient/16312169/20260412_010000",
        "normalized_hash": "hash-001",
        "format_type": "hourly-latest",
        "medications": {"upserted": 10, "deleted": 1, "protected": 0},
        "lab_data": 5,
        "culture_results": 1,
        "diagnostic_reports": 2,
        "synced_at": "2026-04-14T00:00:00+00:00",
    }
    second = {
        **first,
        "patient_id": "pat_002",
        "patient_name": "李測試",
        "patient_mrn": "41113230",
        "snapshot_id": "20260412_020000",
        "snapshot_dir": "/tmp/patient/41113230/20260412_020000",
        "normalized_hash": "hash-002",
        "medications": {"upserted": 12, "deleted": 0, "protected": 1},
        "lab_data": 8,
        "culture_results": 3,
        "diagnostic_reports": 4,
        "synced_at": "2026-04-14T01:00:00+00:00",
    }

    await upsert_global_sync_status(db_session, first)
    await upsert_global_sync_status(db_session, second)
    await db_session.commit()

    row = (
        await db_session.execute(
            select(SyncStatus).where(SyncStatus.key == "his_snapshots")
        )
    ).scalar_one()

    assert row.version == "2026-04-14T01:00:00+00:00"
    assert row.details["patient_mrn"] == "41113230"
    assert row.details["snapshot_id"] == "20260412_020000"
    assert row.details["medications"]["protected"] == 1
