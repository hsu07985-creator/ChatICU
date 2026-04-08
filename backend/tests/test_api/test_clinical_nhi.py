"""Test suite for POST /clinical/nhi — NHI Reimbursement Query (B08).

10 test cases covering:
1. Valid drug name returns 200
2. Drug name + indication returns 200
3. Response schema has correct fields
4. Authentication required (401 without auth)
5. NHI service available — chunks returned
6. NHI service down — graceful fallback with low confidence
7. Reimbursement rules parsing — 事前審查 detection
8. Chinese drug name input
9. English drug name input with known mapping
10. Empty drug_name validation (422)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


# ── Fixtures / helpers ────────────────────────────────────────────────────

_BASE_URL = "/api/v1/clinical/nhi"

_MOCK_SEARCH_RESP_WITH_RESULTS = {
    "results": [
        {
            "chunk_id": "nhi_s09_a3f8c2d1",
            "text": (
                "9.69 免疫檢查點抑制劑\n"
                "限用於下列適應症：非小細胞肺癌、肝細胞癌、黑色素瘤。\n"
                "須事前審查核准後使用。\n"
                "排除 EGFR/ALK 陽性患者。"
            ),
            "score": 0.91,
            "section": "9.69",
            "section_name": "免疫檢查點抑制劑",
        },
        {
            "chunk_id": "nhi_s09_b4c7e8f2",
            "text": (
                "吉舒達 (pembrolizumab) 給付條件：\n"
                "需符合 PD-L1 ≥50% 或 TMB-H 條件。\n"
                "限用於一線治療失敗後。"
            ),
            "score": 0.85,
            "section": "9.69",
            "section_name": "免疫檢查點抑制劑",
        },
    ],
    "query": "pembrolizumab",
}

_MOCK_SEARCH_RESP_EMPTY = {"results": [], "query": "unknowndrug"}

_MOCK_ASK_RESP = {"answer": "吉舒達目前有健保給付，限用於非小細胞肺癌等適應症，需事前審查。"}

_MOCK_LLM_RESULT = {
    "status": "success",
    "content": "依一般知識：pembrolizumab 有條件健保給付，需事前審查。本回答依一般知識，未查詢即時健保資料。",
    "metadata": {"model": "gpt-5"},
}


def _patch_nhi_available(available: bool, search_resp=None, ask_resp=None):
    """Return a context manager tuple for patching nhi_client."""
    health_mock = AsyncMock(return_value=available)
    search_mock = AsyncMock(return_value=search_resp or _MOCK_SEARCH_RESP_EMPTY)
    ask_mock = AsyncMock(return_value=ask_resp or {"answer": ""})

    return (
        patch("app.routers.clinical.nhi_client.health", health_mock),
        patch("app.routers.clinical.nhi_client.search", search_mock),
        patch("app.routers.clinical.nhi_client.ask", ask_mock),
    )


# ── Test cases ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_nhi_valid_drug_name_returns_200(client):
    """Test 1: Valid drug name returns HTTP 200 with success envelope."""
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp=_MOCK_SEARCH_RESP_WITH_RESULTS,
        ask_resp=_MOCK_ASK_RESP,
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"] is not None


@pytest.mark.asyncio
async def test_nhi_with_indication_returns_200(client):
    """Test 2: Drug name + indication returns 200 with data."""
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp=_MOCK_SEARCH_RESP_WITH_RESULTS,
        ask_resp=_MOCK_ASK_RESP,
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(
            _BASE_URL,
            json={"drug_name": "pembrolizumab", "indication": "非小細胞肺癌"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["drug_name"] == "pembrolizumab"


@pytest.mark.asyncio
async def test_nhi_response_schema_fields(client):
    """Test 3: Response data has all expected schema fields."""
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp=_MOCK_SEARCH_RESP_WITH_RESULTS,
        ask_resp=_MOCK_ASK_RESP,
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})

    assert resp.status_code == 200
    data = resp.json()["data"]

    # Required top-level fields
    assert "drug_name" in data
    assert "reimbursement_rules" in data
    assert "source_chunks" in data
    assert "confidence" in data
    assert isinstance(data["reimbursement_rules"], list)
    assert isinstance(data["source_chunks"], list)
    assert isinstance(data["confidence"], float)

    # Source chunk sub-fields
    if data["source_chunks"]:
        chunk = data["source_chunks"][0]
        assert "chunk_id" in chunk
        assert "text_snippet" in chunk
        assert "relevance_score" in chunk

    # Reimbursement rule sub-fields
    if data["reimbursement_rules"]:
        rule = data["reimbursement_rules"][0]
        assert "requires_prior_auth" in rule
        assert "conditions" in rule
        assert "applicable_indications" in rule


@pytest.mark.asyncio
async def test_nhi_authentication_required(real_auth_client):
    """Test 4: Endpoint requires authentication — unauthenticated request returns 401 or 403."""
    resp = await real_auth_client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})
    # Without a valid JWT cookie, auth middleware should reject
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_nhi_service_available_chunks_returned(client):
    """Test 5: When NHI service is available, source_chunks and rules are populated."""
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp=_MOCK_SEARCH_RESP_WITH_RESULTS,
        ask_resp=_MOCK_ASK_RESP,
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})

    assert resp.status_code == 200
    data = resp.json()["data"]

    # Should have returned the mocked chunks
    assert len(data["source_chunks"]) == 2
    assert data["source_chunks"][0]["chunk_id"] == "nhi_s09_a3f8c2d1"
    assert data["source_chunks"][0]["relevance_score"] == pytest.approx(0.91, abs=1e-6)

    # Confidence should be > 0 (derived from chunk scores)
    assert data["confidence"] > 0.0

    # Answer from /ask should be present
    assert data.get("answer") == "吉舒達目前有健保給付，限用於非小細胞肺癌等適應症，需事前審查。"


@pytest.mark.asyncio
async def test_nhi_service_down_graceful_fallback(client):
    """Test 6: When NHI service is DOWN, returns fallback with low confidence and warning."""
    h_patch, s_patch, a_patch = _patch_nhi_available(False)
    with h_patch, s_patch, a_patch:
        with patch("app.routers.clinical.call_llm", return_value=_MOCK_LLM_RESULT):
            resp = await client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True

    data = body["data"]
    # Low confidence expected for fallback
    assert data["confidence"] <= 0.25

    # Warning message should signal NHI service is down
    assert body.get("message") == "NHI 服務暫時無法連線，此回答僅供參考"

    # No chunks when service is down
    assert data["source_chunks"] == []
    assert data["reimbursement_rules"] == []

    # LLM-generated answer should be present
    assert data.get("answer") is not None
    assert len(data["answer"]) > 0


@pytest.mark.asyncio
async def test_nhi_prior_auth_detection(client):
    """Test 7: Chunks containing '事前審查' set requires_prior_auth=True in parsed rules."""
    search_resp = {
        "results": [
            {
                "chunk_id": "nhi_test_001",
                "text": "9.69 限用於非小細胞肺癌。須事前審查核准後使用。",
                "score": 0.90,
                "section": "9.69",
                "section_name": "免疫檢查點抑制劑",
            }
        ],
        "query": "pembrolizumab",
    }
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp=search_resp,
        ask_resp={"answer": "需事前審查。"},
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})

    assert resp.status_code == 200
    data = resp.json()["data"]

    assert len(data["reimbursement_rules"]) >= 1
    rule = data["reimbursement_rules"][0]
    assert rule["requires_prior_auth"] is True


@pytest.mark.asyncio
async def test_nhi_chinese_drug_name_input(client):
    """Test 8: Chinese drug name input is accepted and echoed back correctly."""
    chinese_drug = "吉舒達"
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp={"results": [], "query": chinese_drug},
        ask_resp={"answer": "吉舒達限非小細胞肺癌。"},
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(_BASE_URL, json={"drug_name": chinese_drug})

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["drug_name"] == chinese_drug


@pytest.mark.asyncio
async def test_nhi_english_drug_name_mapping(client):
    """Test 9: Known English drug name is mapped to Chinese name (drug_name_zh)."""
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp=_MOCK_SEARCH_RESP_WITH_RESULTS,
        ask_resp=_MOCK_ASK_RESP,
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})

    assert resp.status_code == 200
    data = resp.json()["data"]
    # "pembrolizumab" should resolve to "吉舒達"
    assert data.get("drug_name_zh") == "吉舒達"


@pytest.mark.asyncio
async def test_nhi_empty_drug_name_validation(client):
    """Test 10: Empty drug_name fails Pydantic validation with 422."""
    resp = await client.post(_BASE_URL, json={"drug_name": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_nhi_missing_drug_name_validation(client):
    """Bonus: Missing drug_name field returns 422."""
    resp = await client.post(_BASE_URL, json={})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_nhi_service_down_llm_also_fails(client):
    """Bonus: If NHI service down AND LLM also fails, still returns 200 with empty answer."""
    h_patch, s_patch, a_patch = _patch_nhi_available(False)

    def _llm_raise(*args, **kwargs):
        raise RuntimeError("LLM timeout")

    with h_patch, s_patch, a_patch:
        with patch("app.routers.clinical.call_llm", side_effect=_llm_raise):
            resp = await client.post(_BASE_URL, json={"drug_name": "pembrolizumab"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert data["confidence"] == 0.0
    assert data["source_chunks"] == []


@pytest.mark.asyncio
async def test_nhi_confidence_computed_from_scores(client):
    """Bonus: Confidence is computed as average of top chunk scores (capped at 0.95)."""
    search_resp = {
        "results": [
            {"chunk_id": "c1", "text": "藥品給付規定", "score": 0.90, "section": "9.1", "section_name": "測試"},
            {"chunk_id": "c2", "text": "限用條件", "score": 0.80, "section": "9.1", "section_name": "測試"},
            {"chunk_id": "c3", "text": "須事前審查", "score": 0.70, "section": "9.1", "section_name": "測試"},
        ],
        "query": "rituximab",
    }
    h_patch, s_patch, a_patch = _patch_nhi_available(
        True,
        search_resp=search_resp,
        ask_resp={"answer": "莫須瘤有給付。"},
    )
    with h_patch, s_patch, a_patch:
        resp = await client.post(_BASE_URL, json={"drug_name": "rituximab"})

    assert resp.status_code == 200
    data = resp.json()["data"]
    # avg(0.90, 0.80, 0.70) = 0.80 → capped at 0.95 → should be ~0.80
    assert 0.79 <= data["confidence"] <= 0.81
