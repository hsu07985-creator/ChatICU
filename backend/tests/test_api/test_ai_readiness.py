"""Tests for AI readiness gate endpoint (AO-01)."""

from unittest.mock import patch

import pytest

from app.config import settings


@pytest.mark.asyncio
async def test_ai_readiness_all_services_ready(client, monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-openai-key")

    with patch(
        "app.routers.ai_readiness.evidence_client.health",
        return_value={
            "status": "healthy",
            "clinical_rules_loaded": True,
            "index": {"total_chunks": 32, "total_documents": 6},
        },
    ):
        response = await client.get("/api/v1/ai/readiness")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["overall_ready"] is True
    assert data["llm"]["ready"] is True
    assert data["evidence"]["reachable"] is True
    assert data["rag"]["is_indexed"] is True
    assert data["feature_gates"]["chat"] is True
    assert data["feature_gates"]["clinical_summary"] is True
    assert data["feature_gates"]["guideline_interpretation"] is True
    assert data["feature_gates"]["decision_support"] is True
    assert data["feature_gates"]["clinical_polish"] is True
    assert data["feature_gates"]["dose_calculation"] is True
    assert data["blocking_reasons"] == []
    assert isinstance(data["checked_at"], str)


@pytest.mark.asyncio
async def test_ai_readiness_missing_llm_key_blocks_llm_features(client, monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")

    with patch(
        "app.routers.ai_readiness.evidence_client.health",
        return_value={
            "status": "healthy",
            "clinical_rules_loaded": True,
            "index": {"total_chunks": 18, "total_documents": 4},
        },
    ):
        response = await client.get("/api/v1/ai/readiness")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["overall_ready"] is False
    assert data["llm"]["ready"] is False
    assert data["llm"]["reason"] == "LLM_API_KEY_MISSING"
    assert data["feature_gates"]["clinical_summary"] is False
    assert data["feature_gates"]["patient_explanation"] is False
    assert data["feature_gates"]["clinical_polish"] is False
    assert data["feature_gates"]["dose_calculation"] is True
    assert "LLM_API_KEY_MISSING" in data["blocking_reasons"]


@pytest.mark.asyncio
async def test_ai_readiness_evidence_down_but_local_rag_available(client, monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-openai-key")

    with patch(
        "app.routers.ai_readiness.evidence_client.health",
        side_effect=RuntimeError("connection refused"),
    ), patch(
        "app.routers.ai_readiness.rag_service.get_status",
        return_value={"is_indexed": True, "total_chunks": 12, "total_documents": 3},
    ):
        response = await client.get("/api/v1/ai/readiness")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["overall_ready"] is False
    assert data["evidence"]["reachable"] is False
    assert data["rag"]["is_indexed"] is True
    assert data["rag"]["engine"] == "local_rag"
    assert data["feature_gates"]["chat"] is True
    assert data["feature_gates"]["guideline_interpretation"] is True
    assert data["feature_gates"]["dose_calculation"] is False
    assert "EVIDENCE_UNREACHABLE" in data["blocking_reasons"]
    assert "RAG_NOT_INDEXED" not in data["blocking_reasons"]


@pytest.mark.asyncio
async def test_ai_readiness_blocks_knowledge_features_when_evidence_and_rag_unavailable(client, monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-openai-key")

    with patch(
        "app.routers.ai_readiness.evidence_client.health",
        side_effect=RuntimeError("connection refused"),
    ), patch(
        "app.routers.ai_readiness.rag_service.get_status",
        return_value={"is_indexed": False, "total_chunks": 0, "total_documents": 0},
    ):
        response = await client.get("/api/v1/ai/readiness")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["overall_ready"] is False
    assert data["feature_gates"]["chat"] is False
    assert data["feature_gates"]["guideline_interpretation"] is False
    assert data["feature_gates"]["decision_support"] is False
    assert data["feature_gates"]["dose_calculation"] is False
    assert "EVIDENCE_UNREACHABLE" in data["blocking_reasons"]
    assert "RAG_NOT_INDEXED" in data["blocking_reasons"]
    assert "KNOWLEDGE_SOURCE_UNAVAILABLE" in data["blocking_reasons"]
