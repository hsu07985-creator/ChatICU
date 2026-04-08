"""Evidence Fuser — Multi-source evidence fusion for the query orchestrator (B06).

Merges evidence from Source A (Clinical RAG), Source B (Drug RAG / Qdrant),
and Source C (Drug Graph / NetworkX) into a unified, ranked, and scored result.

Key responsibilities:
- Deduplication (exact chunk_id + word-level Jaccard similarity)
- Cross-source contradiction detection
- Weighted confidence scoring (relevance x grade x authority x agreement)
- Unified citation format
- Per-intent safety rules

All text processing is basic string operations -- no external NLP dependencies.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, Field

from app.services.drug_rag_client import EvidenceItem

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEDUP_SIMILARITY_THRESHOLD = 0.80

# Evidence grade -> numeric weight mapping
_EVIDENCE_GRADE_WEIGHTS: Dict[str, float] = {
    "1A": 1.0,
    "1a": 1.0,
    "1B": 0.9,
    "1b": 0.9,
    "2A": 0.8,
    "2a": 0.8,
    "2B": 0.75,
    "2b": 0.75,
    "2C": 0.7,
    "2c": 0.7,
    "curated": 0.85,
    "monograph": 0.7,
    "expert_opinion": 0.6,
}
_DEFAULT_GRADE_WEIGHT = 0.3

# Source system -> authority weight mapping
_SOURCE_AUTHORITY_WEIGHTS: Dict[str, float] = {
    "clinical_rag_guideline": 1.0,
    "drug_graph": 0.95,
    "drug_rag_qdrant": 0.8,
    "clinical_rag_pad": 0.9,
    "clinical_rag_nhi": 0.85,
}
_DEFAULT_AUTHORITY_WEIGHT = 0.5

# Contradiction signal words (lowercased)
_NEGATIVE_SIGNALS: Set[str] = {
    "avoid", "contraindicated", "do not use", "prohibited",
    "incompatible", "not recommended", "black box",
}
_POSITIVE_SIGNALS: Set[str] = {
    "safe", "compatible", "no action needed", "no interaction",
    "no significant interaction", "can be used together",
}

# Word-splitting pattern
_WORD_RE = re.compile(r"[a-zA-Z0-9\u4e00-\u9fff]+")


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class Citation(BaseModel):
    """Unified citation format for cross-source evidence."""

    citation_id: str = ""
    source_system: str = ""  # "clinical_rag_guideline" | "drug_rag_qdrant" | "drug_graph"
    source_file: Optional[str] = None
    text_snippet: str = ""  # First 200 chars of evidence text
    evidence_grade: str = ""  # "1A", "1B", "monograph", "curated", etc.
    relevance_score: float = 0.0
    drug_names: List[str] = Field(default_factory=list)


class FusedEvidence(BaseModel):
    """Result of multi-source evidence fusion."""

    items_ranked: List[EvidenceItem] = Field(default_factory=list)
    citations: List[Citation] = Field(default_factory=list)
    confidence: float = 0.0
    has_contradiction: bool = False
    contradiction_details: Optional[str] = None
    source_count: int = 0
    evidence_sufficient: bool = False
    safety_note: Optional[str] = None
    requires_expert_review: bool = False


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> Set[str]:
    """Extract lowercased word tokens from text."""
    return set(w.lower() for w in _WORD_RE.findall(text))


def _compute_text_similarity(text_a: str, text_b: str) -> float:
    """Simple word-level Jaccard similarity.

    Returns a float in [0.0, 1.0].
    """
    words_a = _tokenize(text_a)
    words_b = _tokenize(text_b)
    if not words_a and not words_b:
        return 1.0
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)


def _get_evidence_grade_weight(grade: str) -> float:
    """Map evidence grade string to numeric weight."""
    if not grade:
        return _DEFAULT_GRADE_WEIGHT
    return _EVIDENCE_GRADE_WEIGHTS.get(grade, _DEFAULT_GRADE_WEIGHT)


def _get_source_authority_weight(source_system: str) -> float:
    """Map source system identifier to authority weight."""
    if not source_system:
        return _DEFAULT_AUTHORITY_WEIGHT
    return _SOURCE_AUTHORITY_WEIGHTS.get(source_system, _DEFAULT_AUTHORITY_WEIGHT)


def _detect_contradictions(
    items: List[EvidenceItem],
    graph_result: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, Optional[str]]:
    """Check for cross-source contradictions.

    Rules:
    1. Structured data (Source C graph) overrides RAG text.
       If graph says "contraindicated" / risk X and a RAG item says "safe",
       that is a contradiction.
    2. Guideline (evidence_grade 1A/1B/2A/2B/2C) outranks monograph.
    3. Non-overlapping information merges without conflict.
    4. True contradiction: one item says "avoid"/"contraindicated" while
       another (for the same drug pair) says "safe"/"compatible"/"no action needed".

    Returns:
        (has_contradiction, human_readable_detail_or_None)
    """
    contradictions: List[str] = []

    # ── Rule 1: Graph vs RAG ──────────────────────────────────────────────
    if graph_result:
        graph_risk = str(graph_result.get("risk_level", graph_result.get("risk", ""))).upper()
        graph_is_negative = graph_risk in ("X", "D") or any(
            sig in str(graph_result).lower() for sig in _NEGATIVE_SIGNALS
        )
        if graph_is_negative:
            for item in items:
                if item.source_system == "drug_graph":
                    continue
                item_lower = item.text.lower()
                if any(sig in item_lower for sig in _POSITIVE_SIGNALS):
                    contradictions.append(
                        f"Graph reports risk '{graph_risk}' but "
                        f"{item.source_system} (chunk {item.chunk_id}) "
                        f"suggests safety/compatibility."
                    )

    # ── Rule 4: Pairwise contradiction among items ────────────────────────
    negative_items: List[EvidenceItem] = []
    positive_items: List[EvidenceItem] = []

    for item in items:
        text_lower = item.text.lower()
        if any(sig in text_lower for sig in _NEGATIVE_SIGNALS):
            negative_items.append(item)
        if any(sig in text_lower for sig in _POSITIVE_SIGNALS):
            positive_items.append(item)

    if negative_items and positive_items:
        # Check if they reference overlapping drugs
        neg_drugs: Set[str] = set()
        for ni in negative_items:
            neg_drugs.update(d.lower() for d in ni.drug_names)
        pos_drugs: Set[str] = set()
        for pi in positive_items:
            pos_drugs.update(d.lower() for d in pi.drug_names)

        # If both have drug names and they overlap, or if either has no drug names
        # (general statement), it is a contradiction.
        overlap = neg_drugs & pos_drugs
        either_empty = not neg_drugs or not pos_drugs
        if overlap or either_empty:
            neg_sources = ", ".join(
                sorted(set(ni.source_system for ni in negative_items))
            )
            pos_sources = ", ".join(
                sorted(set(pi.source_system for pi in positive_items))
            )
            contradictions.append(
                f"Contradiction: [{neg_sources}] indicates caution/avoidance "
                f"while [{pos_sources}] suggests safety."
            )

    if contradictions:
        # Deduplicate contradiction messages
        unique = list(dict.fromkeys(contradictions))
        return True, " | ".join(unique)

    return False, None


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def _dedup_items(items: List[EvidenceItem]) -> List[EvidenceItem]:
    """Remove near-duplicate evidence items.

    Primary: exact chunk_id match -- keep higher relevance_score.
    Secondary: word-level Jaccard > 0.80 -- keep higher relevance_score.
    """
    if not items:
        return []

    # Phase 1: chunk_id dedup
    by_id: Dict[str, EvidenceItem] = {}
    no_id: List[EvidenceItem] = []

    for item in items:
        cid = item.chunk_id.strip()
        if not cid:
            no_id.append(item)
            continue
        existing = by_id.get(cid)
        if existing is None or item.relevance_score > existing.relevance_score:
            by_id[cid] = item

    phase1 = list(by_id.values()) + no_id

    # Phase 2: text-similarity dedup
    kept: List[EvidenceItem] = []
    for candidate in phase1:
        is_dup = False
        for i, existing in enumerate(kept):
            sim = _compute_text_similarity(candidate.text, existing.text)
            if sim > _DEDUP_SIMILARITY_THRESHOLD:
                # Keep the one with higher score
                if candidate.relevance_score > existing.relevance_score:
                    kept[i] = candidate
                is_dup = True
                break
        if not is_dup:
            kept.append(candidate)

    return kept


# ---------------------------------------------------------------------------
# Citation Builder
# ---------------------------------------------------------------------------

def _build_citations(items: List[EvidenceItem]) -> List[Citation]:
    """Convert ranked EvidenceItems into unified Citation objects."""
    citations: List[Citation] = []
    for item in items:
        snippet = item.text[:200] if item.text else ""
        cid = item.chunk_id or f"{item.source_system}_unknown"
        citations.append(
            Citation(
                citation_id=cid,
                source_system=item.source_system,
                source_file=None,  # Not always available on EvidenceItem
                text_snippet=snippet,
                evidence_grade=item.evidence_grade,
                relevance_score=item.relevance_score,
                drug_names=list(item.drug_names),
            )
        )
    return citations


# ---------------------------------------------------------------------------
# Confidence Scoring
# ---------------------------------------------------------------------------

def _compute_confidence(
    items: List[EvidenceItem],
    has_contradiction: bool,
) -> float:
    """Weighted confidence score.

    confidence = weighted_sum([
        (max_relevance_score,       0.35),
        (evidence_grade_weight,     0.30),
        (source_authority_weight,   0.20),
        (cross_source_agreement,    0.15),
    ])
    """
    if not items:
        return 0.0

    # Component 1: max relevance score
    max_relevance = max(item.relevance_score for item in items)

    # Component 2: best evidence grade weight
    evidence_grade_weight = max(
        _get_evidence_grade_weight(item.evidence_grade) for item in items
    )

    # Component 3: best source authority weight
    source_authority_weight = max(
        _get_source_authority_weight(item.source_system) for item in items
    )

    # Component 4: cross-source agreement
    distinct_sources: Set[str] = set(item.source_system for item in items)
    if has_contradiction:
        cross_source_agreement = 0.2
    elif len(distinct_sources) >= 2:
        cross_source_agreement = 1.0
    else:
        cross_source_agreement = 0.5

    confidence = (
        max_relevance * 0.35
        + evidence_grade_weight * 0.30
        + source_authority_weight * 0.20
        + cross_source_agreement * 0.15
    )

    # Clamp to [0, 1]
    return max(0.0, min(1.0, confidence))


# ---------------------------------------------------------------------------
# Safety Rules
# ---------------------------------------------------------------------------

def _apply_safety_rules(
    fused: FusedEvidence,
    intent: str,
    confidence_threshold: float,
) -> None:
    """Apply per-intent safety rules, mutating *fused* in-place."""

    # ── dose_calculation ──────────────────────────────────────────────────
    if intent == "dose_calculation":
        has_dose = any(
            any(kw in item.text.lower() for kw in ("dose", "mg", "kg", "dosing", "dosage"))
            for item in fused.items_ranked
        )
        if not has_dose:
            fused.evidence_sufficient = False
            fused.safety_note = "知識庫中未找到此藥劑量資料。請諮詢藥師。"

    # ── iv_compatibility ──────────────────────────────────────────────────
    elif intent == "iv_compatibility":
        has_graph = any(
            item.source_system == "drug_graph"
            for item in fused.items_ranked
        )
        if not has_graph:
            fused.evidence_sufficient = False
            fused.safety_note = "此藥物組合無相容性資料。請查閱 IV 相容性參考。"
            fused.requires_expert_review = True

    # ── clinical_decision ─────────────────────────────────────────────────
    elif intent == "clinical_decision":
        # Check for patient-context evidence (Source A PAD or guideline)
        has_patient_context = any(
            item.source_system in ("clinical_rag_pad", "clinical_rag_guideline")
            for item in fused.items_ranked
        )
        if not has_patient_context:
            fused.safety_note = "臨床決策支援需要病人資料。"

    # ── Universal rules ───────────────────────────────────────────────────
    if fused.confidence < confidence_threshold:
        fused.requires_expert_review = True

    if fused.has_contradiction:
        fused.requires_expert_review = True


# ---------------------------------------------------------------------------
# Core Public API
# ---------------------------------------------------------------------------

async def fuse_evidence(
    evidence_items: List[EvidenceItem],
    intent: str,
    confidence_threshold: float = 0.55,
    graph_result: Optional[Dict[str, Any]] = None,
) -> FusedEvidence:
    """Fuse evidence from multiple sources into a unified result.

    Steps:
        1. Dedup -- remove near-duplicate chunks (same chunk_id or similar text)
        2. Rank  -- sort by relevance_score descending
        3. Detect conflicts -- check if sources disagree
        4. Compute confidence -- weighted scoring
        5. Build citations -- unified citation format
        6. Apply safety rules -- per-intent minimum evidence requirements

    Args:
        evidence_items: Raw evidence from one or more source adapters.
        intent: The classified query intent (e.g. "dose_calculation").
        confidence_threshold: Minimum confidence for ``evidence_sufficient``.
        graph_result: Optional raw Source C result dict for anchoring.

    Returns:
        A :class:`FusedEvidence` instance with ranked items, citations,
        confidence, and safety metadata.
    """
    # 1. Dedup
    deduped = _dedup_items(evidence_items)

    # 2. Rank by relevance_score descending
    ranked = sorted(deduped, key=lambda it: it.relevance_score, reverse=True)

    # 3. Contradiction detection
    has_contradiction, contradiction_details = _detect_contradictions(
        ranked, graph_result
    )

    # 4. Confidence
    confidence = _compute_confidence(ranked, has_contradiction)

    # 5. Citations
    citations = _build_citations(ranked)

    # 6. Assemble result
    distinct_sources: Set[str] = set(item.source_system for item in ranked)
    evidence_sufficient = confidence >= confidence_threshold

    fused = FusedEvidence(
        items_ranked=ranked,
        citations=citations,
        confidence=round(confidence, 4),
        has_contradiction=has_contradiction,
        contradiction_details=contradiction_details,
        source_count=len(distinct_sources),
        evidence_sufficient=evidence_sufficient,
        safety_note=None,
        requires_expert_review=False,
    )

    # 7. Safety rules (may override evidence_sufficient / requires_expert_review)
    _apply_safety_rules(fused, intent, confidence_threshold)

    logger.info(
        "[FUSER] intent=%s items=%d→%d sources=%d confidence=%.2f "
        "sufficient=%s contradiction=%s expert_review=%s",
        intent,
        len(evidence_items),
        len(ranked),
        fused.source_count,
        fused.confidence,
        fused.evidence_sufficient,
        fused.has_contradiction,
        fused.requires_expert_review,
    )

    return fused
