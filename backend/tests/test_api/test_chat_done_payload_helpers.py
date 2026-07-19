"""F02/F04/F19 (2026-07-20): chat done-payload enrichment helpers.

The frontend plumbing (references section, ExpertReviewWarning banner,
DrugInteractionBadges) has existed since Wave 4 but was starved — the done
payload hardcoded citations=web-only, safetyWarnings=None,
requiresExpertReview=False, graphMeta=None. These tests pin the feeding
logic.
"""
from __future__ import annotations

from app.routers.ai_chat import _graph_meta_from_prefetch, _snapshot_source_citations
from app.services.ai_question_prefetch import _finding_to_interaction_ref


# ── F02: snapshot source citations ────────────────────────────────────────────

def test_snapshot_citations_extracted_with_patient_data_type():
    reply = (
        "目前 K 3.2 偏低(依【關鍵檢驗】K: 3.2)。"
        "KCl 已在使用(依【用藥】KCl 10% 20 mEq q12h IV)。"
    )
    cits = _snapshot_source_citations(reply)
    assert [c["title"] for c in cits] == ["【關鍵檢驗】", "【用藥】"]
    assert all(c["type"] == "patient-data" for c in cits)
    assert all(c["source"] == "病人資料快照" for c in cits)
    assert cits[1]["snippet"].startswith("KCl 10%")


def test_snapshot_citations_empty_reply():
    assert _snapshot_source_citations("") == []
    assert _snapshot_source_citations("無引用的回覆") == []


# ── F19: interaction finding → badge ref ─────────────────────────────────────

def test_finding_to_ref_uses_db_risk_rating():
    ref = _finding_to_interaction_ref({
        "drug_a": "Heparin", "drug_b": "Ketorolac", "severity": "major",
        "risk_rating": "d", "clinical_effect": "出血風險增加",
    })
    assert ref == {
        "drug_a": "Heparin", "drug_b": "Ketorolac", "risk": "D",
        "title": "出血風險增加", "severity": "major",
    }


def test_finding_to_ref_severity_fallback():
    ref = _finding_to_interaction_ref({
        "drug_a": "A", "drug_b": "B", "severity": "contraindicated",
        "risk_rating": "", "clinical_effect": "", "mechanism": "mech",
    })
    assert ref["risk"] == "X"
    assert ref["title"] == "mech"


def test_graph_meta_none_without_refs():
    assert _graph_meta_from_prefetch(None) is None
    assert _graph_meta_from_prefetch({}) is None
    assert _graph_meta_from_prefetch({"interactionRefs": []}) is None


def test_graph_meta_has_risk_x_flag():
    meta = _graph_meta_from_prefetch({"interactionRefs": [
        {"drug_a": "A", "drug_b": "B", "risk": "C"},
        {"drug_a": "C", "drug_b": "D", "risk": "X"},
    ]})
    assert meta["has_risk_x"] is True
    assert len(meta["interactions"]) == 2
