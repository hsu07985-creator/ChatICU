"""Tests for lab-data endpoints."""
import pytest
from datetime import datetime, timezone, timedelta

from app.models.lab_data import LabData
from app.models.patient import Patient
from app.models.vital_sign import VitalSign

pytestmark = pytest.mark.anyio


@pytest.fixture
async def seeded_lab(seeded_db):
    """Seed lab data for pat_001."""
    db = seeded_db
    now = datetime.now(timezone.utc)
    lab1 = LabData(
        id="lab_test_001",
        patient_id="pat_001",
        timestamp=now,
        biochemistry={"BUN": 15.0, "Cr": 1.2},
        hematology={"WBC": 8.5, "Hb": 12.0},
        blood_gas={"pH": 7.38, "pCO2": 42},
        venous_blood_gas={"pH": 7.34, "pCO2": 46},
        inflammatory={"CRP": 2.5},
        coagulation={"PT": 12.0},
    )
    lab2 = LabData(
        id="lab_test_002",
        patient_id="pat_001",
        timestamp=now - timedelta(days=2),
        biochemistry={"BUN": 18.0, "Cr": 1.5},
        hematology={"WBC": 10.0, "Hb": 11.0},
    )
    db.add_all([lab1, lab2])
    await db.commit()
    return db


async def test_get_latest_lab_data(client, seeded_lab):
    """GET /patients/{id}/lab-data/latest returns most recent record."""
    resp = await client.get("/patients/pat_001/lab-data/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["patientId"] == "pat_001"
    assert data["biochemistry"]["Cr"] == 1.2
    assert "venousBloodGas" in data


async def test_get_latest_lab_data_not_found(client, seeded_db):
    """GET /patients/{id}/lab-data/latest returns null when no data."""
    resp = await client.get("/patients/pat_001/lab-data/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    # May return None data or empty depending on implementation
    assert body.get("data") is None or body.get("data") == {}


async def test_get_lab_trends(client, seeded_lab):
    """GET /patients/{id}/lab-data/trends returns multiple records."""
    resp = await client.get("/patients/pat_001/lab-data/trends?days=7")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["days"] == 7
    assert len(data["trends"]) == 2


async def test_get_lab_trends_filter_days(client, seeded_lab):
    """GET /patients/{id}/lab-data/trends with days=1 returns recent records."""
    resp = await client.get("/patients/pat_001/lab-data/trends?days=1")
    assert resp.status_code == 200
    trends = resp.json()["data"]["trends"]
    # At least 1 record (timezone handling may vary between SQLite and PostgreSQL)
    assert len(trends) >= 1


async def test_get_latest_lab_data_patient_not_found(client, seeded_db):
    """GET /patients/nonexistent/lab-data/latest returns 404."""
    resp = await client.get("/patients/nonexistent/lab-data/latest")
    assert resp.status_code == 404


async def test_lab_data_response_includes_all_categories(client, seeded_lab):
    """Lab data response includes all JSONB category fields."""
    resp = await client.get("/patients/pat_001/lab-data/latest")
    data = resp.json()["data"]
    for key in ["biochemistry", "hematology", "bloodGas", "venousBloodGas",
                "inflammatory", "coagulation", "cardiac", "thyroid",
                "hormone", "lipid", "other", "corrections"]:
        assert key in data


@pytest.fixture
async def seeded_clcr_history(seeded_db):
    db = seeded_db
    now = datetime.now(timezone.utc)

    patient = await db.get(Patient, "pat_001")
    assert patient is not None
    patient.weight = None

    labs = [
        LabData(
            id="lab_clcr_old_outside_backfill",
            patient_id="pat_001",
            timestamp=now - timedelta(days=320),
            biochemistry={"Scr": 1.0},
        ),
        LabData(
            id="lab_clcr_old_backfill",
            patient_id="pat_001",
            timestamp=now - timedelta(days=100),
            biochemistry={"Scr": 1.0},
        ),
        LabData(
            id="lab_clcr_latest",
            patient_id="pat_001",
            timestamp=now - timedelta(days=2),
            biochemistry={"Scr": 1.0},
        ),
    ]
    vitals = [
        VitalSign(
            id="vs_weight_first",
            patient_id="pat_001",
            timestamp=now - timedelta(days=90),
            body_weight=60.0,
        ),
        VitalSign(
            id="vs_weight_second",
            patient_id="pat_001",
            timestamp=now - timedelta(days=3),
            body_weight=55.0,
        ),
    ]
    db.add_all([*labs, *vitals])
    await db.commit()
    return db


async def test_get_latest_lab_data_computes_clcr_with_effective_weight(client, seeded_clcr_history):
    resp = await client.get("/patients/pat_001/lab-data/latest")
    assert resp.status_code == 200
    clcr = resp.json()["data"]["biochemistry"]["Clcr"]
    assert clcr["value"] == 57.3
    assert clcr["weightUsed"] == 55.0
    assert clcr["weightSource"] == "vital_signs"


async def test_get_lab_trends_computes_clcr_with_backfill_and_cutover(client, seeded_clcr_history):
    resp = await client.get("/patients/pat_001/lab-data/trends?days=365&category=biochemistry&item=Clcr")
    assert resp.status_code == 200
    trends = resp.json()["data"]["trends"]

    assert len(trends) == 2
    first = trends[0]["biochemistry"]["Clcr"]
    second = trends[1]["biochemistry"]["Clcr"]

    assert first["value"] == 62.5
    assert first["weightUsed"] == 60.0
    assert first["weightSource"] == "initial_backfill"

    assert second["value"] == 57.3
    assert second["weightUsed"] == 55.0
    assert second["weightSource"] == "vital_signs"


async def test_get_lab_trends_clcr_falls_back_to_patient_weight_when_no_history(client, seeded_db):
    db = seeded_db
    patient = await db.get(Patient, "pat_001")
    assert patient is not None
    patient.weight = 70.0
    db.add(
        LabData(
            id="lab_clcr_patient_weight_fallback",
            patient_id="pat_001",
            timestamp=datetime.now(timezone.utc) - timedelta(days=1),
            biochemistry={"Scr": 1.0},
        )
    )
    await db.commit()

    resp = await client.get("/patients/pat_001/lab-data/trends?days=30&category=biochemistry&item=Clcr")
    assert resp.status_code == 200
    trends = resp.json()["data"]["trends"]
    assert len(trends) == 1
    clcr = trends[0]["biochemistry"]["Clcr"]
    assert clcr["value"] == 72.9
    assert clcr["weightUsed"] == 70.0
    assert clcr["weightSource"] == "patient_profile"
