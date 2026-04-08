"""Tests for B11 citation_builder service."""

import pytest
from app.services.citation_builder import (
    build_citations_from_evidence,
    _truncate,
    _infer_grade,
    _extract_id,
)
from app.schemas.clinical import UnifiedCitationItem


# ── Helper factory ──────────────────────────────────────────────────────

def _make_chunk(**kwargs):
    """Build a minimal RAG chunk dict for testing."""
    defaults = {
        "chunk_id": "c001",
        "text": "This is a test evidence chunk about sedation management.",
        "score": 0.85,
        "source_file": "padis_guideline.pdf",
        "drug_names": [],
    }
    defaults.update(kwargs)
    return defaults


# ── 1. Basic citation building from RAG chunks ──────────────────────────

def test_build_citations_from_evidence_basic():
    chunks = [
        _make_chunk(chunk_id="c001", text="Sedation protocol text.", score=0.9),
        _make_chunk(chunk_id="c002", text="Analgesia first approach.", score=0.8),
    ]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert len(result) == 2
    assert all(isinstance(c, UnifiedCitationItem) for c in result)
    assert result[0].citation_id == "c001"
    assert result[0].source_system == "clinical_rag_guideline"
    assert result[0].relevance_score == 0.9
    assert result[0].text_snippet == "Sedation protocol text."


# ── 2. Text truncation at 200 chars ────────────────────────────────────

def test_truncate_short_text():
    text = "Short text."
    assert _truncate(text, 200) == "Short text."


def test_truncate_long_text():
    text = "A" * 250
    result = _truncate(text, 200)
    assert len(result) == 200
    assert result.endswith("...")
    assert result[:197] == "A" * 197


def test_truncate_exactly_200():
    text = "B" * 200
    result = _truncate(text, 200)
    assert result == text
    assert len(result) == 200


def test_truncate_empty_string():
    assert _truncate("", 200) == ""


def test_build_citations_truncates_text_snippet():
    long_text = "X" * 300
    chunks = [_make_chunk(text=long_text)]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert len(result) == 1
    assert len(result[0].text_snippet) == 200
    assert result[0].text_snippet.endswith("...")


# ── 3. Evidence grade inference for guideline source ───────────────────

def test_infer_grade_clinical_rag_guideline_no_meta():
    chunk = {"text": "some text"}
    grade = _infer_grade(chunk, "clinical_rag_guideline")
    assert grade == "guideline"


def test_infer_grade_clinical_rag_with_metadata():
    chunk = {
        "text": "text",
        "metadata": {
            "recommendation_strength": "1A",
            "evidence_quality": "high",
        },
    }
    grade = _infer_grade(chunk, "clinical_rag_guideline")
    assert grade == "1A/high"


def test_infer_grade_clinical_rag_with_meta_enriched():
    chunk = {
        "text": "text",
        "meta_enriched": {
            "recommendation_strength": "2B",
            "evidence_quality": "moderate",
        },
    }
    grade = _infer_grade(chunk, "clinical_rag_guideline")
    assert grade == "2B/moderate"


def test_infer_grade_clinical_rag_partial_meta():
    # Only strength but no quality → fallback to "guideline"
    chunk = {
        "text": "text",
        "metadata": {"recommendation_strength": "1A"},
    }
    grade = _infer_grade(chunk, "clinical_rag_guideline")
    assert grade == "guideline"


# ── 4. Evidence grade for drug_graph → "curated" ───────────────────────

def test_infer_grade_drug_graph():
    chunk = {"text": "interaction data"}
    grade = _infer_grade(chunk, "drug_graph")
    assert grade == "curated"


def test_build_citations_drug_graph_grade_is_curated():
    chunks = [_make_chunk(chunk_id="g001", text="[MAJOR] Warfarin + Aspirin risk")]
    result = build_citations_from_evidence(chunks, source_system="drug_graph")
    assert result[0].evidence_grade == "curated"


# ── 5. Evidence grade for drug_rag_qdrant → "monograph" ────────────────

def test_infer_grade_drug_rag_qdrant():
    chunk = {"text": "drug monograph text"}
    grade = _infer_grade(chunk, "drug_rag_qdrant")
    assert grade == "monograph"


def test_build_citations_drug_rag_qdrant_grade_is_monograph():
    chunks = [_make_chunk(chunk_id="m001", text="Vancomycin monograph")]
    result = build_citations_from_evidence(chunks, source_system="drug_rag_qdrant")
    assert result[0].evidence_grade == "monograph"


# ── 6. Unknown source → "unknown" ─────────────────────────────────────

def test_infer_grade_unknown_source():
    chunk = {"text": "some text"}
    grade = _infer_grade(chunk, "some_other_source")
    assert grade == "unknown"


# ── 7. max_citations limit ─────────────────────────────────────────────

def test_max_citations_limit():
    chunks = [_make_chunk(chunk_id=f"c{i}", text=f"Text {i}") for i in range(10)]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline", max_citations=3)
    assert len(result) == 3


def test_max_citations_default_is_5():
    chunks = [_make_chunk(chunk_id=f"c{i}", text=f"Text {i}") for i in range(8)]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert len(result) == 5


# ── 8. Empty evidence list → empty citations ──────────────────────────

def test_empty_evidence_list_returns_empty():
    result = build_citations_from_evidence([], source_system="clinical_rag_guideline")
    assert result == []


# ── 9. Chunks with missing fields → graceful defaults ─────────────────

def test_chunks_with_missing_chunk_id_uses_fallback():
    chunks = [{"text": "some text", "score": 0.5}]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert len(result) == 1
    assert result[0].citation_id == "chunk_0"


def test_chunks_with_alt_id_field():
    chunks = [{"id": "alt_id_001", "text": "some text", "score": 0.5}]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert result[0].citation_id == "alt_id_001"


def test_chunks_with_missing_text_uses_empty_string():
    chunks = [{"chunk_id": "c001", "score": 0.5}]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert result[0].text_snippet == ""


def test_chunks_with_content_field_instead_of_text():
    chunks = [{"chunk_id": "c001", "content": "Evidence content here.", "score": 0.7}]
    result = build_citations_from_evidence(chunks, source_system="drug_rag_qdrant")
    assert result[0].text_snippet == "Evidence content here."


def test_chunks_with_missing_score_defaults_to_zero():
    chunks = [{"chunk_id": "c001", "text": "text without score"}]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert result[0].relevance_score == 0.0


def test_chunks_with_relevance_score_field():
    chunks = [{"chunk_id": "c001", "text": "text", "relevance_score": 0.77}]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert result[0].relevance_score == 0.77


def test_chunks_with_alt_source_field():
    chunks = [{"chunk_id": "c001", "text": "text", "source": "doc.pdf", "score": 0.5}]
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    assert result[0].source_file == "doc.pdf"


def test_chunks_with_drug_names():
    chunks = [{"chunk_id": "c001", "text": "text", "score": 0.5, "drug_names": ["Warfarin", "Aspirin"]}]
    result = build_citations_from_evidence(chunks, source_system="drug_graph")
    assert result[0].drug_names == ["Warfarin", "Aspirin"]


def test_explicit_evidence_grade_takes_priority():
    chunk = {"chunk_id": "c001", "text": "text", "score": 0.5, "evidence_grade": "1A"}
    result = build_citations_from_evidence([chunk], source_system="clinical_rag_guideline")
    assert result[0].evidence_grade == "1A"


def test_build_citations_graceful_on_bad_chunk():
    """Malformed chunk (non-numeric score) should be skipped, not crash."""
    chunks = [
        {"chunk_id": "c001", "text": "good chunk", "score": 0.9},
        {"chunk_id": "c002", "text": "bad chunk", "score": "not_a_float_!!!"},
        {"chunk_id": "c003", "text": "good chunk 2", "score": 0.7},
    ]
    # Should not raise; bad chunk gets skipped
    result = build_citations_from_evidence(chunks, source_system="clinical_rag_guideline")
    # At minimum the good chunks should be present
    good_ids = {c.citation_id for c in result}
    assert "c001" in good_ids
