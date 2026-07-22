"""Test clinical scores (Pain / RASS) API endpoints."""

from datetime import datetime, timezone

import pytest

from app.fhir.his.roc_time import _gen_id
from app.models.clinical_score import ClinicalScore
from app.models.patient import Patient


@pytest.mark.asyncio
async def test_get_latest_scores_empty(client):
    resp = await client.get("/patients/pat_001/scores/latest")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["data"]["pain"] is None
    assert data["data"]["rass"] is None
    assert data["data"]["painOwnership"] == "orphan"


@pytest.mark.asyncio
async def test_post_pain_score(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    score = data["data"]
    assert score["scoreType"] == "pain"
    assert score["value"] == 5
    assert score["patientId"] == "pat_001"
    assert score["recordedBy"] == "usr_test"
    assert score["timestamp"] is not None


@pytest.mark.asyncio
async def test_post_rass_score(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "rass", "value": -2},
    )
    assert resp.status_code == 200
    score = resp.json()["data"]
    assert score["scoreType"] == "rass"
    assert score["value"] == -2


@pytest.mark.asyncio
async def test_post_pain_score_with_notes(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 7, "notes": "patient grimacing"},
    )
    assert resp.status_code == 200
    score = resp.json()["data"]
    assert score["value"] == 7
    assert score["notes"] == "patient grimacing"


@pytest.mark.asyncio
async def test_post_pain_score_boundary_zero(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 0},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["value"] == 0


@pytest.mark.asyncio
async def test_post_pain_score_boundary_ten(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 10},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["value"] == 10


@pytest.mark.asyncio
async def test_post_rass_score_boundary_minus5(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "rass", "value": -5},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["value"] == -5


@pytest.mark.asyncio
async def test_post_rass_score_boundary_plus4(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "rass", "value": 4},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["value"] == 4


@pytest.mark.asyncio
async def test_post_pain_score_out_of_range_high(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 11},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_post_pain_score_out_of_range_negative(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": -1},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_post_rass_score_out_of_range_high(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "rass", "value": 5},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_post_rass_score_out_of_range_low(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "rass", "value": -6},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_invalid_score_type(client):
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "invalid", "value": 5},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_latest_after_post(client):
    # Post two pain scores
    await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 3},
    )
    await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 7},
    )
    # Post one rass
    await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "rass", "value": -1},
    )

    resp = await client.get("/patients/pat_001/scores/latest")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["pain"]["value"] == 7  # latest
    assert data["rass"]["value"] == -1
    assert data["painOwnership"] == "orphan"


@pytest.mark.asyncio
async def test_get_trends(client):
    for v in [2, 5, 8]:
        await client.post(
            "/patients/pat_001/scores",
            json={"score_type": "pain", "value": v},
        )

    resp = await client.get(
        "/patients/pat_001/scores/trends",
        params={"score_type": "pain"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["scoreType"] == "pain"
    trends = data["trends"]
    assert len(trends) == 3
    # Chronological order (asc)
    assert trends[0]["value"] == 2
    assert trends[1]["value"] == 5
    assert trends[2]["value"] == 8


@pytest.mark.asyncio
async def test_get_trends_missing_score_type(client):
    resp = await client.get("/patients/pat_001/scores/trends")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_delete_score(client):
    # Create a score
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "pain", "value": 6},
    )
    assert resp.status_code == 200
    score_id = resp.json()["data"]["id"]

    # Delete it
    resp = await client.delete(f"/patients/pat_001/scores/{score_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["deleted"] == score_id


@pytest.mark.asyncio
async def test_delete_score_not_found(client):
    resp = await client.delete("/patients/pat_001/scores/nonexistent-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_his_pain_score_cannot_be_entered_or_deleted(client, db_session):
    mrn = "99999002"
    patient_id = _gen_id("pat", mrn)
    db_session.add(Patient(
        id=patient_id,
        name="HIS 病人",
        bed_number="I-2",
        medical_record_number=mrn,
        age=70,
        gender="男",
        diagnosis="測試",
        intubated=False,
        ventilator_days=0,
    ))
    score_id = "score_his_pain_test"
    db_session.add(ClinicalScore(
        id=score_id,
        patient_id=patient_id,
        score_type="pain",
        value=4,
        timestamp=datetime.now(timezone.utc),
        recorded_by="HIS",
    ))
    await db_session.commit()

    latest_resp = await client.get(f"/patients/{patient_id}/scores/latest")
    assert latest_resp.status_code == 200
    assert latest_resp.json()["data"]["painOwnership"] == "auto"

    create_resp = await client.post(
        f"/patients/{patient_id}/scores",
        json={"score_type": "pain", "value": 5},
    )
    assert create_resp.status_code == 409

    trends_resp = await client.get(
        f"/patients/{patient_id}/scores/trends",
        params={"score_type": "pain"},
    )
    his_score = trends_resp.json()["data"]["trends"][0]
    assert his_score["sourceType"] == "his"
    assert his_score["editable"] is False

    delete_resp = await client.delete(f"/patients/{patient_id}/scores/{score_id}")
    assert delete_resp.status_code == 409


@pytest.mark.asyncio
async def test_his_patient_without_his_pain_record_can_enter_orphan_value(
    client, db_session,
):
    mrn = "99999003"
    patient_id = _gen_id("pat", mrn)
    db_session.add(Patient(
        id=patient_id,
        name="尚無 HIS 疼痛資料",
        bed_number="I-3",
        medical_record_number=mrn,
        age=65,
        gender="女",
        diagnosis="測試",
        intubated=False,
        ventilator_days=0,
    ))
    await db_session.commit()

    response = await client.post(
        f"/patients/{patient_id}/scores",
        json={"score_type": "pain", "value": 3},
    )
    assert response.status_code == 200
    assert response.json()["data"]["sourceType"] == "manual"
    assert response.json()["data"]["editable"] is True


@pytest.mark.asyncio
async def test_delete_removes_from_latest(client):
    # Post a score then delete it — latest should be empty
    resp = await client.post(
        "/patients/pat_001/scores",
        json={"score_type": "rass", "value": -3},
    )
    score_id = resp.json()["data"]["id"]

    await client.delete(f"/patients/pat_001/scores/{score_id}")

    resp = await client.get("/patients/pat_001/scores/latest")
    assert resp.json()["data"]["rass"] is None


@pytest.mark.asyncio
async def test_patient_not_found(client):
    resp = await client.get("/patients/NONEXIST/scores/latest")
    assert resp.status_code == 404
