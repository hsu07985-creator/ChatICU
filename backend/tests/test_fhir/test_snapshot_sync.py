from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.fhir.snapshot_sync import (
    merge_patient_payload,
    reconcile_medications,
    upsert_global_sync_status,
)
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
