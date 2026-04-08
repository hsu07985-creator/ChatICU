"""In-process Guideline RAG client — hybrid search over 825 ICU clinical guideline chunks.

Loads the pre-built dense (pickle) + BM25 (JSON) indices from the guideline
reference directory and performs hybrid search without an external service.

Sources: PADIS 2018/2025, ACCCM NMB 2016, UpToDate clinical reviews (13 PDFs).
"""

from __future__ import annotations

import json
import logging
import math
import pickle
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ── Index paths ──────────────────────────────────────────────────────────
_GUIDELINE_DIR = (
    Path(__file__).resolve().parents[3]
    / "0_chatICU reference"
    / "文本"
    / "guideline"
)
_CHUNKS_PATH = _GUIDELINE_DIR / "chunks_enriched.jsonl"
_DENSE_PATH = _GUIDELINE_DIR / "dense_index.pkl"
_BM25_PATH = _GUIDELINE_DIR / "bm25_index.json"


# ── Response Model ───────────────────────────────────────────────────────

class GuidelineChunk(BaseModel):
    """A single guideline search result."""
    chunk_id: str = ""
    text: str = ""
    score: float = 0.0
    source_name: str = ""
    section_path: str = ""
    page_label: str = ""
    year: int = 0
    topic: str = ""
    is_recommendation: bool = False
    recommendation_strength: Optional[str] = None
    drugs_mentioned: List[str] = Field(default_factory=list)


# ── BM25 (minimal, from guideline_search.py) ────────────────────────────

# Chinese medical term → English keyword mapping
_CJK_MEDICAL_TERMS = {
    "譫妄": ["delirium"], "鎮靜": ["sedation", "sedative"],
    "疼痛": ["pain", "analgesia"], "止痛": ["pain", "analgesia", "analgesic"],
    "神經肌肉阻斷": ["neuromuscular", "blockade", "nmba"],
    "睡眠": ["sleep", "circadian"], "早期活動": ["early", "mobilization", "mobility"],
    "躁動": ["agitation", "agitated"], "劑量": ["dosing", "dose"],
    "副作用": ["adverse", "effects", "side"], "預防": ["prevention", "prophylaxis"],
    "治療": ["treatment", "management"], "評估": ["assessment", "evaluation"],
    "監測": ["monitoring", "monitor"], "插管": ["intubated", "intubation"],
    "拔管": ["extubation", "extubated"],
}

_MEDICAL_ABBREVS = {
    "rass": ["richmond", "agitation", "sedation", "scale"],
    "cam-icu": ["confusion", "assessment", "method", "icu"],
    "cam": ["confusion", "assessment", "method"],
    "bps": ["behavioral", "pain", "scale"],
    "cpot": ["critical", "care", "pain", "observation", "tool"],
    "padis": ["pain", "agitation", "delirium", "immobility", "sleep"],
    "sat": ["spontaneous", "awakening", "trial"],
    "sbt": ["spontaneous", "breathing", "trial"],
    "nmba": ["neuromuscular", "blocking", "agent"],
    "tof": ["train", "of", "four"],
    "icu": ["intensive", "care", "unit"],
}

_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")


def _tokenize(text: str) -> List[str]:
    text_lower = text.lower()
    tokens = re.findall(r"[a-z][a-z\-]{1,}|\d+\.?\d*", text_lower)
    expanded = []
    for tok in tokens:
        expanded.append(tok)
        if tok in _MEDICAL_ABBREVS:
            expanded.extend(_MEDICAL_ABBREVS[tok])
    if _CJK_RE.search(text):
        for zh, en_list in _CJK_MEDICAL_TERMS.items():
            if zh in text:
                expanded.extend(en_list)
    return expanded


# ── Client ───────────────────────────────────────────────────────────────

class GuidelineRagClient:
    """In-process hybrid search over ICU guideline chunks.

    Lazy-loads indices on first search call.
    """

    def __init__(self) -> None:
        self._chunks: Optional[Dict[str, Dict[str, Any]]] = None
        self._dense_ids: Optional[List[str]] = None
        self._dense_matrix: Optional[np.ndarray] = None
        self._bm25_data: Optional[Dict[str, Any]] = None
        self._loaded = False

    def _load(self) -> bool:
        """Load indices from disk. Returns True if successful."""
        if self._loaded:
            return self._chunks is not None

        self._loaded = True  # only try once

        if not _CHUNKS_PATH.exists() or not _DENSE_PATH.exists() or not _BM25_PATH.exists():
            logger.warning(
                "[GUIDELINE] Index files not found at %s — guideline search disabled",
                _GUIDELINE_DIR,
            )
            return False

        try:
            # Chunks
            self._chunks = {}
            with open(_CHUNKS_PATH, encoding="utf-8") as f:
                for line in f:
                    c = json.loads(line)
                    self._chunks[c["chunk_id"]] = c

            # Dense index
            with open(_DENSE_PATH, "rb") as f:
                data = pickle.load(f)
            self._dense_ids = data["ids"]
            self._dense_matrix = data["embeddings"]

            # BM25 index
            with open(_BM25_PATH, encoding="utf-8") as f:
                self._bm25_data = json.load(f)
            self._bm25_data["tf"] = [Counter(t) for t in self._bm25_data["tf"]]

            logger.info(
                "[GUIDELINE] Loaded %d chunks, dense=%s, bm25 vocab=%d",
                len(self._chunks),
                self._dense_matrix.shape if self._dense_matrix is not None else "?",
                len(self._bm25_data.get("df", {})),
            )
            return True

        except Exception as exc:
            logger.error("[GUIDELINE] Failed to load indices: %s", str(exc)[:300])
            self._chunks = None
            return False

    def _bm25_search(self, query: str, top_k: int = 30) -> List[tuple]:
        """BM25 sparse search."""
        bm25 = self._bm25_data
        if not bm25:
            return []
        tokens = _tokenize(query)
        k1, b = bm25.get("k1", 1.5), bm25.get("b", 0.75)
        N = bm25["N"]
        avg_dl = bm25["avg_dl"]
        scores = {}
        for i in range(N):
            score = 0.0
            dl = bm25["doc_len"][i]
            for term in tokens:
                if term not in bm25["tf"][i]:
                    continue
                tf_val = bm25["tf"][i][term]
                df_val = bm25["df"].get(term, 0)
                idf = math.log((N - df_val + 0.5) / (df_val + 0.5) + 1)
                tf_norm = (tf_val * (k1 + 1)) / (tf_val + k1 * (1 - b + b * dl / avg_dl))
                score += idf * tf_norm
            if score > 0:
                scores[i] = score
        top = sorted(scores.items(), key=lambda x: -x[1])[:top_k]
        max_score = top[0][1] if top else 1.0
        return [(bm25["doc_ids"][i], s / max_score) for i, s in top]

    def _dense_search(self, query_embedding: List[float], top_k: int = 30) -> List[tuple]:
        """Dense cosine similarity search."""
        if self._dense_matrix is None:
            return []
        q = np.array(query_embedding, dtype=np.float32)
        norm = np.linalg.norm(q)
        if norm > 0:
            q = q / norm
        scores = self._dense_matrix @ q
        top_idx = np.argsort(scores)[::-1][:top_k]
        return [(self._dense_ids[i], float(scores[i])) for i in top_idx]

    def search(
        self,
        query: str,
        query_embedding: Optional[List[float]] = None,
        top_k: int = 5,
        dense_weight: float = 0.6,
        sparse_weight: float = 0.4,
    ) -> List[GuidelineChunk]:
        """Hybrid search over guideline chunks.

        Args:
            query: Search query text.
            query_embedding: Pre-computed embedding vector. If None, only BM25 is used.
            top_k: Number of results to return.
            dense_weight: Weight for dense scores.
            sparse_weight: Weight for BM25 scores.

        Returns:
            List of GuidelineChunk results sorted by relevance.
        """
        if not self._load():
            return []

        # Dynamic weight for CJK
        if _CJK_RE.search(query):
            cjk_keywords = []
            for zh in _CJK_MEDICAL_TERMS:
                if zh in query:
                    cjk_keywords.extend(_CJK_MEDICAL_TERMS[zh])
            if cjk_keywords:
                dense_weight, sparse_weight = 0.75, 0.25
            else:
                dense_weight, sparse_weight = 0.90, 0.10

        # Score fusion
        fused: Dict[str, float] = {}

        if query_embedding:
            for doc_id, score in self._dense_search(query_embedding, top_k=30):
                fused[doc_id] = fused.get(doc_id, 0) + dense_weight * score

        for doc_id, score in self._bm25_search(query, top_k=30):
            fused[doc_id] = fused.get(doc_id, 0) + sparse_weight * score

        # Sort and build results
        ranked = sorted(fused.items(), key=lambda x: -x[1])[:top_k]
        results = []
        for doc_id, score in ranked:
            c = self._chunks.get(doc_id)
            if not c:
                continue
            meta = c.get("meta_enriched", {})
            results.append(GuidelineChunk(
                chunk_id=doc_id,
                text=c.get("text", ""),
                score=round(score, 4),
                source_name=c.get("short_name", ""),
                section_path=c.get("section_path", ""),
                page_label=f"p.{c.get('page_label_start', '')}",
                year=c.get("year", 0),
                topic=meta.get("topic", ""),
                is_recommendation=bool(meta.get("is_recommendation")),
                recommendation_strength=meta.get("recommendation_strength"),
                drugs_mentioned=meta.get("drugs_mentioned", []),
            ))
        return results

    def available(self) -> bool:
        """Check if guideline indices are loadable."""
        return self._load()


# Module-level singleton
guideline_rag_client = GuidelineRagClient()
