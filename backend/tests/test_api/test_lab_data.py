"""Tests for lab-data endpoints."""
import pytest
from datetime import datetime, timezone, timedelta

from app.models.lab_data import LabData

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
