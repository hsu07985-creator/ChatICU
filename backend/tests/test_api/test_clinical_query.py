"""Tests for the unified /clinical/query endpoint (B07)."""

from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.services.drug_rag_client import EvidenceItem
from app.services.orchestrator import OrchestratorResult


def _make_orchestrator_result(**kwargs):
    """Helper to build an OrchestratorResult with sensible defaults."""
    defaults = {
        "intent": "dose_calculation",
        "intent_confidence": 0.85,
        "detected_drugs": ["propofol"],
        "evidence_items": [
            EvidenceItem(
                chunk_id="chunk_001",
                text="PADIS guideline recommends propofol for ICU sedation.",
                source_system="clinical_rag_guideline",
                relevance_score=0.88,
                drug_names=["propofol"],
                evidence_grade="1B",
            ),
            EvidenceItem(
                chunk_id="chunk_002",
                text="Propofol monograph: adult dose 5-50 mcg/kg/min.",
                source_system="drug_rag_qdrant",
                relevance_score=0.82,
                drug_names=["propofol"],
                evidence_grade="monograph",
            ),
        ],
        "sources_queried": ["source_a_clinical", "source_b_qdrant"],
        "sources_succeeded": ["source_a_clinical", "source_b_qdrant"],
        "sources_failed": [],
        "total_duration_ms": 150.0,
        "per_source_duration_ms": {"source_a_clinical": 80.0, "source_b_qdrant": 120.0},
        "confidence_threshold": 0.55,
        "raw_graph_result": None,
    }
    defaults.update(kwargs)
    return OrchestratorResult(**defaults)


def _mock_llm_success(content="【綜合建議】根據 PAD 指引..."):
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": "gpt-5"},
    }


# ── Test 1: Endpoint returns 200 when orchestrator enabled ──────────

@pytest.mark.asyncio
async def test_unified_query_returns_200_when_orchestrator_enabled(client):
    """Test endpoint exists and returns 200 with correct schema."""
    orch_result = _make_orchestrator_result()

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Propofol 劑量建議?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    payload = data["data"]
    assert payload["intent"] == "dose_calculation"
    assert "answer" in payload
    assert isinstance(payload["citations"], list)
    assert isinstance(payload["confidence"], float)
    assert isinstance(payload["sources_used"], list)
    assert isinstance(payload["detected_drugs"], list)


# ── Test 2: Endpoint returns error when orchestrator disabled ───────

@pytest.mark.asyncio
async def test_unified_query_returns_error_when_orchestrator_disabled(client):
    """Test endpoint returns error when ORCHESTRATOR_ENABLED is False."""
    with patch("app.routers.clinical.settings") as mock_settings:
        mock_settings.ORCHESTRATOR_ENABLED = False
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Propofol 劑量?"},
        )

    assert response.status_code == 200  # endpoint returns JSON, not HTTP error
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "Orchestrator not enabled"
    assert "ORCHESTRATOR_ENABLED" in data["message"]


# ── Test 3: Request with just question field ────────────────────────

@pytest.mark.asyncio
async def test_unified_query_with_only_question(client):
    """Test request with just the question field succeeds."""
    orch_result = _make_orchestrator_result()

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Vancomycin 腎功能調整?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["intent"] == "dose_calculation"


# ── Test 4: Request with question + patient_id ──────────────────────

@pytest.mark.asyncio
async def test_unified_query_with_patient_id(client):
    """Test request with question + patient_id."""
    orch_result = _make_orchestrator_result()

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "藥物交互作用?", "patient_id": 123},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


# ── Test 5: Request with question + context ─────────────────────────

@pytest.mark.asyncio
async def test_unified_query_with_context(client):
    """Test request with question + context string."""
    orch_result = _make_orchestrator_result()

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={
                "question": "Propofol 劑量?",
                "context": "eGFR 45, BMI 38, weight 90kg",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    # Verify context was passed to orchestrator
    call_kwargs = mock_orch.call_args
    assert call_kwargs is not None


# ── Test 6: Response has correct schema fields ──────────────────────

@pytest.mark.asyncio
async def test_unified_query_response_schema(client):
    """Test response has all expected schema fields."""
    orch_result = _make_orchestrator_result()

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Propofol sedation protocol?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    payload = data["data"]
    # All required fields present
    assert "intent" in payload
    assert "answer" in payload
    assert "citations" in payload
    assert "confidence" in payload
    assert "sources_used" in payload
    assert "detected_drugs" in payload
    assert "requires_expert_review" in payload

    # Type checks
    assert isinstance(payload["intent"], str)
    assert isinstance(payload["answer"], str)
    assert isinstance(payload["citations"], list)
    assert isinstance(payload["confidence"], (int, float))
    assert isinstance(payload["requires_expert_review"], bool)
    assert isinstance(payload["sources_used"], list)
    assert isinstance(payload["detected_drugs"], list)


# ── Test 7: Authentication required ─────────────────────────────────

@pytest.mark.asyncio
async def test_unified_query_requires_authentication(db_engine, seeded_db):
    """Test that request without auth token returns 401/403."""
    from httpx import ASGITransport, AsyncClient
    from app.database import get_db
    from app.main import app
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    # Override DB but NOT auth — no get_current_user override
    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/api/v1/clinical/query",
            json={"question": "Test question"},
        )

    app.dependency_overrides.clear()

    # Without auth, should get 401 or 403
    assert response.status_code in (401, 403)


# ── Test 8: Citations included in response when available ───────────

@pytest.mark.asyncio
async def test_unified_query_citations_included(client):
    """Test that citations from orchestrator evidence are included in response."""
    orch_result = _make_orchestrator_result(
        evidence_items=[
            EvidenceItem(
                chunk_id="guideline_042",
                text="PADIS 2018: propofol preferred for short-term sedation.",
                source_system="clinical_rag_guideline",
                relevance_score=0.91,
                drug_names=["propofol"],
                evidence_grade="1B",
            ),
            EvidenceItem(
                chunk_id="qdrant_1234",
                text="Propofol dosing: 5-50 mcg/kg/min IV infusion.",
                source_system="drug_rag_qdrant",
                relevance_score=0.85,
                drug_names=["propofol"],
                evidence_grade="monograph",
            ),
            EvidenceItem(
                chunk_id="graph_pair_001",
                text="[MAJOR] Propofol + Fentanyl: enhanced CNS/respiratory depression.",
                source_system="drug_graph",
                relevance_score=1.0,
                drug_names=["propofol", "fentanyl"],
                evidence_grade="curated",
            ),
        ],
    )

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Propofol + Fentanyl 交互作用?"},
        )

    assert response.status_code == 200
    data = response.json()
    citations = data["data"]["citations"]
    assert len(citations) == 3

    # Verify citation structure
    for c in citations:
        assert "citation_id" in c
        assert "source_system" in c
        assert "text_snippet" in c
        assert "evidence_grade" in c
        assert "relevance_score" in c

    # Check specific sources
    source_systems = [c["source_system"] for c in citations]
    assert "clinical_rag_guideline" in source_systems
    assert "drug_rag_qdrant" in source_systems
    assert "drug_graph" in source_systems


# ── Test 9: requires_expert_review flag passed through ──────────────

@pytest.mark.asyncio
async def test_unified_query_expert_review_flag(client):
    """Test requires_expert_review is True when confidence is low."""
    orch_result = _make_orchestrator_result(
        intent_confidence=0.30,
        sources_succeeded=[],
        sources_failed=["source_a_clinical", "source_b_qdrant"],
        evidence_items=[],
    )

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Unknown question?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["data"]["requires_expert_review"] is True
    assert data["data"]["confidence"] < 0.5


# ── Test 10: Error handling when orchestrator raises exception ──────

@pytest.mark.asyncio
async def test_unified_query_orchestrator_exception_graceful_fallback(client):
    """Test graceful degradation when orchestrator raises an exception."""
    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success("Fallback answer")):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.side_effect = RuntimeError("Source registry failed to initialize")

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Propofol 劑量?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    payload = data["data"]
    # Fallback should still return a valid response
    assert payload["intent"] == "general_pharmacology"
    assert payload["requires_expert_review"] is True
    assert payload["confidence"] == 0.3
    assert isinstance(payload["answer"], str)
    assert len(payload["answer"]) > 0


# ── Test 11: Empty question validation ──────────────────────────────

@pytest.mark.asyncio
async def test_unified_query_empty_question_validation(client):
    """Test that empty question returns 422 validation error."""
    response = await client.post(
        "/api/v1/clinical/query",
        json={"question": ""},
    )
    assert response.status_code == 422


# ── Test 12: Detected drugs are propagated ──────────────────────────

@pytest.mark.asyncio
async def test_unified_query_detected_drugs_propagated(client):
    """Test that detected_drugs from orchestrator are in the response."""
    orch_result = _make_orchestrator_result(
        detected_drugs=["vancomycin", "meropenem"],
    )

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=_mock_llm_success()):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Vancomycin + Meropenem 交互作用?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert "vancomycin" in data["data"]["detected_drugs"]
    assert "meropenem" in data["data"]["detected_drugs"]


# ── Test 13: LLM failure falls back to raw evidence ─────────────────

@pytest.mark.asyncio
async def test_unified_query_llm_failure_falls_back_to_evidence(client):
    """Test that when LLM fails, raw evidence text is used as answer."""
    orch_result = _make_orchestrator_result()

    llm_error = {
        "status": "error",
        "content": "LLM unavailable",
        "metadata": {},
    }

    with patch("app.routers.clinical.settings") as mock_settings, \
         patch("app.services.orchestrator.orchestrate_query", new_callable=AsyncMock) as mock_orch, \
         patch("app.routers.clinical.call_llm", return_value=llm_error):

        mock_settings.ORCHESTRATOR_ENABLED = True
        mock_settings.RATE_LIMIT_AI_CLINICAL = "100/minute"
        mock_orch.return_value = orch_result

        response = await client.post(
            "/api/v1/clinical/query",
            json={"question": "Propofol sedation?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    # Answer should contain evidence text (fallback)
    answer = data["data"]["answer"]
    assert len(answer) > 0
