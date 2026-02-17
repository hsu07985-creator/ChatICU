from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.medication import Medication
from app.models.medication_administration import MedicationAdministration


@pytest_asyncio.fixture
async def seeded_medication(seeded_db):
    med = Medication(
        id="med_contract_001",
        patient_id="pat_001",
        name="Morphine",
        generic_name="Morphine Sulfate",
        category="analgesic",
        san_category="A",
        dose="2",
        unit="mg",
        frequency="q4h",
        route="IV",
        prn=False,
        indication="pain",
        start_date=date(2026, 2, 17),
        status="active",
        prescribed_by={"id": "usr_test", "name": "Test Doctor"},
        warnings=["respiratory depression"],
    )
    seeded_db.add(med)
    seeded_db.add_all(
        [
            MedicationAdministration(
                id="adm_contract_001",
                medication_id=med.id,
                patient_id="pat_001",
                scheduled_time=datetime(2026, 2, 17, 8, 0, tzinfo=timezone.utc),
                administered_time=datetime(2026, 2, 17, 8, 5, tzinfo=timezone.utc),
                status="administered",
                dose="2 mg",
                route="IV",
                administered_by={"id": "usr_test", "name": "Test Doctor"},
                notes=None,
            ),
            MedicationAdministration(
                id="adm_contract_002",
                medication_id=med.id,
                patient_id="pat_001",
                scheduled_time=datetime(2026, 2, 17, 12, 0, tzinfo=timezone.utc),
                administered_time=None,
                status="scheduled",
                dose="2 mg",
                route="IV",
                administered_by=None,
                notes=None,
            ),
            MedicationAdministration(
                id="adm_contract_003",
                medication_id=med.id,
                patient_id="pat_001",
                scheduled_time=datetime(2026, 2, 18, 8, 0, tzinfo=timezone.utc),
                administered_time=None,
                status="scheduled",
                dose="2 mg",
                route="IV",
                administered_by=None,
                notes=None,
            ),
        ]
    )
    await seeded_db.commit()
    return med


@pytest.mark.asyncio
async def test_get_medication_detail_contract(client, seeded_medication):
    response = await client.get(f"/patients/pat_001/medications/{seeded_medication.id}")
    assert response.status_code == 200

    payload = response.json()
    assert payload["success"] is True
    data = payload["data"]
    assert data["id"] == seeded_medication.id
    assert data["patientId"] == "pat_001"
    assert data["name"] == "Morphine"
    assert isinstance(data["warnings"], list)


@pytest.mark.asyncio
async def test_get_medication_administrations_contract(client, seeded_medication):
    response = await client.get(
        f"/patients/pat_001/medications/{seeded_medication.id}/administrations",
        params={"startDate": "2026-02-17", "endDate": "2026-02-17"},
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["success"] is True
    administrations = payload["data"]
    assert isinstance(administrations, list)
    assert len(administrations) >= 1

    first = administrations[0]
    for field in [
        "id",
        "medicationId",
        "patientId",
        "scheduledTime",
        "status",
        "dose",
        "route",
    ]:
        assert field in first
    assert first["medicationId"] == seeded_medication.id
    assert first["patientId"] == "pat_001"


@pytest.mark.asyncio
async def test_patch_medication_administration_contract(client, seeded_medication):
    list_response = await client.get(
        f"/patients/pat_001/medications/{seeded_medication.id}/administrations"
    )
    assert list_response.status_code == 200
    administration_id = list_response.json()["data"][0]["id"]

    patch_response = await client.patch(
        f"/patients/pat_001/medications/{seeded_medication.id}/administrations/{administration_id}",
        json={"status": "held", "notes": "NPO before procedure"},
    )
    assert patch_response.status_code == 200

    patched = patch_response.json()["data"]
    assert patched["id"] == administration_id
    assert patched["status"] == "held"
    assert patched["notes"] == "NPO before procedure"

    verify_response = await client.get(
        f"/patients/pat_001/medications/{seeded_medication.id}/administrations"
    )
    assert verify_response.status_code == 200
    verify_rows = verify_response.json()["data"]
    updated_row = next(row for row in verify_rows if row["id"] == administration_id)
    assert updated_row["status"] == "held"
    assert updated_row["notes"] == "NPO before procedure"


@pytest.mark.asyncio
async def test_get_medication_administrations_date_window_returns_expected_subset(
    client,
    seeded_medication,
):
    same_day = await client.get(
        f"/patients/pat_001/medications/{seeded_medication.id}/administrations",
        params={"startDate": "2026-02-17", "endDate": "2026-02-17"},
    )
    assert same_day.status_code == 200
    same_day_ids = {row["id"] for row in same_day.json()["data"]}
    assert same_day_ids == {"adm_contract_001", "adm_contract_002"}

    next_day = await client.get(
        f"/patients/pat_001/medications/{seeded_medication.id}/administrations",
        params={"startDate": "2026-02-18", "endDate": "2026-02-18"},
    )
    assert next_day.status_code == 200
    next_day_ids = {row["id"] for row in next_day.json()["data"]}
    assert next_day_ids == {"adm_contract_003"}


@pytest.mark.asyncio
async def test_patch_medication_administration_persists_in_database(
    client,
    seeded_medication,
    seeded_db,
):
    administration_id = "adm_contract_002"

    patch_response = await client.patch(
        f"/patients/pat_001/medications/{seeded_medication.id}/administrations/{administration_id}",
        json={"status": "administered", "notes": "Dose completed at bedside"},
    )
    assert patch_response.status_code == 200

    # Ensure we read the latest committed values from DB, not session cache.
    seeded_db.expire_all()
    db_row = (
        await seeded_db.execute(
            select(MedicationAdministration).where(
                MedicationAdministration.id == administration_id
            )
        )
    ).scalar_one()

    assert db_row.status == "administered"
    assert db_row.notes == "Dose completed at bedside"
    assert db_row.administered_time is not None
    assert db_row.administered_by == {"id": "usr_test", "name": "Test Doctor"}
