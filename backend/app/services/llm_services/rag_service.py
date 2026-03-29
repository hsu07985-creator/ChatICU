"""RAG service — retrieval-augmented generation for ICU medical literature.

Architecture:
    load_and_chunk() -> index() -> retrieve(question) -> query(question)
    Generation step uses app.llm.call_llm(task="rag_generation").
    Embedding uses app.llm.embed_texts() (OpenAI only, no fallback).
    Retrieval supports hybrid search (vector + BM25) and metadata filtering.
    Persistence: pgvector on PostgreSQL (Supabase).
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
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import sqlalchemy as sa

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
        self.doc_freqs: dict = {}
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


class PgVectorStore:
    """PostgreSQL + pgvector persistence for RAG chunks."""

    async def save(
        self,
        chunks: List[Dict[str, Any]],
        embeddings: np.ndarray,
        source_fingerprint: str,
        embedding_model: str,
    ) -> None:
        """Delete existing chunks and bulk-insert new ones."""
        from app.database import async_session
        from app.models.rag_chunk import RagChunk

        async with async_session() as session:
            await session.execute(sa.delete(RagChunk))

            for i, chunk in enumerate(chunks):
                row = RagChunk(
                    doc_id=chunk["doc_id"],
                    chunk_index=chunk["chunk_index"],
                    text=chunk["text"],
                    contextual_prefix=chunk.get("contextual_prefix"),
                    contextual_text=chunk.get("contextual_text"),
                    category=chunk.get("category"),
                    embedding=embeddings[i].tolist(),
                    embedding_model=embedding_model,
                    source_fingerprint=source_fingerprint,
                )
                session.add(row)
            await session.commit()

        logger.info("[RAG][pgvector] Saved %d chunks to database", len(chunks))

    async def load(self) -> Tuple[Optional[np.ndarray], List[Dict[str, Any]], Optional[str]]:
        """Load all chunks from DB. Returns (embeddings, chunks, source_fingerprint)."""
        from app.database import async_session
        from app.models.rag_chunk import RagChunk

        async with async_session() as session:
            result = await session.execute(
                sa.select(RagChunk).order_by(RagChunk.id)
            )
            rows = result.scalars().all()

        if not rows:
            return None, [], None

        chunks = []
        embeddings_list = []
        fingerprint = rows[0].source_fingerprint
        for row in rows:
            chunks.append({
                "doc_id": row.doc_id,
                "chunk_index": row.chunk_index,
                "text": row.text,
                "contextual_prefix": row.contextual_prefix,
                "contextual_text": row.contextual_text,
                "category": row.category,
            })
            embeddings_list.append(row.embedding)

        embeddings = np.array(embeddings_list, dtype=np.float32)
        logger.info("[RAG][pgvector] Loaded %d chunks from database", len(chunks))
        return embeddings, chunks, fingerprint

    async def index_exists(self) -> bool:
        from app.database import async_session
        from app.models.rag_chunk import RagChunk

        async with async_session() as session:
            result = await session.execute(
                sa.select(sa.func.count()).select_from(RagChunk)
            )
            count = result.scalar()
        return (count or 0) > 0

    async def get_meta(self) -> Optional[Dict[str, Any]]:
        """Get metadata from first chunk (embedding_model, fingerprint)."""
        from app.database import async_session
        from app.models.rag_chunk import RagChunk

        async with async_session() as session:
            result = await session.execute(
                sa.select(
                    RagChunk.embedding_model,
                    RagChunk.source_fingerprint,
                ).limit(1)
            )
            row = result.first()
        if not row:
            return None
        return {
            "embedding_model": row.embedding_model,
            "source_fingerprint": row.source_fingerprint,
        }

    async def clear(self) -> None:
        from app.database import async_session
        from app.models.rag_chunk import RagChunk

        async with async_session() as session:
            await session.execute(sa.delete(RagChunk))
            await session.commit()
        logger.info("[RAG][pgvector] Cleared all chunks")


class RAGService:

    def __init__(self):
        self.chunks: list = []
        self.embeddings: Optional[np.ndarray] = None
        self.bm25: Optional[BM25] = None
        self.is_indexed: bool = False
        self._last_docs_path: Optional[str] = None
        self._doc_texts: Dict[str, str] = {}
        self._store = PgVectorStore()

    def load_and_chunk(self, docs_path: Optional[str] = None) -> list:
        """Read files from docs_path, split into chunks."""
        from app.services.data_services.document_loader import load_documents
        from app.services.data_services.text_chunker import chunk_documents

        path = docs_path or RAG_DOCS_PATH
        self._last_docs_path = path
        documents = load_documents(path)
        self._doc_texts = {doc["doc_id"]: doc["text"] for doc in documents}
        chunks = chunk_documents(documents)
        self.chunks = chunks
        return chunks

    def _apply_contextual_retrieval(self) -> int:
        """Generate contextual prefixes for all chunks using parallel LLM calls."""
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
                    self.chunks[idx]["contextual_text"] = self.chunks[idx]["text"]
                if (success_count % 100 == 0) and success_count > 0:
                    logger.info("[RAG][CR] Progress: %d/%d chunks contextualized", success_count, total)

        logger.info("[RAG][CR] Done: %d/%d chunks have contextual prefixes", success_count, total)
        return success_count

    async def index(self, chunks: Optional[list] = None) -> dict:
        """Embed chunks, store in pgvector, and load into memory for hybrid search."""
        if chunks is not None:
            self.chunks = chunks

        if not self.chunks:
            return {"status": "error", "message": "No chunks to index", "total_chunks": 0}

        # Apply Contextual Retrieval
        cr_enabled = getattr(settings, "RAG_CONTEXTUAL_RETRIEVAL_ENABLED", False)
        if cr_enabled and self._doc_texts:
            self._apply_contextual_retrieval()

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

        # Persist to pgvector
        try:
            fingerprint = self._compute_source_fingerprint(self._last_docs_path)
            await self._store.save(
                self.chunks, self.embeddings, fingerprint,
                settings.OPENAI_EMBEDDING_MODEL,
            )
            logger.info("[RAG] Index persisted to pgvector (%d chunks)", len(self.chunks))
        except Exception as exc:
            logger.warning("[RAG] Failed to persist index to pgvector: %s", exc)

        return {
            "status": "indexed",
            "total_chunks": len(self.chunks),
            "total_documents": len(doc_ids),
            "categories": categories,
            "embedding_dim": self.embeddings.shape[1] if self.embeddings is not None else 0,
        }

    async def load_persisted(self) -> bool:
        """Try to load index from pgvector. Returns True if successful."""
        try:
            has_data = await self._store.index_exists()
            if not has_data:
                return False

            meta = await self._store.get_meta()
            if meta and meta.get("embedding_model") != settings.OPENAI_EMBEDDING_MODEL:
                logger.warning(
                    "[RAG] Persisted index uses %s but current config uses %s — rebuilding",
                    meta.get("embedding_model"), settings.OPENAI_EMBEDDING_MODEL,
                )
                return False

            embeddings, chunks, fingerprint = await self._store.load()
            if embeddings is None or len(chunks) == 0:
                return False

            self.embeddings = embeddings
            self.chunks = chunks

            # Rebuild BM25 in-memory from loaded chunks
            self.bm25 = BM25()
            self.bm25.fit([c["text"] for c in self.chunks])

            self.is_indexed = True
            logger.info(
                "[RAG] Loaded persisted index from pgvector: %d chunks, dim=%d",
                len(self.chunks),
                self.embeddings.shape[1] if self.embeddings.ndim == 2 else 0,
            )
            return True
        except Exception as exc:
            logger.warning("[RAG] Failed to load persisted index from pgvector: %s", exc)
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

    async def _needs_rebuild(self, docs_path: Optional[str] = None) -> bool:
        """Check if the persisted index is stale relative to source documents."""
        try:
            has_data = await self._store.index_exists()
            if not has_data:
                return True
            meta = await self._store.get_meta()
            if not meta:
                return True
            persisted_fp = meta.get("source_fingerprint", "")
            current_fp = self._compute_source_fingerprint(docs_path)
            if not persisted_fp or persisted_fp != current_fp:
                return True
            if meta.get("embedding_model") != settings.OPENAI_EMBEDDING_MODEL:
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

    async def reset(self) -> None:
        """Reset index state."""
        self.chunks = []
        self.embeddings = None
        self.bm25 = None
        self.is_indexed = False
        self._doc_texts = {}
        try:
            await self._store.clear()
        except Exception as exc:
            logger.warning("[RAG] Failed to clear pgvector store: %s", exc)

    def retrieve(
        self,
        question: str,
        top_k: int = 5,
        category_filter: Optional[List[str]] = None,
    ) -> list:
        """Find most relevant chunks via hybrid search (vector + BM25).

        Uses in-memory embeddings loaded from pgvector at startup.
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
        if self.embeddings.ndim != 2 or self.embeddings.shape[1] != q_vec.shape[0]:
            logger.error(
                "[RAG] Embedding dim mismatch (index=%s, query=%s); "
                "skip local retrieval and rebuild index via POST /api/v1/rag/index",
                self.embeddings.shape[1] if self.embeddings.ndim == 2 else "unknown",
                q_vec.shape[0],
            )
            return []

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
    ) -> Dict[str, Any]:
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
