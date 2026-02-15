"""Test clinical API endpoints."""

from unittest.mock import patch

import pytest


@pytest.mark.asyncio
async def test_clinical_summary(client):
    mock_response = {
        "status": "success",
        "content": "Clinical summary for pat_001.",
        "metadata": {"model": "gpt-4o"},
    }
    with patch("app.routers.clinical.generate_clinical_summary", return_value={"summary": "test", "metadata": {}}):
        response = await client.post("/api/v1/clinical/summary", json={"patient_id": "pat_001"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True


@pytest.mark.asyncio
async def test_clinical_summary_not_found(client):
    response = await client.post("/api/v1/clinical/summary", json={"patient_id": "NONEXIST"})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_guideline_interpretation(client):
    mock_response = {
        "status": "success",
        "content": "Based on PADIS guidelines, recommend reducing sedation.",
        "metadata": {"model": "gpt-4o"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/guideline",
            json={
                "patient_id": "pat_001",
                "scenario": "Patient on continuous Midazolam infusion for 3 days",
                "guideline_topic": "sedation management",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["patient_id"] == "pat_001"
        assert "interpretation" in data["data"]


@pytest.mark.asyncio
async def test_guideline_not_found(client):
    response = await client.post(
        "/api/v1/clinical/guideline",
        json={"patient_id": "NONEXIST", "scenario": "test"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_multi_agent_decision(client):
    mock_response = {
        "status": "success",
        "content": "Recommend switching from Midazolam to Propofol.",
        "metadata": {"model": "gpt-4o"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/decision",
            json={
                "patient_id": "pat_001",
                "question": "Should we switch sedation agents?",
                "assessments": [
                    {"agent": "pharmacist", "opinion": "Midazolam accumulation risk"},
                ],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "recommendation" in data["data"]


@pytest.mark.asyncio
async def test_decision_not_found(client):
    response = await client.post(
        "/api/v1/clinical/decision",
        json={"patient_id": "NONEXIST", "question": "test"},
    )
    assert response.status_code == 404
