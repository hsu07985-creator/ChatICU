"""Tests for one-shot patient creation flow (no follow-up patch required)."""

import pytest

from app.fhir.his.roc_time import _gen_id
from app.models.patient import Patient


@pytest.mark.asyncio
async def test_create_patient_persists_full_payload_in_single_request(client):
    payload = {
        "name": "王測試",
        "bed_number": "I-9",
        "medical_record_number": "MRN-9001",
        "age": 58,
        "gender": "男",
        "diagnosis": "敗血性休克",
        "intubated": True,
        "admission_date": "2026-02-15",
        "icu_admission_date": "2026-02-16",
        "ventilator_days": 3,
        "attending_physician": "林醫師",
        "department": "內科",
        "sedation": ["Propofol"],
        "analgesia": ["Fentanyl"],
        "nmb": ["Cisatracurium"],
        "has_dnr": True,
        "is_isolated": True,
    }

    create_response = await client.post("/patients", json=payload)
    assert create_response.status_code == 200
    create_body = create_response.json()
    assert create_body["success"] is True

    created = create_body["data"]
    assert created["name"] == "王測試"
    assert created["bedNumber"] == "I-9"
    assert created["medicalRecordNumber"] == "MRN-9001"
    assert created["diagnosis"] == "敗血性休克"
    assert created["intubated"] is True
    assert created["ventilatorDays"] == 3
    assert created["sedation"] == ["Propofol"]
    assert created["analgesia"] == ["Fentanyl"]
    assert created["nmb"] == ["Cisatracurium"]
    assert created["hasDNR"] is True
    assert created["isIsolated"] is True
    assert created["attendingPhysician"] == "林醫師"
    assert created["department"] == "內科"

    patient_id = created["id"]
    get_response = await client.get(f"/patients/{patient_id}")
    assert get_response.status_code == 200
    get_body = get_response.json()
    assert get_body["success"] is True

    fetched = get_body["data"]
    assert fetched["ventilatorDays"] == 3
    assert fetched["sedation"] == ["Propofol"]
    assert fetched["analgesia"] == ["Fentanyl"]
    assert fetched["nmb"] == ["Cisatracurium"]
    assert fetched["hasDNR"] is True
    assert fetched["isIsolated"] is True


@pytest.mark.asyncio
async def test_create_patient_default_values_when_optional_fields_omitted(client):
    payload = {
        "name": "李簡化",
        "bed_number": "I-10",
        "medical_record_number": "MRN-9002",
        "age": 70,
        "gender": "女",
        "diagnosis": "肺炎",
    }

    response = await client.post("/patients", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True

    created = body["data"]
    assert created["ventilatorDays"] == 0
    assert created["hasDNR"] is False
    assert created["isIsolated"] is False
    assert created["sedation"] == []
    assert created["analgesia"] == []
    assert created["nmb"] == []


@pytest.mark.asyncio
async def test_update_patient_orphan_fields(client):
    response = await client.patch("/patients/pat_001", json={
        "critical_status": "critical",
        "campus": "main",
        "is_isolated": True,
    })
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["criticalStatus"] == "critical"
    assert data["campus"] == "main"
    assert data["isIsolated"] is True


@pytest.mark.asyncio
async def test_his_patient_blocks_auto_fields_but_allows_orphans(client, seeded_db):
    mrn = "HIS-LOCK-001"
    patient_id = _gen_id("pat", mrn)
    seeded_db.add(Patient(
        id=patient_id,
        name="HIS 病人",
        bed_number="I-8",
        medical_record_number=mrn,
        age=70,
        gender="男",
        diagnosis="肺炎",
        intubated=False,
    ))
    await seeded_db.commit()

    blocked = await client.patch(
        f"/patients/{patient_id}",
        json={"name": "不可覆寫", "weight": 80},
    )
    assert blocked.status_code == 409
    assert "name" in blocked.json()["message"]
    assert "weight" in blocked.json()["message"]

    allowed = await client.patch(
        f"/patients/{patient_id}",
        json={"critical_status": "critical", "campus": "main", "is_isolated": True},
    )
    assert allowed.status_code == 200
    data = allowed.json()["data"]
    assert data["criticalStatus"] == "critical"
    assert data["campus"] == "main"
    assert data["isIsolated"] is True


@pytest.mark.asyncio
async def test_manual_patient_keeps_full_editing(client):
    response = await client.patch("/patients/pat_001", json={"name": "人工病人"})
    assert response.status_code == 200
    assert response.json()["data"]["name"] == "人工病人"
