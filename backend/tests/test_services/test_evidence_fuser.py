"""Tests for evidence_fuser.py — multi-source evidence fusion (B06).

Covers: dedup, ranking, contradiction detection, confidence scoring,
citation generation, safety rules, serialization.
"""

from __future__ import annotations

import pytest

from app.services.drug_rag_client import EvidenceItem
from app.services.evidence_fuser import (
    Citation,
    FusedEvidence,
    _build_citations,
    _compute_confidence,
    _compute_text_similarity,
    _dedup_items,
    _detect_contradictions,
    _get_evidence_grade_weight,
    _get_source_authority_weight,
    fuse_evidence,
)


# ---------------------------------------------------------------------------
# Helpers — reusable evidence builders
# ---------------------------------------------------------------------------

def _item(
    chunk_id: str = "",
    text: str = "sample evidence",
    source_system: str = "drug_rag_qdrant",
    relevance_score: float = 0.75,
    drug_names: list = None,
    evidence_grade: str = "monograph",
) -> EvidenceItem:
    return EvidenceItem(
        chunk_id=chunk_id,
        text=text,
        source_system=source_system,
        relevance_score=relevance_score,
        drug_names=drug_names or [],
        evidence_grade=evidence_grade,
    )


# ===================================================================
# 1. Basic fusion with single source -- no contradiction
# ===================================================================

@pytest.mark.asyncio
async def test_basic_single_source_no_contradiction():
    items = [
        _item(chunk_id="c1", text="Vancomycin dose 15-20 mg/kg", relevance_score=0.85),
        _item(chunk_id="c2", text="Monitor trough levels", relevance_score=0.70),
    ]
    result = await fuse_evidence(items, intent="dose_calculation")

    assert isinstance(result, FusedEvidence)
    assert len(result.items_ranked) == 2
    assert result.has_contradiction is False
    assert result.contradiction_details is None
    assert result.source_count == 1  # both from drug_rag_qdrant


# ===================================================================
# 2. Dedup by exact chunk_id
# ===================================================================

def test_dedup_exact_chunk_id():
    items = [
        _item(chunk_id="dup1", text="Text A", relevance_score=0.6),
        _item(chunk_id="dup1", text="Text A variant", relevance_score=0.9),
        _item(chunk_id="unique", text="Other text", relevance_score=0.5),
    ]
    deduped = _dedup_items(items)
    ids = [it.chunk_id for it in deduped]
    assert "dup1" in ids
    assert "unique" in ids
    assert len(deduped) == 2
    # Higher score should survive
    dup_item = next(it for it in deduped if it.chunk_id == "dup1")
    assert dup_item.relevance_score == 0.9


# ===================================================================
# 3. Dedup by text similarity (>80% overlap)
# ===================================================================

def test_dedup_text_similarity():
    base = "Vancomycin is administered intravenously for serious infections"
    # Near-identical text (>80% overlap)
    variant = "Vancomycin is administered intravenously for serious bacterial infections"
    items = [
        _item(chunk_id="a1", text=base, relevance_score=0.7),
        _item(chunk_id="a2", text=variant, relevance_score=0.9),
        _item(chunk_id="a3", text="Completely different topic about aspirin", relevance_score=0.6),
    ]
    deduped = _dedup_items(items)
    # base and variant should merge; aspirin stays
    assert len(deduped) == 2
    # The higher-score variant should survive
    scores = sorted([it.relevance_score for it in deduped], reverse=True)
    assert scores[0] == 0.9


# ===================================================================
# 4. Ranking by relevance_score
# ===================================================================

@pytest.mark.asyncio
async def test_ranking_by_relevance_score():
    items = [
        _item(chunk_id="low", relevance_score=0.3),
        _item(chunk_id="high", relevance_score=0.95),
        _item(chunk_id="mid", relevance_score=0.6),
    ]
    result = await fuse_evidence(items, intent="drug_monograph")
    scores = [it.relevance_score for it in result.items_ranked]
    assert scores == sorted(scores, reverse=True)
    assert result.items_ranked[0].chunk_id == "high"


# ===================================================================
# 5. Confidence scoring -- high-quality evidence (1A guideline)
# ===================================================================

@pytest.mark.asyncio
async def test_confidence_high_quality():
    items = [
        _item(
            chunk_id="g1",
            text="PADIS guideline recommends...",
            source_system="clinical_rag_guideline",
            relevance_score=0.92,
            evidence_grade="1A",
        ),
        _item(
            chunk_id="g2",
            text="Drug monograph supports...",
            source_system="drug_rag_qdrant",
            relevance_score=0.80,
            evidence_grade="monograph",
        ),
    ]
    result = await fuse_evidence(items, intent="clinical_guideline")
    # 1A guideline + multi-source → high confidence
    assert result.confidence > 0.80
    assert result.source_count == 2


# ===================================================================
# 6. Confidence scoring -- low-quality evidence (no grade, single source)
# ===================================================================

@pytest.mark.asyncio
async def test_confidence_low_quality():
    items = [
        _item(
            chunk_id="x1",
            text="Some vague text",
            source_system="drug_rag_qdrant",
            relevance_score=0.35,
            evidence_grade="",
        ),
    ]
    result = await fuse_evidence(items, intent="dose_calculation", confidence_threshold=0.75)
    # Low relevance, no grade, single source → low confidence
    assert result.confidence < 0.60
    assert result.requires_expert_review is True


# ===================================================================
# 7. Contradiction: Graph says X risk + RAG says safe
# ===================================================================

def test_contradiction_graph_vs_rag():
    items = [
        _item(
            chunk_id="graph1",
            text="Risk X: contraindicated combination",
            source_system="drug_graph",
            drug_names=["warfarin", "aspirin"],
        ),
        _item(
            chunk_id="rag1",
            text="This combination is safe and compatible for most patients",
            source_system="drug_rag_qdrant",
            drug_names=["warfarin", "aspirin"],
        ),
    ]
    graph_result = {"risk_level": "X", "drug_a": "warfarin", "drug_b": "aspirin"}
    has_c, details = _detect_contradictions(items, graph_result)
    assert has_c is True
    assert details is not None
    assert "Graph" in details or "safety" in details.lower() or "risk" in details.lower()


# ===================================================================
# 8. No contradiction when sources agree
# ===================================================================

def test_no_contradiction_when_sources_agree():
    items = [
        _item(
            chunk_id="g1",
            text="Avoid concurrent use due to high bleeding risk",
            source_system="drug_graph",
            drug_names=["warfarin", "aspirin"],
        ),
        _item(
            chunk_id="r1",
            text="Avoid this combination; increased bleeding",
            source_system="drug_rag_qdrant",
            drug_names=["warfarin", "aspirin"],
        ),
    ]
    has_c, details = _detect_contradictions(items, None)
    assert has_c is False
    assert details is None


# ===================================================================
# 9. Citation generation format
# ===================================================================

def test_citation_format():
    items = [
        _item(
            chunk_id="src_a_guideline_chunk_042",
            text="For adult ICU patients on mechanical ventilation, light sedation...",
            source_system="clinical_rag_guideline",
            relevance_score=0.87,
            drug_names=["dexmedetomidine"],
            evidence_grade="1B",
        ),
    ]
    citations = _build_citations(items)
    assert len(citations) == 1
    c = citations[0]
    assert isinstance(c, Citation)
    assert c.citation_id == "src_a_guideline_chunk_042"
    assert c.source_system == "clinical_rag_guideline"
    assert c.evidence_grade == "1B"
    assert c.relevance_score == 0.87
    assert "dexmedetomidine" in c.drug_names
    assert len(c.text_snippet) <= 200


# ===================================================================
# 10. Safety: dose_calculation with no dose evidence → insufficient
# ===================================================================

@pytest.mark.asyncio
async def test_safety_dose_no_dose_evidence():
    items = [
        _item(
            chunk_id="misc",
            text="This drug is metabolized by CYP3A4 enzymes in the liver",
            relevance_score=0.80,
        ),
    ]
    result = await fuse_evidence(
        items, intent="dose_calculation", confidence_threshold=0.55
    )
    assert result.evidence_sufficient is False
    assert result.safety_note is not None
    assert "劑量" in result.safety_note


# ===================================================================
# 11. Safety: iv_compatibility with no graph data → insufficient + expert
# ===================================================================

@pytest.mark.asyncio
async def test_safety_iv_no_graph():
    items = [
        _item(
            chunk_id="rag_iv",
            text="Dexmedetomidine solution info",
            source_system="drug_rag_qdrant",
            relevance_score=0.70,
        ),
    ]
    result = await fuse_evidence(
        items, intent="iv_compatibility", confidence_threshold=0.90
    )
    assert result.evidence_sufficient is False
    assert result.requires_expert_review is True
    assert result.safety_note is not None
    assert "相容性" in result.safety_note


# ===================================================================
# 12. Safety: confidence below threshold → requires expert review
# ===================================================================

@pytest.mark.asyncio
async def test_safety_confidence_below_threshold():
    items = [
        _item(chunk_id="lo", relevance_score=0.30, evidence_grade=""),
    ]
    result = await fuse_evidence(
        items, intent="pair_interaction", confidence_threshold=0.80
    )
    assert result.confidence < 0.80
    assert result.requires_expert_review is True


# ===================================================================
# 13. Empty evidence items → low confidence, insufficient
# ===================================================================

@pytest.mark.asyncio
async def test_empty_evidence():
    result = await fuse_evidence([], intent="drug_monograph", confidence_threshold=0.55)
    assert result.confidence == 0.0
    assert result.evidence_sufficient is False
    assert len(result.items_ranked) == 0
    assert len(result.citations) == 0
    assert result.source_count == 0


# ===================================================================
# 14. Multiple sources agreeing → higher cross-source agreement
# ===================================================================

@pytest.mark.asyncio
async def test_multi_source_agreement_boost():
    single = [
        _item(
            chunk_id="s1",
            text="Warfarin dose adjustment",
            source_system="drug_rag_qdrant",
            relevance_score=0.80,
            evidence_grade="monograph",
        ),
    ]
    multi = [
        _item(
            chunk_id="m1",
            text="Warfarin dose adjustment info",
            source_system="drug_rag_qdrant",
            relevance_score=0.80,
            evidence_grade="monograph",
        ),
        _item(
            chunk_id="m2",
            text="Guideline recommends warfarin dose adjustment",
            source_system="clinical_rag_guideline",
            relevance_score=0.80,
            evidence_grade="monograph",
        ),
    ]
    r_single = await fuse_evidence(single, intent="drug_monograph")
    r_multi = await fuse_evidence(multi, intent="drug_monograph")
    # Multi-source should have higher confidence due to cross_source_agreement
    assert r_multi.confidence > r_single.confidence
    assert r_multi.source_count == 2
    assert r_single.source_count == 1


# ===================================================================
# 15. FusedEvidence model serialization (dict / JSON)
# ===================================================================

@pytest.mark.asyncio
async def test_fused_evidence_serialization():
    items = [
        _item(
            chunk_id="ser1",
            text="Sample text for serialization",
            relevance_score=0.8,
            drug_names=["aspirin"],
        ),
    ]
    result = await fuse_evidence(items, intent="drug_monograph")
    d = result.model_dump()
    assert isinstance(d, dict)
    assert "items_ranked" in d
    assert "citations" in d
    assert "confidence" in d
    assert "has_contradiction" in d
    assert "evidence_sufficient" in d
    assert isinstance(d["items_ranked"], list)
    assert isinstance(d["citations"], list)

    # Roundtrip
    rebuilt = FusedEvidence(**d)
    assert rebuilt.confidence == result.confidence
    assert len(rebuilt.items_ranked) == len(result.items_ranked)


# ===================================================================
# 16. (Bonus) Text similarity helper
# ===================================================================

def test_text_similarity_identical():
    assert _compute_text_similarity("hello world", "hello world") == 1.0


def test_text_similarity_no_overlap():
    assert _compute_text_similarity("apple banana", "cherry date") == 0.0


def test_text_similarity_partial():
    sim = _compute_text_similarity("the quick brown fox", "the quick red fox")
    assert 0.5 < sim < 1.0


def test_text_similarity_empty():
    assert _compute_text_similarity("", "") == 1.0
    assert _compute_text_similarity("word", "") == 0.0


# ===================================================================
# 17. (Bonus) Grade & authority weight helpers
# ===================================================================

def test_grade_weights():
    assert _get_evidence_grade_weight("1A") == 1.0
    assert _get_evidence_grade_weight("1B") == 0.9
    assert _get_evidence_grade_weight("curated") == 0.85
    assert _get_evidence_grade_weight("monograph") == 0.7
    assert _get_evidence_grade_weight("") == 0.3
    assert _get_evidence_grade_weight("unknown_grade") == 0.3


def test_authority_weights():
    assert _get_source_authority_weight("clinical_rag_guideline") == 1.0
    assert _get_source_authority_weight("drug_graph") == 0.95
    assert _get_source_authority_weight("drug_rag_qdrant") == 0.8
    assert _get_source_authority_weight("") == 0.5
    assert _get_source_authority_weight("unknown_system") == 0.5


# ===================================================================
# 18. (Bonus) Contradiction with has_contradiction → expert review
# ===================================================================

@pytest.mark.asyncio
async def test_contradiction_triggers_expert_review():
    items = [
        _item(
            chunk_id="neg1",
            text="Contraindicated combination, avoid concurrent use",
            source_system="drug_graph",
            drug_names=["drug_a"],
            relevance_score=0.9,
        ),
        _item(
            chunk_id="pos1",
            text="This combination is safe and well-tolerated",
            source_system="drug_rag_qdrant",
            drug_names=["drug_a"],
            relevance_score=0.8,
        ),
    ]
    result = await fuse_evidence(items, intent="pair_interaction")
    assert result.has_contradiction is True
    assert result.requires_expert_review is True
    assert result.contradiction_details is not None


# ===================================================================
# 19. (Bonus) clinical_decision safety note when no patient context
# ===================================================================

@pytest.mark.asyncio
async def test_safety_clinical_decision_no_patient_context():
    items = [
        _item(
            chunk_id="d1",
            text="Standard dose info for propofol",
            source_system="drug_rag_qdrant",
            relevance_score=0.75,
        ),
    ]
    result = await fuse_evidence(items, intent="clinical_decision")
    assert result.safety_note is not None
    assert "臨床決策" in result.safety_note


# ===================================================================
# 20. (Bonus) iv_compatibility with graph data → sufficient
# ===================================================================

@pytest.mark.asyncio
async def test_iv_compatibility_with_graph_sufficient():
    items = [
        _item(
            chunk_id="iv1",
            text="Compatible via Y-site at standard concentrations. dose 5mg/mL",
            source_system="drug_graph",
            relevance_score=0.95,
            evidence_grade="curated",
        ),
    ]
    result = await fuse_evidence(
        items, intent="iv_compatibility", confidence_threshold=0.55
    )
    # Has graph source → should not trigger iv_compatibility safety block
    assert result.evidence_sufficient is True
    assert result.safety_note is None or "相容性" not in (result.safety_note or "")
