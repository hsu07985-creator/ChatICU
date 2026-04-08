"""Tests for /patients/{patient_id}/symptom-records endpoints."""

import pytest


@pytest.mark.asyncio
async def test_list_symptom_records_empty(client):
    resp = await client.get("/patients/pat_001/symptom-records")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"] == []


@pytest.mark.asyncio
async def test_list_symptom_records_patient_not_found(client):
    resp = await client.get("/patients/nonexistent/symptom-records")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_symptom_record(client):
    resp = await client.post(
        "/patients/pat_001/symptom-records",
        json={"symptoms": ["fever", "cough"], "notes": "Onset 2 hours ago"},
    )
    assert resp.status_code == 200
    body = resp.json()
    data = body["data"]
    assert data["id"].startswith("sym_")
    assert data["patientId"] == "pat_001"
    assert data["symptoms"] == ["fever", "cough"]
    assert data["notes"] == "Onset 2 hours ago"
    assert data["recordedBy"]["id"] == "usr_test"


@pytest.mark.asyncio
async def test_create_then_list(client):
    # Create a record
    await client.post(
        "/patients/pat_001/symptom-records",
        json={"symptoms": ["headache"]},
    )
    # List should return it
    resp = await client.get("/patients/pat_001/symptom-records")
    assert resp.status_code == 200
    records = resp.json()["data"]
    assert len(records) >= 1
    assert "headache" in records[0]["symptoms"]


@pytest.mark.asyncio
async def test_create_invalid_symptoms_type(client):
    resp = await client.post(
        "/patients/pat_001/symptom-records",
        json={"symptoms": "not-a-list"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_patient_not_found(client):
    resp = await client.post(
        "/patients/nonexistent/symptom-records",
        json={"symptoms": ["fever"]},
    )
    assert resp.status_code == 404
