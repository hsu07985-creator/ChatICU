"""RAG service — retrieval-augmented generation for ICU medical literature.

Architecture:
    load_and_chunk() -> index() -> retrieve(question) -> query(question)
    Generation step uses app.llm.call_llm(task="rag_generation").
    Embedding uses app.llm.embed_texts() (OpenAI only, no fallback).
    Retrieval supports hybrid search (vector + BM25) and metadata filtering.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from app.config import settings
from app.llm import call_llm, embed_texts, generate_chunk_context

RAG_DOCS_PATH = settings.RAG_DOCS_PATH or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "rag 文本",
)


def _min_max_normalize(scores: np.ndarray) -> np.ndarray:
    """Normalize scores to [0, 1] range."""
    s_min = scores.min()
    s_max = scores.max()
    if s_max - s_min < 1e-9:
        return np.zeros_like(scores)
    return (scores - s_min) / (s_max - s_min)


# Pre-compiled regex for CJK character detection and English tokenization
_CJK_RE = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]')
_EN_TOKEN_RE = re.compile(r'[A-Za-z0-9_]+')
_jieba_loaded = False
logger = logging.getLogger(__name__)


def _ensure_jieba() -> None:
    global _jieba_loaded
    if not _jieba_loaded:
        import jieba
        jieba.setLogLevel(logging.WARNING)
        _jieba_loaded = True


def _tokenize(text: str) -> List[str]:
    """Hybrid tokenizer: jieba for Chinese text, regex for English/numeric."""
    text_lower = text.lower()
    if _CJK_RE.search(text_lower):
        _ensure_jieba()
        import jieba
        return [t.strip() for t in jieba.cut(text_lower) if t.strip()]
    return _EN_TOKEN_RE.findall(text_lower)


class BM25:
    """Lightweight BM25 scorer — no external dependencies."""

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.doc_freqs: dict[str, int] = {}
        self.doc_lens: List[int] = []
        self.avg_dl: float = 0.0
        self.n_docs: int = 0
        self.tf_cache: List[Counter] = []

    def fit(self, documents: List[str]) -> None:
        self.n_docs = len(documents)
        self.doc_freqs = {}
        self.doc_lens = []
        self.tf_cache = []

        for doc in documents:
            tokens = _tokenize(doc)
            self.doc_lens.append(len(tokens))
            tf = Counter(tokens)
            self.tf_cache.append(tf)
            for term in set(tokens):
                self.doc_freqs[term] = self.doc_freqs.get(term, 0) + 1

        self.avg_dl = sum(self.doc_lens) / self.n_docs if self.n_docs else 1.0

    def score(self, query: str) -> np.ndarray:
        """Score all documents against a query. Returns array of BM25 scores."""
        query_tokens = _tokenize(query)
        scores = np.zeros(self.n_docs, dtype=np.float32)

        for term in query_tokens:
            if term not in self.doc_freqs:
                continue
            df = self.doc_freqs[term]
            idf = math.log((self.n_docs - df + 0.5) / (df + 0.5) + 1.0)

            for i in range(self.n_docs):
                tf = self.tf_cache[i].get(term, 0)
                dl = self.doc_lens[i]
                tf_norm = (tf * (self.k1 + 1)) / (
                    tf + self.k1 * (1 - self.b + self.b * dl / self.avg_dl)
                )
                scores[i] += idf * tf_norm

        return scores

    def to_state(self) -> Dict[str, Any]:
        """Serialize BM25 state for persistence."""
        return {
            "k1": self.k1,
            "b": self.b,
            "doc_freqs": dict(self.doc_freqs),
            "doc_lens": self.doc_lens,
            "avg_dl": self.avg_dl,
            "n_docs": self.n_docs,
            "tf_cache": [dict(c) for c in self.tf_cache],
        }

    @classmethod
    def from_state(cls, state: Dict[str, Any]) -> "BM25":
        """Restore BM25 from persisted state."""
        obj = cls(k1=state["k1"], b=state["b"])
        obj.doc_freqs = state["doc_freqs"]
        obj.doc_lens = state["doc_lens"]
        obj.avg_dl = state["avg_dl"]
        obj.n_docs = state["n_docs"]
        obj.tf_cache = [Counter(d) for d in state["tf_cache"]]
        return obj


class RAGIndexStore:
    """File-based persistence for RAG index artifacts."""

    def __init__(self, index_dir: Optional[str] = None):
        if index_dir:
            self.base_dir = Path(index_dir)
        else:
            self.base_dir = Path(__file__).resolve().parents[3] / "data" / "rag_index"

    @property
    def embeddings_path(self) -> Path:
        return self.base_dir / "embeddings.npy"

    @property
    def chunks_path(self) -> Path:
        return self.base_dir / "chunks.json"

    @property
    def bm25_path(self) -> Path:
        return self.base_dir / "bm25_state.json"

    @property
    def meta_path(self) -> Path:
        return self.base_dir / "index_meta.json"

    def index_exists(self) -> bool:
        return (
            self.embeddings_path.exists()
            and self.chunks_path.exists()
            and self.bm25_path.exists()
            and self.meta_path.exists()
        )

    def save(
        self,
        embeddings: np.ndarray,
        chunks: List[Dict[str, Any]],
        bm25: "BM25",
        source_fingerprint: str,
    ) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        np.save(self.embeddings_path, embeddings)
        self.chunks_path.write_text(
            json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8",
        )
        self.bm25_path.write_text(
            json.dumps(bm25.to_state(), ensure_ascii=False), encoding="utf-8",
        )
        cr_count = sum(1 for c in chunks if c.get("contextual_prefix"))
        cr_setting = getattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", False)
        meta = {
            "indexed_at": datetime.now(timezone.utc).isoformat(),
            "embedding_model": settings.OPENAI_EMBEDDING_MODEL,
            "embedding_dim": int(embeddings.shape[1]) if embeddings.ndim == 2 else 0,
            "total_chunks": len(chunks),
            "source_fingerprint": source_fingerprint,
            "tokenizer_version": "jieba_v1",
            "contextual_retrieval": cr_setting,
            "contextual_chunks": cr_count,
        }
        self.meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8",
        )

    def load(self) -> Tuple[np.ndarray, List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
        """Returns (embeddings, chunks, bm25_state_dict, meta_dict)."""
        embeddings = np.load(self.embeddings_path)
        chunks = json.loads(self.chunks_path.read_text(encoding="utf-8"))
        bm25_state = json.loads(self.bm25_path.read_text(encoding="utf-8"))
        meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
        return embeddings, chunks, bm25_state, meta


class RAGService:

    def __init__(self):
        self.chunks: list[dict] = []
        self.embeddings: Optional[np.ndarray] = None
        self.bm25: Optional[BM25] = None
        self.is_indexed: bool = False
        self._last_docs_path: Optional[str] = None
        self._doc_texts: Dict[str, str] = {}  # doc_id → full text (for contextual retrieval)
        index_dir = getattr(settings, "RAG_INDEX_DIR", "") or ""
        self._store: Optional[RAGIndexStore] = RAGIndexStore(index_dir or None)

    def load_and_chunk(self, docs_path: Optional[str] = None) -> list[dict]:
        """Read files from docs_path, split into chunks."""
        from app.services.data_services.document_loader import load_documents
        from app.services.data_services.text_chunker import chunk_documents

        path = docs_path or RAG_DOCS_PATH
        self._last_docs_path = path
        documents = load_documents(path)
        # Cache full document texts for contextual retrieval
        self._doc_texts = {doc["doc_id"]: doc["text"] for doc in documents}
        chunks = chunk_documents(documents)
        self.chunks = chunks
        return chunks

    def _apply_contextual_retrieval(self) -> int:
        """Generate contextual prefixes for all chunks using parallel LLM calls.

        Sets chunk["contextual_prefix"] and chunk["contextual_text"] for each chunk.
        Returns the number of chunks successfully contextualized.
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        total = len(self.chunks)
        workers = getattr(settings, "RAG_CONTEXTUAL_WORKERS", 8)
        logger.info("[RAG][CR] Generating contextual prefixes for %d chunks (workers=%d)", total, workers)

        success_count = 0

        def _gen_context(idx: int) -> tuple:
            chunk = self.chunks[idx]
            doc_text = self._doc_texts.get(chunk["doc_id"], "")
            if not doc_text:
                return idx, ""
            try:
                ctx = generate_chunk_context(doc_text, chunk["text"])
                return idx, ctx
            except Exception as exc:
                logger.warning("[RAG][CR] Failed to generate context for chunk %d: %s", idx, exc)
                return idx, ""

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_gen_context, i): i for i in range(total)}
            for future in as_completed(futures):
                idx, ctx = future.result()
                if ctx:
                    self.chunks[idx]["contextual_prefix"] = ctx
                    self.chunks[idx]["contextual_text"] = ctx + "\n\n" + self.chunks[idx]["text"]
                    success_count += 1
                else:
                    # No context — use original text for embedding
                    self.chunks[idx]["contextual_text"] = self.chunks[idx]["text"]
                if (success_count % 100 == 0) and success_count > 0:
                    logger.info("[RAG][CR] Progress: %d/%d chunks contextualized", success_count, total)

        logger.info("[RAG][CR] Done: %d/%d chunks have contextual prefixes", success_count, total)
        return success_count

    def index(self, chunks: Optional[list[dict]] = None) -> dict:
        """Embed chunks and store in memory for similarity search."""
        if chunks is not None:
            self.chunks = chunks

        if not self.chunks:
            return {"status": "error", "message": "No chunks to index", "total_chunks": 0}

        # Apply Contextual Retrieval: generate LLM context for each chunk
        cr_enabled = getattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", False)
        if cr_enabled and self._doc_texts:
            self._apply_contextual_retrieval()

        # Use contextual text for embedding (richer semantic signal),
        # but original text for BM25 (keyword matching stays clean)
        texts = [c["text"] for c in self.chunks]
        texts_for_embedding = [c.get("contextual_text", c["text"]) for c in self.chunks]
        vectors = embed_texts(texts_for_embedding)
        self.embeddings = np.array(vectors, dtype=np.float32)

        # Build BM25 index for hybrid search
        self.bm25 = BM25()
        self.bm25.fit(texts)

        self.is_indexed = True

        categories = {}
        doc_ids = set()
        for c in self.chunks:
            cat = c.get("category", "uncategorized")
            categories[cat] = categories.get(cat, 0) + 1
            doc_ids.add(c["doc_id"])

        # Persist index to disk
        if self._store is not None:
            try:
                fingerprint = self._compute_source_fingerprint(self._last_docs_path)
                self._store.save(self.embeddings, self.chunks, self.bm25, fingerprint)
                logger.info("[RAG] Index persisted to %s (%d chunks)", self._store.base_dir, len(self.chunks))
            except Exception as exc:
                logger.warning("[RAG] Failed to persist index: %s", exc)

        return {
            "status": "indexed",
            "total_chunks": len(self.chunks),
            "total_documents": len(doc_ids),
            "categories": categories,
            "embedding_dim": self.embeddings.shape[1] if self.embeddings is not None else 0,
        }

    def load_persisted(self) -> bool:
        """Try to load index from disk. Returns True if successful."""
        if self._store is None or not self._store.index_exists():
            return False
        try:
            embeddings, chunks, bm25_state, meta = self._store.load()
            current_model = settings.OPENAI_EMBEDDING_MODEL
            if meta.get("embedding_model") != current_model:
                logger.warning(
                    "[RAG] Persisted index uses %s but current config uses %s — rebuilding",
                    meta.get("embedding_model"), current_model,
                )
                return False
            self.embeddings = embeddings.astype(np.float32)
            self.chunks = chunks
            self.bm25 = BM25.from_state(bm25_state)
            self.is_indexed = True
            logger.info(
                "[RAG] Loaded persisted index: %d chunks, dim=%d, model=%s",
                len(self.chunks),
                self.embeddings.shape[1] if self.embeddings.ndim == 2 else 0,
                meta.get("embedding_model"),
            )
            return True
        except Exception as exc:
            logger.warning("[RAG] Failed to load persisted index: %s", exc)
            return False

    def _compute_source_fingerprint(self, docs_path: Optional[str] = None) -> str:
        """Compute a SHA-256 fingerprint of all source documents."""
        path = docs_path or RAG_DOCS_PATH
        if not path or not os.path.isdir(path):
            return ""
        file_hashes: List[str] = []
        for root, _dirs, files in sorted(os.walk(path)):
            for fname in sorted(files):
                fpath = os.path.join(root, fname)
                try:
                    content_hash = hashlib.sha256(open(fpath, "rb").read()).hexdigest()
                    rel_path = os.path.relpath(fpath, path)
                    file_hashes.append(f"{rel_path}:{content_hash}")
                except (IOError, OSError):
                    continue
        combined = "\n".join(file_hashes)
        return hashlib.sha256(combined.encode("utf-8")).hexdigest()

    def _needs_rebuild(self, docs_path: Optional[str] = None) -> bool:
        """Check if the persisted index is stale relative to source documents."""
        if self._store is None or not self._store.index_exists():
            return True
        try:
            _, _, _, meta = self._store.load()
            persisted_fp = meta.get("source_fingerprint", "")
            current_fp = self._compute_source_fingerprint(docs_path)
            if not persisted_fp or persisted_fp != current_fp:
                return True
            current_model = settings.OPENAI_EMBEDDING_MODEL
            if meta.get("embedding_model") != current_model:
                return True
            # Detect contextual retrieval setting change
            cr_enabled = getattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", False)
            persisted_cr = meta.get("contextual_retrieval", False)
            if cr_enabled != persisted_cr:
                logger.info("[RAG] Contextual retrieval setting changed (%s → %s), rebuild needed", persisted_cr, cr_enabled)
                return True
            return False
        except Exception:
            return True

    def get_status(self) -> dict:
        """Return current index status for admin display."""
        if not self.is_indexed:
            return {"is_indexed": False, "total_chunks": 0, "total_documents": 0}
        doc_ids = set(c["doc_id"] for c in self.chunks)
        categories = {}
        cr_count = 0
        for c in self.chunks:
            cat = c.get("category", "uncategorized")
            categories[cat] = categories.get(cat, 0) + 1
            if c.get("contextual_prefix"):
                cr_count += 1
        return {
            "is_indexed": True,
            "total_chunks": len(self.chunks),
            "total_documents": len(doc_ids),
            "categories": categories,
            "embedding_dim": self.embeddings.shape[1] if self.embeddings is not None else 0,
            "embedding_model": settings.OPENAI_EMBEDDING_MODEL,
            "contextual_retrieval": cr_count > 0,
            "contextual_chunks": cr_count,
        }

    def reset(self) -> None:
        """Reset index state (useful for test isolation)."""
        self.chunks = []
        self.embeddings = None
        self.bm25 = None
        self.is_indexed = False
        self._doc_texts = {}

    def retrieve(
        self,
        question: str,
        top_k: int = 5,
        category_filter: Optional[List[str]] = None,
    ) -> list[dict]:
        """Find most relevant chunks via hybrid search (vector + BM25).

        Args:
            question: User query.
            top_k: Number of results to return.
            category_filter: If provided, only include chunks from these categories.
        """
        if not self.is_indexed or self.embeddings is None:
            return []

        if len(self.chunks) == 0 or self.embeddings.shape[0] == 0:
            return []

        # ── Metadata filter mask ──
        if category_filter:
            cats = set(c.lower() for c in category_filter)
            mask = np.array(
                [c.get("category", "").lower() in cats for c in self.chunks],
                dtype=bool,
            )
            if not mask.any():
                return []
        else:
            mask = np.ones(len(self.chunks), dtype=bool)

        # ── Vector similarity ──
        q_vec = np.array(embed_texts([question])[0], dtype=np.float32)

        q_norm = np.linalg.norm(q_vec)
        if q_norm == 0:
            return []
        q_vec = q_vec / q_norm

        norms = np.linalg.norm(self.embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        normed = self.embeddings / norms

        vec_scores = normed @ q_vec

        if not np.all(np.isfinite(vec_scores)):
            vec_scores = np.nan_to_num(vec_scores, nan=0.0, posinf=0.0, neginf=0.0)

        # ── Hybrid: combine vector + BM25 ──
        if settings.RAG_HYBRID_ENABLED and self.bm25 is not None:
            bm25_scores = self.bm25.score(question)
            # Min-max normalize both to [0, 1] before combining
            vec_norm = _min_max_normalize(vec_scores)
            bm25_norm = _min_max_normalize(bm25_scores)
            w = settings.RAG_BM25_WEIGHT
            combined = (1 - w) * vec_norm + w * bm25_norm
        else:
            combined = vec_scores

        # Apply metadata filter
        combined[~mask] = -1.0

        # Over-retrieve candidates when reranking is enabled
        n_candidates = (
            settings.RAG_RERANK_CANDIDATES
            if settings.RAG_RERANK_ENABLED
            else top_k
        )
        n_candidates = min(n_candidates, int(mask.sum()))
        top_indices = np.argsort(combined)[::-1][:n_candidates]

        results = []
        for idx in top_indices:
            if combined[idx] <= -1.0:
                break
            chunk = self.chunks[idx]
            results.append({
                "doc_id": chunk["doc_id"],
                "text": chunk["text"],
                "score": float(combined[idx]),
                "chunk_index": chunk["chunk_index"],
                "category": chunk.get("category", ""),
            })

        # Rerank using LLM scoring if enabled
        if settings.RAG_RERANK_ENABLED and len(results) > top_k:
            from app.llm import rerank_passages
            results = rerank_passages(question, results, top_k=top_k)

        return results[:top_k]

    def query(
        self,
        question: str,
        top_k: int = 5,
        category_filter: Optional[List[str]] = None,
    ) -> dict[str, Any]:
        """Full RAG pipeline: retrieve -> generate via call_llm."""
        sources = self.retrieve(question, top_k=top_k, category_filter=category_filter)
        context = "\n\n---\n\n".join([s["text"] for s in sources])

        result = call_llm(
            task="rag_generation",
            input_data={"question": question, "context": context},
        )

        return {
            "answer": result.get("content", ""),
            "sources": [
                {
                    "doc_id": s["doc_id"],
                    "score": s["score"],
                    "chunk_index": s["chunk_index"],
                    "category": s["category"],
                    "excerpt": s["text"][:200] + "..." if len(s["text"]) > 200 else s["text"],
                }
                for s in sources
            ],
            "metadata": result.get("metadata", {}),
        }


rag_service = RAGService()
