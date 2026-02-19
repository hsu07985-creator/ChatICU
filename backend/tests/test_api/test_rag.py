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

    mock_llm_result = {
        "status": "success",
        "content": "Sedation management requires monitoring.",
        "metadata": {"model": "test"},
    }

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts), \
         patch("app.services.llm_services.rag_service.call_llm", return_value=mock_llm_result):
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


def test_rerank_reorders_by_llm_score(monkeypatch):
    """Reranker should reorder passages based on LLM relevance scores."""
    from app.llm import rerank_passages

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "RAG_RERANK_MODEL", "gpt-5-mini")

    passages = _make_passages(6)

    # LLM scores: passage 5 is most relevant, passage 0 is least
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "[1, 2, 3, 4, 5, 10]"

    with patch("openai.OpenAI") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = mock_response

        result = rerank_passages("sedation protocol", passages, top_k=3)

    assert len(result) == 3
    # Passage 5 (score=10) should be first
    assert result[0]["doc_id"] == "doc_5"
    assert result[0]["rerank_score"] == 10.0
    # Passage 4 (score=5) should be second
    assert result[1]["doc_id"] == "doc_4"


def test_rerank_raises_on_api_failure(monkeypatch):
    """When LLM call fails, exception propagates (no silent fallback)."""
    from app.llm import rerank_passages

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")

    passages = _make_passages(6)

    with patch("openai.OpenAI") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("API error")

        with pytest.raises(Exception, match="API error"):
            rerank_passages("sedation protocol", passages, top_k=3)


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


# ── Hybrid search tests ──


def test_hybrid_search_combines_vector_and_bm25(monkeypatch):
    """Hybrid search should combine vector and BM25 scores."""
    from app.services.llm_services.rag_service import RAGService

    monkeypatch.setattr(settings, "RAG_HYBRID_ENABLED", True)
    monkeypatch.setattr(settings, "RAG_BM25_WEIGHT", 0.3)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc = RAGService()
    svc.chunks = [
        {"doc_id": "d1", "text": "ICU sedation protocol guidelines", "chunk_index": 0, "category": "sedation"},
        {"doc_id": "d2", "text": "Nutrition support in critical care", "chunk_index": 0, "category": "nutrition"},
        {"doc_id": "d3", "text": "Ventilator weaning sedation assessment", "chunk_index": 0, "category": "sedation"},
    ]

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts):
        svc.index()
        assert svc.bm25 is not None

        results = svc.retrieve("sedation protocol", top_k=2)
    assert len(results) == 2
    # Both results should be sedation-related
    doc_ids = {r["doc_id"] for r in results}
    assert "d2" not in doc_ids  # nutrition doc should not be in top-2


# ── Metadata filter tests ──


def test_metadata_filter_restricts_categories(monkeypatch):
    """Category filter should exclude non-matching chunks."""
    from app.services.llm_services.rag_service import RAGService

    monkeypatch.setattr(settings, "RAG_HYBRID_ENABLED", False)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc = RAGService()
    svc.chunks = [
        {"doc_id": "d1", "text": "Sedation protocol for ICU", "chunk_index": 0, "category": "sedation"},
        {"doc_id": "d2", "text": "Sedation drug interactions", "chunk_index": 0, "category": "pharmacy"},
        {"doc_id": "d3", "text": "Ventilator settings guide", "chunk_index": 0, "category": "ventilator"},
    ]

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts):
        svc.index()
        # Filter to only pharmacy category
        results = svc.retrieve("sedation", top_k=3, category_filter=["pharmacy"])
    assert len(results) == 1
    assert results[0]["doc_id"] == "d2"


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


def test_rag_index_store_roundtrip(tmp_path):
    """RAGIndexStore should save and load index artifacts correctly."""
    from app.services.llm_services.rag_service import RAGIndexStore, BM25

    store = RAGIndexStore(str(tmp_path / "test_index"))
    assert not store.index_exists()

    embeddings = np.random.rand(3, 256).astype(np.float32)
    chunks = [
        {"doc_id": "d1", "text": "test chunk 1", "chunk_index": 0, "category": "test"},
        {"doc_id": "d2", "text": "test chunk 2", "chunk_index": 0, "category": "test"},
        {"doc_id": "d3", "text": "test chunk 3", "chunk_index": 0, "category": "test"},
    ]
    bm25 = BM25()
    bm25.fit([c["text"] for c in chunks])

    store.save(embeddings, chunks, bm25, "test_fingerprint_abc")
    assert store.index_exists()

    loaded_emb, loaded_chunks, loaded_bm25_state, loaded_meta = store.load()
    assert loaded_emb.shape == (3, 256)
    assert len(loaded_chunks) == 3
    assert loaded_meta["source_fingerprint"] == "test_fingerprint_abc"
    assert loaded_meta["total_chunks"] == 3

    restored_bm25 = BM25.from_state(loaded_bm25_state)
    assert restored_bm25.n_docs == 3
    scores = restored_bm25.score("test chunk")
    assert scores.sum() > 0


def test_rag_service_load_persisted(tmp_path, monkeypatch):
    """RAGService.load_persisted() should restore index from disk."""
    from app.services.llm_services.rag_service import RAGService, RAGIndexStore

    monkeypatch.setattr(settings, "RAG_HYBRID_ENABLED", True)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc1 = RAGService()
    svc1._store = RAGIndexStore(str(tmp_path / "idx"))
    svc1.chunks = [
        {"doc_id": "d1", "text": "Sedation protocol", "chunk_index": 0, "category": "sedation"},
        {"doc_id": "d2", "text": "Nutrition guide", "chunk_index": 0, "category": "nutrition"},
    ]
    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts):
        svc1.index()
    assert svc1.is_indexed

    svc2 = RAGService()
    svc2._store = RAGIndexStore(str(tmp_path / "idx"))
    assert svc2.load_persisted()
    assert svc2.is_indexed
    assert len(svc2.chunks) == 2
    assert svc2.embeddings is not None
    assert svc2.bm25 is not None


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


def test_needs_rebuild_detects_stale_index(tmp_path, monkeypatch):
    """_needs_rebuild() should detect when source docs changed after persisting."""
    from app.services.llm_services.rag_service import RAGService, RAGIndexStore

    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)
    monkeypatch.setattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", False)

    docs_dir = tmp_path / "docs" / "category"
    docs_dir.mkdir(parents=True)
    (docs_dir / "doc1.txt").write_text("Sedation protocol")

    svc = RAGService()
    svc._store = RAGIndexStore(str(tmp_path / "idx"))
    chunks = svc.load_and_chunk(str(tmp_path / "docs"))
    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts):
        svc.index(chunks)

    assert not svc._needs_rebuild(str(tmp_path / "docs"))

    (docs_dir / "doc2.txt").write_text("New delirium guideline")
    assert svc._needs_rebuild(str(tmp_path / "docs"))


# ── Contextual Retrieval tests ──


_CR_PATCH = "app.services.llm_services.rag_service.generate_chunk_context"


def test_contextual_retrieval_adds_prefix(monkeypatch):
    """Contextual retrieval should add contextual_prefix and contextual_text to chunks."""
    from app.services.llm_services.rag_service import RAGService

    monkeypatch.setattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", True)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc = RAGService()
    svc.chunks = [
        {"doc_id": "d1", "text": "Sedation protocol for ICU patients", "chunk_index": 0, "category": "sedation"},
        {"doc_id": "d2", "text": "Nutrition support guidelines", "chunk_index": 0, "category": "nutrition"},
    ]
    svc._doc_texts = {
        "d1": "Full document about sedation management in the ICU...",
        "d2": "Full document about nutrition support for critical care patients...",
    }

    def _mock_gen_ctx(doc_text, chunk_text):
        return f"本片段來自關於{chunk_text[:4]}的文件。"

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts), \
         patch(_CR_PATCH, side_effect=_mock_gen_ctx):
        svc.index()

    assert svc.is_indexed
    assert svc.chunks[0]["contextual_prefix"] == "本片段來自關於Seda的文件。"
    assert "本片段來自關於Seda的文件。" in svc.chunks[0]["contextual_text"]
    assert "Sedation protocol for ICU patients" in svc.chunks[0]["contextual_text"]


def test_contextual_retrieval_disabled_no_prefix(monkeypatch):
    """When CR is disabled, chunks should not have contextual_prefix."""
    from app.services.llm_services.rag_service import RAGService

    monkeypatch.setattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", False)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc = RAGService()
    svc.chunks = [
        {"doc_id": "d1", "text": "Sedation protocol", "chunk_index": 0, "category": "sedation"},
    ]
    svc._doc_texts = {"d1": "Full sedation doc..."}

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts):
        svc.index()

    assert svc.is_indexed
    assert "contextual_prefix" not in svc.chunks[0]


def test_contextual_retrieval_persists_with_index(tmp_path, monkeypatch):
    """Contextual prefixes should survive persistence roundtrip."""
    from app.services.llm_services.rag_service import RAGService, RAGIndexStore

    monkeypatch.setattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", True)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc1 = RAGService()
    svc1._store = RAGIndexStore(str(tmp_path / "idx"))
    svc1.chunks = [
        {"doc_id": "d1", "text": "Sedation protocol", "chunk_index": 0, "category": "sedation"},
    ]
    svc1._doc_texts = {"d1": "Full doc text..."}

    def _mock_gen_ctx(doc_text, chunk_text):
        return "本片段討論鎮靜治療方案。"

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts), \
         patch(_CR_PATCH, side_effect=_mock_gen_ctx):
        svc1.index()

    assert svc1.chunks[0]["contextual_prefix"] == "本片段討論鎮靜治療方案。"

    # Load from disk — contextual_prefix should persist
    svc2 = RAGService()
    svc2._store = RAGIndexStore(str(tmp_path / "idx"))
    assert svc2.load_persisted()
    assert svc2.chunks[0]["contextual_prefix"] == "本片段討論鎮靜治療方案。"
    assert "本片段討論鎮靜治療方案。" in svc2.chunks[0]["contextual_text"]


def test_contextual_retrieval_graceful_on_llm_failure(monkeypatch):
    """If LLM fails for a chunk, the original text should be used for embedding."""
    from app.services.llm_services.rag_service import RAGService

    monkeypatch.setattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", True)
    monkeypatch.setattr(settings, "RAG_RERANK_ENABLED", False)

    svc = RAGService()
    svc.chunks = [
        {"doc_id": "d1", "text": "Sedation protocol", "chunk_index": 0, "category": "sedation"},
        {"doc_id": "d2", "text": "Nutrition guide", "chunk_index": 0, "category": "nutrition"},
    ]
    svc._doc_texts = {"d1": "Full doc 1...", "d2": "Full doc 2..."}

    def _mock_gen_ctx_partial(doc_text, chunk_text):
        if "Sedation" in chunk_text:
            raise Exception("API timeout")
        return "本片段討論營養支持。"

    with patch(_EMBED_PATCH, side_effect=_mock_embed_texts), \
         patch(_CR_PATCH, side_effect=_mock_gen_ctx_partial):
        svc.index()

    assert svc.is_indexed
    # d1 failed — no prefix, contextual_text = original text
    assert "contextual_prefix" not in svc.chunks[0]
    assert svc.chunks[0]["contextual_text"] == svc.chunks[0]["text"]
    # d2 succeeded — has prefix
    assert svc.chunks[1]["contextual_prefix"] == "本片段討論營養支持。"
