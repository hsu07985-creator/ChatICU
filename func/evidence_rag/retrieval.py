"""Hybrid retrieval (dense + BM25) and candidate fusion."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from dataclasses import asdict

import numpy as np

from .bm25 import BM25Index
from .config import EvidenceRAGConfig
from .embeddings import build_embedder
from .models import ChunkRecord
from .rerank import Candidate, rerank_candidates
from .storage import ArtifactStore


def _normalize_scores(values: dict[int, float]) -> dict[int, float]:
    if not values:
        return {}
    v = list(values.values())
    lo = min(v)
    hi = max(v)
    if hi - lo < 1e-9:
        return {k: 1.0 for k in values}
    return {k: (val - lo) / (hi - lo) for k, val in values.items()}


class HybridRetriever:
    """Dense + lexical retrieval with fusion and reranking."""

    def __init__(self, cfg: EvidenceRAGConfig, store: ArtifactStore):
        self.cfg = cfg
        self.store = store
        self.embedder = build_embedder(cfg)
        self.bm25 = BM25Index()
        self.chunks: list[ChunkRecord] = []
        self.chunk_by_id: dict[str, ChunkRecord] = {}
        self.vectors = np.array([])
        self.chunk_ids: list[str] = []

    def load_or_build(self, force_rebuild: bool = False) -> None:
        self.chunks = self.store.load_chunks()
        self.chunk_by_id = {c.chunk_id: c for c in self.chunks}

        if not self.chunks:
            self.vectors = np.array([])
            self.chunk_ids = []
            self.bm25 = BM25Index()
            return

        if not force_rebuild:
            vectors, chunk_ids = self.store.load_vector_index()
            bm25_payload = self.store.load_bm25_payload()
            if vectors.size and chunk_ids and bm25_payload:
                self.vectors = vectors
                self.chunk_ids = chunk_ids
                self.bm25 = BM25Index.from_payload(bm25_payload)
                return

        self.build_indexes()

    def build_indexes(self) -> None:
        texts = [c.text for c in self.chunks]
        self.chunk_ids = [c.chunk_id for c in self.chunks]
        self.vectors, vector_stats = self._build_dense_vectors_incremental(
            texts=texts, chunk_ids=self.chunk_ids
        )
        self.store.save_vector_index(self.vectors, self.chunk_ids)

        self.bm25.fit(texts)
        self.store.save_bm25_payload(self.bm25.to_payload())
        self.store.save_index_meta(
            {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "embedding_signature": self.embedder.signature(),
                "embedding_dim": int(self.vectors.shape[1]) if self.vectors.size else 0,
                "chunk_count": len(self.chunk_ids),
                "vector_stats": vector_stats,
            }
        )

    def _build_dense_vectors_incremental(
        self,
        texts: list[str],
        chunk_ids: list[str],
    ) -> tuple[np.ndarray, dict]:
        if not texts:
            return np.array([]), {"strategy": "empty", "reused": 0, "embedded": 0}

        old_vectors, old_ids = self.store.load_vector_index()
        index_meta = self.store.load_index_meta()
        current_sig = self.embedder.signature()

        can_reuse = (
            old_vectors.size > 0
            and bool(old_ids)
            and len(old_ids) == int(old_vectors.shape[0])
            and index_meta.get("embedding_signature") == current_sig
        )
        if not can_reuse:
            vectors = self.embedder.embed_texts(texts)
            return vectors, {
                "strategy": "full_reembed",
                "reused": 0,
                "embedded": len(texts),
                "reason": "no_reusable_index_or_signature_changed",
            }

        old_idx_by_chunk = {cid: i for i, cid in enumerate(old_ids)}
        missing_positions: list[int] = []
        for pos, cid in enumerate(chunk_ids):
            idx = old_idx_by_chunk.get(cid)
            if idx is None:
                missing_positions.append(pos)

        if not missing_positions:
            vectors = old_vectors[[old_idx_by_chunk[cid] for cid in chunk_ids], :]
            return vectors, {
                "strategy": "reorder_only",
                "reused": len(chunk_ids),
                "embedded": 0,
            }

        dim = int(old_vectors.shape[1])
        vectors = np.zeros((len(chunk_ids), dim), dtype=old_vectors.dtype)
        reused = 0
        for pos, cid in enumerate(chunk_ids):
            old_i = old_idx_by_chunk.get(cid)
            if old_i is None:
                continue
            vectors[pos] = old_vectors[old_i]
            reused += 1

        missing_texts = [texts[pos] for pos in missing_positions]
        missing_vectors = self.embedder.embed_texts(missing_texts)
        if missing_vectors.ndim != 2 or int(missing_vectors.shape[1]) != dim:
            all_vectors = self.embedder.embed_texts(texts)
            return all_vectors, {
                "strategy": "full_reembed",
                "reused": 0,
                "embedded": len(texts),
                "reason": "dimension_mismatch",
            }

        for i, pos in enumerate(missing_positions):
            vectors[pos] = missing_vectors[i]

        return vectors, {
            "strategy": "incremental_reuse",
            "reused": reused,
            "embedded": len(missing_positions),
        }

    def _dense_search(self, query: str, top_k: int) -> list[tuple[int, float]]:
        if self.vectors.size == 0:
            return []
        q_vec = self.embedder.embed_texts([query])[0]
        sims = np.dot(self.vectors, q_vec)
        idx = np.argsort(-sims)[:top_k]
        return [(int(i), float(sims[i])) for i in idx]

    def _filter_indices(self, indices: list[int], topic_filter: list[str] | None) -> list[int]:
        if not topic_filter:
            return indices
        keep = []
        wanted = set(topic_filter)
        for i in indices:
            chunk = self.chunks[i]
            if chunk.topic in wanted:
                keep.append(i)
        return keep

    def search(
        self,
        query: str,
        top_k: int | None = None,
        candidate_k: int | None = None,
        topic_filter: list[str] | None = None,
    ) -> list[Candidate]:
        if not self.chunks:
            return []
        top_k = top_k or self.cfg.retrieval_top_k
        candidate_k = candidate_k or self.cfg.candidate_pool_k

        dense_raw = self._dense_search(query=query, top_k=candidate_k)
        dense_dict = {i: s for i, s in dense_raw}

        bm25_raw = self.bm25.search(query, top_k=candidate_k)
        bm25_dict = {r.doc_index: r.score for r in bm25_raw}

        candidate_indices = set(dense_dict) | set(bm25_dict)
        if topic_filter:
            candidate_indices = set(self._filter_indices(list(candidate_indices), topic_filter))

        dense_norm = _normalize_scores({i: dense_dict.get(i, 0.0) for i in candidate_indices})
        bm25_norm = _normalize_scores({i: bm25_dict.get(i, 0.0) for i in candidate_indices})

        dense_rank = {
            idx: rank + 1
            for rank, (idx, _) in enumerate(sorted(dense_dict.items(), key=lambda x: x[1], reverse=True))
        }
        bm25_rank = {
            idx: rank + 1
            for rank, (idx, _) in enumerate(sorted(bm25_dict.items(), key=lambda x: x[1], reverse=True))
        }

        fused: list[Candidate] = []
        for i in candidate_indices:
            rr = 0.0
            if i in dense_rank:
                rr += 1.0 / (self.cfg.rrf_k + dense_rank[i])
            if i in bm25_rank:
                rr += 1.0 / (self.cfg.rrf_k + bm25_rank[i])

            chunk = self.chunks[i]
            fused.append(
                Candidate(
                    chunk_id=chunk.chunk_id,
                    text=chunk.text,
                    fused_score=rr,
                    dense_score=dense_norm.get(i, 0.0),
                    bm25_score=bm25_norm.get(i, 0.0),
                    metadata={
                        "doc_id": chunk.doc_id,
                        "source_file": chunk.source_file,
                        "page": chunk.page,
                        "topic": chunk.topic,
                        "section": chunk.section,
                        "source_type": chunk.source_type,
                        "language": chunk.language,
                        "quality_score": chunk.quality_score,
                        "fallback_used": chunk.fallback_used,
                    },
                )
            )

        fused.sort(key=lambda x: x.fused_score, reverse=True)
        reranked = rerank_candidates(query=query, candidates=fused[:candidate_k], top_k=top_k)
        return reranked

    def source_by_chunk_id(self, chunk_id: str) -> dict:
        chunk = self.chunk_by_id.get(chunk_id)
        if not chunk:
            return {}
        return chunk.to_dict()

    def debug_snapshot(self) -> dict:
        return {
            "chunks": len(self.chunks),
            "vector_shape": list(self.vectors.shape) if self.vectors.size else [0, 0],
            "bm25_docs": len(self.bm25.docs_tokens),
        }

    def export_debug_index(self) -> str:
        payload = {
            "snapshot": self.debug_snapshot(),
            "sample_chunk_ids": self.chunk_ids[:20],
            "sample_chunks": [asdict(c) for c in self.chunks[:3]],
        }
        out = self.store.index_dir / "debug_index.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(out)
