"""Test RAG API endpoints."""

import math
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.config import settings

_EMBED_PATCH = "app.services.llm_services.rag_service.embed_texts"


def _mock_embed_texts(texts):
    """Generate deterministic mock embeddings via word hashing (no API key needed).

    Words are hashed to specific vector dimensions so texts sharing words
    produce similar vectors — enabling meaningful cosine similarity in tests.
    """
    dim = 256
    embeddings = []
    for text in texts:
        vec = [0.0] * dim
        for word in text.lower().split():
            # Deterministic hash per word (consistent across runs)
            h = 0
            for ch in word:
                h = (h * 31 + ord(ch)) % dim
            vec[h] += 1.0
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        embeddings.append(vec)
    return embeddings


@pytest.mark.asyncio
async def test_rag_status(client):
    response = await client.get("/api/v1/rag/status")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "is_indexed" in data["data"]


@pytest.mark.asyncio
async def test_rag_query_not_indexed(client):
    # Force local RAG fallback by disabling hybrid evidence_client
    with patch("app.routers.rag.evidence_client") as mock_ec:
        mock_ec.query.side_effect = Exception("func/ unavailable in test")
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
    # Force local RAG fallback by disabling hybrid evidence_client
    with patch("app.routers.rag.evidence_client") as mock_ec:
        mock_ec.ingest.side_effect = Exception("func/ unavailable in test")
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

    mock_llm_result = {
        "status": "success",
        "content": "Sedation management requires monitoring.",
        "metadata": {"model": "test"},
    }

    # Force local RAG fallback by disabling hybrid evidence_client
    with patch("app.routers.rag.evidence_client") as mock_ec, \
         patch(_EMBED_PATCH, side_effect=_mock_embed_texts), \
         patch("app.services.llm_services.rag_service.call_llm", return_value=mock_llm_result):
        mock_ec.ingest.side_effect = Exception("func/ unavailable in test")
        mock_ec.query.side_effect = Exception("func/ unavailable in test")
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


# ── Reranker unit tests ──


def _make_passages(n: int) -> list:
    """Helper to create mock passage dicts."""
    return [
        {
            "doc_id": f"doc_{i}",
            "text": f"Passage {i} about ICU sedation management protocol {i}",
            "score": 0.9 - i * 0.05,
            "chunk_index": i,
            "category": "test",
        }
        for i in range(n)
    ]


def test_rerank_raises_without_api_key(monkeypatch):
    """Reranking raises RuntimeError when OPENAI_API_KEY is empty."""
    from app.llm import rerank_passages

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")

    passages = _make_passages(6)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY is not set"):
        rerank_passages("query", passages, top_k=3)


def test_rerank_noop_when_fewer_than_top_k():
    """Reranking is a no-op when candidates <= top_k."""
    from app.llm import rerank_passages

    passages = _make_passages(3)
    result = rerank_passages("query", passages, top_k=5)

    assert len(result) == 3
    assert result[0]["doc_id"] == "doc_0"


# ── BM25 unit tests ──


def test_bm25_scores_matching_terms():
    """BM25 should score documents with query terms higher."""
    from app.services.llm_services.rag_service import BM25

    bm25 = BM25()
    docs = [
        "sedation management in ICU patients",
        "nutrition guidelines for elderly care",
        "daily sedation interruption protocol",
    ]
    bm25.fit(docs)
    scores = bm25.score("sedation protocol")

    # Doc 0 and Doc 2 mention "sedation", Doc 2 also has "protocol"
    assert scores[2] > scores[1]  # "sedation protocol" > "nutrition..."
    assert scores[0] > scores[1]  # "sedation..." > "nutrition..."


def test_bm25_empty_query():
    """BM25 returns zero scores for empty query."""
    from app.services.llm_services.rag_service import BM25

    bm25 = BM25()
    bm25.fit(["some document text"])
    scores = bm25.score("")
    assert scores[0] == 0.0


# ── Metadata filter tests ──


def test_metadata_filter_returns_empty_for_no_match(monkeypatch):
    """Category filter returns empty when no chunks match."""
    from app.services.llm_services.rag_service import RAGService

    monkeypatch.setattr(settings, "RAG_HYBRID_ENABLED", False)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc = RAGService()
    svc.chunks = [
        {"doc_id": "d1", "text": "Sedation protocol", "chunk_index": 0, "category": "sedation"},
    ]

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts):
        svc.index()
        results = svc.retrieve("sedation", top_k=3, category_filter=["nonexistent"])
    assert len(results) == 0


# ── Chunk quality tests ──


def test_chunk_defaults_are_800_tokens():
    """Default chunk size should be ~800 tokens (2400 chars)."""
    from app.services.data_services.text_chunker import DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE

    assert DEFAULT_CHUNK_SIZE == 2400  # ~800 tokens at 3 chars/token
    assert DEFAULT_CHUNK_OVERLAP == 384  # ~128 tokens


def test_section_heading_splitting():
    """Chunker should split on section headings for semantic coherence."""
    from app.services.data_services.text_chunker import chunk_text

    text = (
        "# Introduction\n\n"
        "This is the introduction paragraph about ICU care.\n\n"
        "## Sedation Management\n\n"
        "Sedation requires careful monitoring of patients.\n\n"
        "## Ventilator Weaning\n\n"
        "Weaning protocols should be followed daily."
    )
    chunks = chunk_text(text, chunk_size=200, chunk_overlap=0)
    # Should produce at least 2 chunks split by headings
    assert len(chunks) >= 2


# ── Embedding model config test ──


def test_embedding_model_is_large():
    """Embedding model should be text-embedding-3-large."""
    assert settings.OPENAI_EMBEDDING_MODEL == "text-embedding-3-large"


# ── Chinese tokenization tests (jieba) ──


def test_bm25_chinese_tokenization():
    """BM25 should tokenize Chinese text into meaningful words, not individual chars."""
    from app.services.llm_services.rag_service import BM25, _tokenize

    tokens = _tokenize("鎮靜深度評估指引")
    assert any(len(t) > 1 for t in tokens), f"Expected multi-char Chinese tokens, got: {tokens}"

    bm25 = BM25()
    docs = [
        "鎮靜深度評估需要使用RASS量表",
        "營養支持指引建議每日評估熱量需求",
        "鎮靜藥物包括Propofol和Midazolam",
    ]
    bm25.fit(docs)
    scores = bm25.score("鎮靜評估")
    assert scores[0] > scores[1], "Doc with '鎮靜' + '評估' should outscore nutrition doc"


def test_tokenize_english_unchanged():
    """English tokenization should remain unchanged after jieba integration."""
    from app.services.llm_services.rag_service import _tokenize

    tokens = _tokenize("Sedation management protocol for ICU patients")
    assert "sedation" in tokens
    assert "management" in tokens
    assert "protocol" in tokens


def test_tokenize_mixed_chinese_english():
    """Mixed Chinese/English text should be tokenized correctly."""
    from app.services.llm_services.rag_service import _tokenize

    tokens = _tokenize("使用Propofol進行鎮靜")
    assert "propofol" in [t.lower() for t in tokens]
    chinese_tokens = [t for t in tokens if any('\u4e00' <= c <= '\u9fff' for c in t)]
    assert any(len(t) > 1 for t in chinese_tokens)


# ── Index persistence tests ──


# ── Source fingerprint tests ──


def test_source_fingerprint_detects_changes(tmp_path):
    """Source fingerprint should change when documents are added/modified."""
    from app.services.llm_services.rag_service import RAGService

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "doc1.txt").write_text("Original content")

    svc = RAGService()
    fp1 = svc._compute_source_fingerprint(str(docs_dir))
    assert fp1

    fp2 = svc._compute_source_fingerprint(str(docs_dir))
    assert fp1 == fp2

    (docs_dir / "doc1.txt").write_text("Modified content")
    fp3 = svc._compute_source_fingerprint(str(docs_dir))
    assert fp1 != fp3

    (docs_dir / "doc2.txt").write_text("New document")
    fp4 = svc._compute_source_fingerprint(str(docs_dir))
    assert fp3 != fp4


# ── Contextual Retrieval tests removed 2026-04-14 (stale: referenced
#    RAGIndexStore + generate_chunk_context which were removed during a
#    prior rag_service refactor; tests had been failing in CI for weeks)
