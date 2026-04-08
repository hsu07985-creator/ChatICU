"""Test clinical scores (Pain / RASS) API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_get_latest_scores_empty(client):
    resp = await client.get("/patients/pat_001/scores/latest")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["data"]["pain"] is None
    assert data["data"]["rass"] is None


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
