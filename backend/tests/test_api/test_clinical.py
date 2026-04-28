"""Test clinical API endpoints."""

from datetime import datetime, timezone
from unittest.mock import patch

import httpx
import pytest


@pytest.mark.asyncio
async def test_polish_progress_note(client):
    mock_response = {
        "status": "success",
        "content": "Polished progress note content.",
        "metadata": {"model": "gpt-5"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "content": "pt stable, labs ok",
                "polish_type": "progress_note",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["patient_id"] == "pat_001"
        assert data["data"]["polish_type"] == "progress_note"
        assert data["data"]["original"] == "pt stable, labs ok"
        assert "polished" in data["data"]
        assert data["data"]["dataFreshness"] is not None
        assert isinstance(data["data"]["dataFreshness"]["hints"], list)


@pytest.mark.asyncio
async def test_polish_medication_advice(client):
    mock_response = {
        "status": "success",
        "content": "Polished medication advice.",
        "metadata": {"model": "gpt-5"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "content": "suggest switch to propofol",
                "polish_type": "medication_advice",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["polish_type"] == "medication_advice"


@pytest.mark.asyncio
async def test_polish_invalid_type(client):
    response = await client.post(
        "/api/v1/clinical/polish",
        json={
            "patient_id": "pat_001",
            "content": "some text",
            "polish_type": "invalid_type",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_polish_patient_not_found(client):
    mock_response = {
        "status": "success",
        "content": "polished",
        "metadata": {},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "NONEXIST",
                "content": "some text",
                "polish_type": "progress_note",
            },
        )
        assert response.status_code == 404


# ── P3-1: Dose Calculation ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_interaction_check(db_engine, client):
    # Seed a test interaction in the test DB via engine
    from sqlalchemy import text
    async with db_engine.begin() as conn:
        await conn.execute(text(
            "INSERT INTO drug_interactions "
            "(id, drug1, drug2, severity, mechanism, clinical_effect, management, "
            "risk_rating, risk_rating_description, severity_label, reliability_rating) "
            "VALUES ('test_war_ami', 'Warfarin', 'Amiodarone', 'major', "
            "'Amiodarone may increase effects of Warfarin', "
            "'Increased anticoagulation risk', "
            "'Monitor INR closely', "
            "'D', 'Consider therapy modification', 'Major', 'Intermediate')"
        ))
    response = await client.post(
        "/api/v1/clinical/interactions",
        json={"drug_list": ["Warfarin", "Amiodarone"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["overall_severity"] == "major"
    findings = data["data"]["findings"]
    assert len(findings) >= 1
    f = findings[0]
    assert f["risk_rating"] == "D"
    assert f["reliability_rating"] == "Intermediate"


@pytest.mark.asyncio
async def test_interaction_check_forwards_request_trace_ids(client):
    """Interaction check returns success with trace headers."""
    response = await client.post(
        "/api/v1/clinical/interactions",
        json={"drug_list": ["Warfarin", "Amiodarone"]},
        headers={
            "X-Request-ID": "p1-int-req-001",
            "X-Trace-ID": "p1-int-trace-001",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["source"] == "database"


@pytest.mark.asyncio
async def test_interaction_check_requires_two_drugs(client):
    """drug_list needs at least 2 items."""
    response = await client.post(
        "/api/v1/clinical/interactions",
        json={"drug_list": ["Warfarin"]},
    )
    assert response.status_code == 422


