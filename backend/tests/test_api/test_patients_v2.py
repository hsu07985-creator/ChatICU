"""Tests for /v2/patients endpoints with mocked layer2_store."""

import pytest
from unittest.mock import patch

# Sample patient data matching _profile_to_patient_api expectations
_MOCK_PATIENT = {
    "patientId": "P001",
    "name": "測試病患",
    "bedNumber": "I-1",
    "medicalRecordNumber": "MRN001",
    "age": 65,
    "gender": "男",
    "height": 170,
    "weight": 75,
    "diagnosis": "重度肺炎",
    "intubated": True,
    "criticalStatus": "critical",
    "admissionDate": "2026-01-01",
    "department": "ICU",
    "hasDNR": False,
}

_MOCK_LAB = {
    "patientId": "P001",
    "timestamp": "2026-04-08T10:00:00Z",
    "biochemistry": {"Na": {"value": 140}},
    "hematology": {"WBC": {"value": 8.5}},
}

_MOCK_MEDS = {
    "patientId": "P001",
    "medications": [
        {
            "id": "med_001",
            "name": "Vancomycin",
            "genericName": "Vancomycin",
            "dose": "1000",
            "unit": "mg",
            "frequency": "Q12H",
            "route": "IV",
            "status": "active",
            "startDate": "2026-04-01",
        },
    ],
}

_MOCK_CULTURE = {
    "patientId": "P001",
    "cultureCount": 1,
    "cultures": [{"specimen": "Blood", "organism": "E. coli"}],
}

_MOCK_META = {
    "batchId": "test_batch",
    "batchDir": "/tmp/test",
    "patientCount": 1,
    "labPatientCount": 1,
    "medicationPatientCount": 1,
    "culturePatientCount": 1,
}


def _patch_store(method_name, return_value):
    return patch(f"app.routers.patients_v2.layer2_store.{method_name}", return_value=return_value)


def _patch_meta():
    return _patch_store("get_meta", _MOCK_META)


@pytest.mark.asyncio
async def test_get_meta(client):
    with _patch_meta():
        resp = await client.get("/v2/patients/meta")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["batchId"] == "test_batch"
    assert data["patientCount"] == 1


@pytest.mark.asyncio
async def test_list_patients(client):
    with _patch_meta(), _patch_store("list_patients", [_MOCK_PATIENT]):
        resp = await client.get("/v2/patients")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["pagination"]["total"] == 1
    p = data["patients"][0]
    assert p["id"] == "P001"
    assert p["name"] == "測試病患"
    assert p["intubated"] is True
    # BMI auto-calculated
    assert p["bmi"] is not None


@pytest.mark.asyncio
async def test_list_patients_search(client):
    with _patch_meta(), _patch_store("list_patients", [_MOCK_PATIENT]):
        resp = await client.get("/v2/patients", params={"search": "測試"})
    assert resp.status_code == 200
    assert resp.json()["data"]["pagination"]["total"] == 1


@pytest.mark.asyncio
async def test_list_patients_search_no_match(client):
    with _patch_meta(), _patch_store("list_patients", [_MOCK_PATIENT]):
        resp = await client.get("/v2/patients", params={"search": "不存在"})
    assert resp.status_code == 200
    assert resp.json()["data"]["pagination"]["total"] == 0


@pytest.mark.asyncio
async def test_list_patients_filter_intubated(client):
    with _patch_meta(), _patch_store("list_patients", [_MOCK_PATIENT]):
        resp = await client.get("/v2/patients", params={"intubated": "true"})
    assert resp.status_code == 200
    assert resp.json()["data"]["pagination"]["total"] == 1

    with _patch_meta(), _patch_store("list_patients", [_MOCK_PATIENT]):
        resp = await client.get("/v2/patients", params={"intubated": "false"})
    assert resp.json()["data"]["pagination"]["total"] == 0


@pytest.mark.asyncio
async def test_list_patients_filter_department(client):
    with _patch_meta(), _patch_store("list_patients", [_MOCK_PATIENT]):
        resp = await client.get("/v2/patients", params={"department": "icu"})
    assert resp.json()["data"]["pagination"]["total"] == 1


@pytest.mark.asyncio
async def test_list_patients_pagination(client):
    patients = [{**_MOCK_PATIENT, "patientId": f"P{str(i).zfill(3)}", "medicalRecordNumber": f"MRN{i}"} for i in range(5)]
    with _patch_meta(), _patch_store("list_patients", patients):
        resp = await client.get("/v2/patients", params={"page": 1, "limit": 2})
    data = resp.json()["data"]
    assert data["pagination"]["total"] == 5
    assert data["pagination"]["totalPages"] == 3
    assert len(data["patients"]) == 2


@pytest.mark.asyncio
async def test_get_patient(client):
    with _patch_meta(), _patch_store("get_patient", _MOCK_PATIENT):
        resp = await client.get("/v2/patients/P001")
    assert resp.status_code == 200
    assert resp.json()["data"]["id"] == "P001"


@pytest.mark.asyncio
async def test_get_patient_not_found(client):
    with _patch_meta(), _patch_store("get_patient", None):
        resp = await client.get("/v2/patients/NOPE")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_latest_lab(client):
    with _patch_meta(), _patch_store("get_lab_latest", _MOCK_LAB):
        resp = await client.get("/v2/patients/P001/lab-data/latest")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["patientId"] == "P001"
    assert "biochemistry" in data


@pytest.mark.asyncio
async def test_get_latest_lab_none(client):
    with _patch_meta(), _patch_store("get_lab_latest", None):
        resp = await client.get("/v2/patients/P001/lab-data/latest")
    assert resp.status_code == 200
    assert resp.json().get("data") is None


@pytest.mark.asyncio
async def test_get_medications(client):
    with _patch_meta(), _patch_store("get_medications_current", _MOCK_MEDS):
        resp = await client.get("/v2/patients/P001/medications")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["medications"]) == 1
    assert data["medications"][0]["name"] == "Vancomycin"
    assert "grouped" in data


@pytest.mark.asyncio
async def test_get_medications_none(client):
    with _patch_meta(), _patch_store("get_medications_current", None):
        resp = await client.get("/v2/patients/P001/medications")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["medications"] == []


@pytest.mark.asyncio
async def test_get_medication_by_id(client):
    with _patch_meta(), _patch_store("get_medications_current", _MOCK_MEDS):
        resp = await client.get("/v2/patients/P001/medications/med_001")
    assert resp.status_code == 200
    assert resp.json()["data"]["id"] == "med_001"


@pytest.mark.asyncio
async def test_get_medication_not_found(client):
    with _patch_meta(), _patch_store("get_medications_current", _MOCK_MEDS):
        resp = await client.get("/v2/patients/P001/medications/nope")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_cultures(client):
    with _patch_meta(), _patch_store("get_culture_susceptibility", _MOCK_CULTURE):
        resp = await client.get("/v2/patients/P001/cultures")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["cultureCount"] == 1


@pytest.mark.asyncio
async def test_get_cultures_none(client):
    with _patch_meta(), _patch_store("get_culture_susceptibility", None):
        resp = await client.get("/v2/patients/P001/cultures")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["cultureCount"] == 0


@pytest.mark.asyncio
async def test_medication_administrations_empty(client):
    with _patch_meta():
        resp = await client.get("/v2/patients/P001/medications/med_001/administrations")
    assert resp.status_code == 200
    assert resp.json()["data"] == []
