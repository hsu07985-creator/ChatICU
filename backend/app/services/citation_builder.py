"""Citation Builder (B11) — Converts RAG evidence chunks to unified citation format.

This module provides a reusable helper for building UnifiedCitationItem objects
from heterogeneous RAG evidence sources (clinical RAG, drug RAG Qdrant, drug graph).

All citation building is wrapped to be non-fatal: exceptions are caught and logged
so that callers (clinical endpoints) are never broken by citation failures.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from app.schemas.clinical import UnifiedCitationItem

logger = logging.getLogger(__name__)


def build_citations_from_evidence(
    evidence_chunks: List[Dict],
    source_system: str,
    max_citations: int = 5,
) -> List[UnifiedCitationItem]:
    """Convert RAG evidence chunks to unified citation format.

    Args:
        evidence_chunks: List of chunk dicts from RAG (format varies by source).
            Expected keys (any subset):
              - chunk_id / id: unique identifier
              - source_file / source: originating document
              - text / content: evidence text
              - score / relevance_score: float in [0, 1]
              - evidence_grade: pre-assigned grade string
              - drug_names: list of drug name strings
              - metadata / meta_enriched: dict with recommendation_strength, evidence_quality
        source_system: e.g., "clinical_rag_guideline", "drug_rag_qdrant", "drug_graph"
        max_citations: Maximum number of citations to return.

    Returns:
        List of UnifiedCitationItem objects (at most max_citations long).
        Returns empty list on any failure.
    """
    if not evidence_chunks:
        return []

    citations: List[UnifiedCitationItem] = []
    for chunk in evidence_chunks[:max_citations]:
        try:
            citation = UnifiedCitationItem(
                citation_id=_extract_id(chunk, len(citations)),
                source_system=source_system,
                source_file=chunk.get("source_file") or chunk.get("source") or None,
                text_snippet=_truncate(
                    chunk.get("text") or chunk.get("content") or "", 200
                ),
                evidence_grade=_infer_grade(chunk, source_system),
                relevance_score=float(
                    chunk.get("score") or chunk.get("relevance_score") or 0.0
                ),
                drug_names=list(chunk.get("drug_names") or []),
            )
            citations.append(citation)
        except Exception as exc:
            logger.warning(
                "[B11][citation_builder] Skipping chunk due to error: %s", str(exc)[:200]
            )
            continue

    return citations


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _extract_id(chunk: Dict, fallback_index: int) -> str:
    """Extract citation_id from a chunk dict."""
    cid = chunk.get("chunk_id") or chunk.get("id")
    if cid is not None:
        return str(cid)
    return f"chunk_{fallback_index}"


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max_len characters, appending '...' if truncated."""
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _infer_grade(chunk: Dict, source_system: str) -> str:
    """Infer evidence grade from chunk metadata and source system.

    Priority:
    1. Explicit evidence_grade field on the chunk
    2. Source system heuristics:
       - drug_graph     → "curated"
       - clinical_rag*  → check metadata for recommendation_strength/evidence_quality
                          → fallback "guideline"
       - drug_rag_qdrant → "monograph"
    3. Default → "unknown"
    """
    # 1. Explicit field wins
    if chunk.get("evidence_grade"):
        return str(chunk["evidence_grade"])

    # 2. Source system heuristics
    if source_system == "drug_graph":
        return "curated"

    if source_system.startswith("clinical_rag"):
        meta = chunk.get("metadata") or chunk.get("meta_enriched") or {}
        if isinstance(meta, dict):
            strength = meta.get("recommendation_strength", "")
            quality = meta.get("evidence_quality", "")
            if strength and quality:
                return f"{strength}/{quality}"
        return "guideline"

    if source_system == "drug_rag_qdrant":
        return "monograph"

    return "unknown"
