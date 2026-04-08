"""Tests for /patients/{patient_id}/ventilator endpoints."""

import pytest
import pytest_asyncio
from datetime import datetime, timezone


@pytest.fixture
def _seed_ventilator(seeded_db):
    """Seed ventilator data into seeded_db (which already has pat_001)."""
    import asyncio
    from app.models.ventilator import VentilatorSetting, WeaningAssessment

    async def _seed():
        seeded_db.add(VentilatorSetting(
            id="vent_001",
            patient_id="pat_001",
            timestamp=datetime(2026, 4, 7, 10, 0, tzinfo=timezone.utc),
            mode="SIMV",
            fio2=40,
            peep=8,
            tidal_volume=450,
            respiratory_rate=14,
        ))
        seeded_db.add(VentilatorSetting(
            id="vent_002",
            patient_id="pat_001",
            timestamp=datetime(2026, 4, 8, 10, 0, tzinfo=timezone.utc),
            mode="PSV",
            fio2=35,
            peep=5,
            tidal_volume=500,
            respiratory_rate=16,
        ))
        seeded_db.add(WeaningAssessment(
            id="wean_001",
            patient_id="pat_001",
            timestamp=datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc),
            rsbi=65,
            spo2=97,
            recommendation="Ready for SBT",
            readiness_score=80,
            assessed_by={"id": "usr_test", "name": "Test Doctor"},
        ))
        await seeded_db.commit()

    asyncio.get_event_loop().run_until_complete(_seed())
    return seeded_db


@pytest.mark.asyncio
async def test_ventilator_latest(client, _seed_ventilator):
    resp = await client.get("/patients/pat_001/ventilator/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["id"] == "vent_002"
    assert data["mode"] == "PSV"
    assert data["fio2"] == 35
    assert data["peep"] == 5


@pytest.mark.asyncio
async def test_ventilator_latest_no_data(client):
    resp = await client.get("/patients/pat_001/ventilator/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("data") is None


@pytest.mark.asyncio
async def test_ventilator_latest_patient_not_found(client):
    resp = await client.get("/patients/nonexistent/ventilator/latest")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_ventilator_trends(client, _seed_ventilator):
    resp = await client.get("/patients/pat_001/ventilator/trends?hours=48")
    assert resp.status_code == 200
    body = resp.json()
    data = body["data"]
    assert data["hours"] == 48
    assert len(data["trends"]) == 2
    # Trends should be in chronological order (oldest first)
    assert data["trends"][0]["id"] == "vent_001"
    assert data["trends"][1]["id"] == "vent_002"


@pytest.mark.asyncio
async def test_ventilator_trends_empty(client):
    resp = await client.get("/patients/pat_001/ventilator/trends")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["trends"] == []


@pytest.mark.asyncio
async def test_weaning_assessment_get(client, _seed_ventilator):
    resp = await client.get("/patients/pat_001/ventilator/weaning-assessment")
    assert resp.status_code == 200
    body = resp.json()
    data = body["data"]
    assert data["id"] == "wean_001"
    assert data["rsbi"] == 65
    assert data["readinessScore"] == 80
    assert data["recommendation"] == "Ready for SBT"


@pytest.mark.asyncio
async def test_weaning_assessment_no_data(client):
    resp = await client.get("/patients/pat_001/ventilator/weaning-assessment")
    assert resp.status_code == 200
    assert resp.json().get("data") is None


@pytest.mark.asyncio
async def test_weaning_assessment_create(client, _seed_ventilator):
    resp = await client.post("/patients/pat_001/ventilator/weaning-assessment")
    assert resp.status_code == 200
    body = resp.json()
    data = body["data"]
    assert data["id"].startswith("weaning_")
    assert data["patientId"] == "pat_001"
    assert data["assessedBy"]["id"] == "usr_test"
