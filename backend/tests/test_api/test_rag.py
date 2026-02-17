"""Test RAG API endpoints."""

from unittest.mock import patch

import pytest


@pytest.mark.asyncio
async def test_rag_status(client):
    response = await client.get("/api/v1/rag/status")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "is_indexed" in data["data"]


@pytest.mark.asyncio
async def test_rag_query_not_indexed(client):
    response = await client.post(
        "/api/v1/rag/query",
        json={"question": "What is PADIS?"},
    )
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_rag_query_forwards_request_trace_ids(client):
    with patch("app.routers.rag.evidence_client") as mock_ec:
        mock_ec.query.return_value = {
            "answer": "PADIS recommendation ...",
            "citations": [],
            "confidence": 0.8,
        }
        response = await client.post(
            "/api/v1/rag/query",
            json={"question": "PADIS sedation guidance"},
            headers={
                "X-Request-ID": "p1-rag-req-001",
                "X-Trace-ID": "p1-rag-trace-001",
            },
        )
        assert response.status_code == 200
        kwargs = mock_ec.query.call_args.kwargs
        assert kwargs["request_id"] == "p1-rag-req-001"
        assert kwargs["trace_id"] == "p1-rag-trace-001"


@pytest.mark.asyncio
async def test_rag_query_rejects_when_evidence_below_threshold(client):
    with patch("app.routers.rag.evidence_client") as mock_ec:
        mock_ec.query.return_value = {
            "answer": "weak answer",
            "citations": [],
            "confidence": 0.1,
        }
        response = await client.post(
            "/api/v1/rag/query",
            json={"question": "Need source-backed recommendation"},
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["rejected"] is True
        assert payload["answer"] == ""
        assert payload["rejectedReason"] in {
            "EVIDENCE_NOT_FOUND",
            "INSUFFICIENT_CITATIONS",
            "LOW_CONFIDENCE",
        }
        assert payload["displayReason"]
        assert payload["metadata"]["evidence_gate"]["passed"] is False


@pytest.mark.asyncio
async def test_rag_query_returns_answer_when_evidence_gate_passes(client):
    with patch("app.routers.rag.evidence_client") as mock_ec:
        mock_ec.query.return_value = {
            "answer": "PADIS suggests daily sedation interruption.",
            "citations": [
                {
                    "source_file": "guidelines/padis.md",
                    "topic": "sedation",
                    "score": 0.92,
                    "snippet": "daily sedation interruption ...",
                }
            ],
            "confidence": 0.92,
        }
        response = await client.post(
            "/api/v1/rag/query",
            json={"question": "PADIS sedation guidance"},
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["rejected"] is False
        assert "PADIS suggests" in payload["answer"]
        assert payload["metadata"]["evidence_gate"]["passed"] is True
        assert payload["metadata"]["confidence"] >= 0.9


@pytest.mark.asyncio
async def test_rag_index_with_empty_dir(client, tmp_path):
    response = await client.post(
        "/api/v1/rag/index",
        json={"docs_path": str(tmp_path)},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["total_chunks"] == 0


@pytest.mark.asyncio
async def test_rag_index_and_query(client, tmp_path):
    # Create test documents
    cat_dir = tmp_path / "test_category"
    cat_dir.mkdir()
    (cat_dir / "doc1.txt").write_text("Sedation management in ICU patients requires careful monitoring.")
    (cat_dir / "doc2.txt").write_text("PADIS guidelines recommend daily sedation interruption.")

    # Index
    response = await client.post("/api/v1/rag/index", json={"docs_path": str(tmp_path)})
    assert response.status_code == 200
    assert response.json()["data"]["total_chunks"] >= 2

    # Query
    response = await client.post("/api/v1/rag/query", json={"question": "sedation management"})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "sources" in data["data"]
