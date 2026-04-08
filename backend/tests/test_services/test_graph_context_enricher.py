"""Tests for graph_context_enricher (B09).

Covers 11 required scenarios:
1.  Two drugs with a known interaction → context is enriched.
2.  Two drugs, no interaction found → context unchanged.
3.  One drug detected → no enrichment (need 2+).
4.  Zero drugs detected → no enrichment.
5.  Graph not available (is_ready returns False) → original context returned.
6.  Risk-X interaction → "禁忌" warning in enriched context.
7.  Risk-D interaction → "考慮調整" in enriched context.
8.  Metadata has correct fields (drugs_found, interactions, has_risk_x).
9.  drugs_hint parameter bypasses text detection.
10. Exception inside graph lookup → graceful fallback with original context.
11. Multiple drug pairs → only pairs with interactions are included.

Patching strategy:
  `app.services.graph_context_enricher.drug_graph_bridge`  — replaces the
      module-level bridge singleton used by enrich_with_graph_context().
  `app.services.graph_context_enricher.detect_drugs_from_text`  — replaces
      the module-level function reference used for drug detection.
"""

import asyncio
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Module-level patch targets (must match the import names in the module)
# ---------------------------------------------------------------------------
_BRIDGE_PATH = "app.services.graph_context_enricher.drug_graph_bridge"
_DETECT_PATH = "app.services.graph_context_enricher.detect_drugs_from_text"


# ---------------------------------------------------------------------------
# Force module import once so patch targets resolve at collection time
# ---------------------------------------------------------------------------
import app.services.graph_context_enricher  # noqa: E402  (side-effect import)
from app.services.graph_context_enricher import enrich_with_graph_context  # noqa: E402


# ---------------------------------------------------------------------------
# Helper — build a realistic interaction row as returned by DrugGraphBridge
# ---------------------------------------------------------------------------

def _make_interaction(
    drug1: str = "Warfarin",
    drug2: str = "Aspirin",
    risk_level: str = "D",
    title: str = "Increased Bleeding Risk",
    summary: str = "Combination increases haemorrhage risk.",
    management: str = "Monitor INR closely.",
) -> Dict[str, Any]:
    """Create a mock interaction dict matching _interaction_to_api_row output."""
    severity_map = {"X": "contraindicated", "D": "major", "C": "moderate", "B": "minor"}
    return {
        "id": f"graphint_{drug1.lower()}_{drug2.lower()}_{risk_level.lower()}",
        "drug1": drug1,
        "drug2": drug2,
        "severity": severity_map.get(risk_level, "unknown"),
        "mechanism": summary,
        "clinicalEffect": summary,
        "management": management,
        "references": "",
        "source": "drug_graph",
        "riskLevel": risk_level,
        "title": title,
        "sourceFile": "",
    }


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _mock_bridge(
    is_ready: bool = True,
    interactions: Optional[List[dict]] = None,
    raise_on_search: bool = False,
) -> MagicMock:
    bridge = MagicMock()
    bridge.is_ready.return_value = is_ready
    if raise_on_search:
        bridge.search_interactions.side_effect = RuntimeError("graph error")
    else:
        bridge.search_interactions.return_value = interactions if interactions is not None else []
    return bridge


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

class TestEnrichWithGraphContext:

    # 1. Two drugs with a known interaction → context enriched
    def test_two_drugs_with_interaction_enriches_context(self):
        interaction = _make_interaction("Warfarin", "Aspirin", "D")
        bridge = _mock_bridge(interactions=[interaction])

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Warfarin", "Aspirin"]):
                return await enrich_with_graph_context(
                    question="What is the interaction between Warfarin and Aspirin?",
                    existing_context="Some rag context.",
                )

        enriched, meta = asyncio.run(_run())
        assert "藥物交互作用資料" in enriched
        assert "Warfarin" in enriched
        assert "Aspirin" in enriched
        assert meta["graph_available"] is True
        assert len(meta["interactions"]) == 1

    # 2. Two drugs, no interaction found → context unchanged
    def test_two_drugs_no_interaction_context_unchanged(self):
        bridge = _mock_bridge(interactions=[])
        original = "Original context."

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Vancomycin", "Furosemide"]):
                return await enrich_with_graph_context(
                    question="Vancomycin and Furosemide together?",
                    existing_context=original,
                )

        enriched, meta = asyncio.run(_run())
        assert enriched == original
        assert meta["interactions"] == []
        assert meta["has_risk_x"] is False
        assert meta["has_risk_d"] is False

    # 3. One drug detected → no enrichment
    def test_single_drug_no_enrichment(self):
        bridge = _mock_bridge()
        original = "ctx"

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Insulin"]):
                return await enrich_with_graph_context(
                    question="Insulin dosing?",
                    existing_context=original,
                )

        enriched, meta = asyncio.run(_run())
        assert enriched == original
        assert meta["interactions"] == []
        bridge.search_interactions.assert_not_called()

    # 4. Zero drugs detected → no enrichment
    def test_no_drugs_no_enrichment(self):
        bridge = _mock_bridge()
        original = "Some context."

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=[]):
                return await enrich_with_graph_context(
                    question="What is the weather?",
                    existing_context=original,
                )

        enriched, meta = asyncio.run(_run())
        assert enriched == original
        assert meta["interactions"] == []
        bridge.search_interactions.assert_not_called()

    # 5. Graph not available → original context returned
    def test_graph_not_ready_returns_original(self):
        bridge = _mock_bridge(is_ready=False)
        original = "my context"

        async def _run():
            with patch(_BRIDGE_PATH, bridge):
                return await enrich_with_graph_context(
                    question="Warfarin and Aspirin?",
                    existing_context=original,
                )

        enriched, meta = asyncio.run(_run())
        assert enriched == original
        assert meta["graph_available"] is False

    # 6. Risk-X interaction → "禁忌" in context
    def test_risk_x_interaction_shows_contraindicated_warning(self):
        interaction = _make_interaction(
            "Clopidogrel", "Omeprazole", risk_level="X",
            title="Reduced antiplatelet effect",
        )
        bridge = _mock_bridge(interactions=[interaction])

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Clopidogrel", "Omeprazole"]):
                return await enrich_with_graph_context(
                    question="Clopidogrel and Omeprazole?",
                )

        enriched, meta = asyncio.run(_run())
        assert "禁忌" in enriched
        assert "Risk X" in enriched
        assert meta["has_risk_x"] is True

    # 7. Risk-D interaction → "考慮調整" in context
    def test_risk_d_interaction_shows_adjust_note(self):
        interaction = _make_interaction(
            "Warfarin", "Amiodarone", risk_level="D",
            title="Potentiated anticoagulation",
        )
        bridge = _mock_bridge(interactions=[interaction])

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Warfarin", "Amiodarone"]):
                return await enrich_with_graph_context(
                    question="Can we give Warfarin and Amiodarone together?",
                )

        enriched, meta = asyncio.run(_run())
        assert "考慮調整" in enriched
        assert "Risk D" in enriched
        assert meta["has_risk_d"] is True
        assert meta["has_risk_x"] is False

    # 8. Metadata has correct fields
    def test_metadata_has_required_fields(self):
        interaction = _make_interaction("Heparin", "Warfarin", risk_level="C")
        bridge = _mock_bridge(interactions=[interaction])

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Heparin", "Warfarin"]):
                _, meta = await enrich_with_graph_context(
                    question="Heparin and Warfarin?",
                )
                return meta

        meta = asyncio.run(_run())
        assert "graph_available" in meta
        assert "drugs_found" in meta
        assert "interactions" in meta
        assert "has_risk_x" in meta
        assert "has_risk_d" in meta
        assert meta["graph_available"] is True
        assert "Heparin" in meta["drugs_found"]
        assert "Warfarin" in meta["drugs_found"]
        assert isinstance(meta["interactions"], list)
        assert len(meta["interactions"]) == 1
        assert isinstance(meta["has_risk_x"], bool)
        assert isinstance(meta["has_risk_d"], bool)

    # 9. drugs_hint bypasses text detection
    def test_drugs_hint_bypasses_text_detection(self):
        interaction = _make_interaction("Metformin", "Ibuprofen", risk_level="B")
        bridge = _mock_bridge(interactions=[interaction])
        detect_called_flag = {"called": False}

        def _fake_detect(text: str) -> List[str]:
            detect_called_flag["called"] = True
            return []

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, side_effect=_fake_detect):
                enriched, meta = await enrich_with_graph_context(
                    question="any question",
                    drugs_hint=["Metformin", "Ibuprofen"],
                )
                return enriched, meta

        enriched, meta = asyncio.run(_run())
        assert detect_called_flag["called"] is False, (
            "detect_drugs_from_text must not be called when drugs_hint is given"
        )
        assert "Metformin" in meta["drugs_found"]
        assert "Ibuprofen" in meta["drugs_found"]
        assert len(meta["interactions"]) == 1

    # 10. Exception inside graph lookup → graceful fallback
    def test_exception_in_search_interactions_graceful_fallback(self):
        bridge = _mock_bridge(raise_on_search=True)
        original = "original context text"

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Vancomycin", "Furosemide"]):
                # Must not raise — must return original context gracefully
                return await enrich_with_graph_context(
                    question="Vancomycin and Furosemide?",
                    existing_context=original,
                )

        enriched, meta = asyncio.run(_run())
        assert enriched == original
        assert meta["interactions"] == []
        assert meta["graph_available"] is True
        assert meta["has_risk_x"] is False

    # 11. Multiple drug pairs, only one pair has an interaction
    def test_multiple_pairs_only_relevant_interactions_included(self):
        interaction_only = _make_interaction("Warfarin", "Aspirin", "D")
        call_count = {"n": 0}

        def _side_effect(drug_a: str, drug_b: str, page: int, limit: int) -> List[Dict[str, Any]]:
            call_count["n"] += 1
            if {drug_a.lower(), drug_b.lower()} == {"warfarin", "aspirin"}:
                return [interaction_only]
            return []

        bridge = MagicMock()
        bridge.is_ready.return_value = True
        bridge.search_interactions.side_effect = _side_effect

        async def _run():
            with patch(_BRIDGE_PATH, bridge), \
                 patch(_DETECT_PATH, return_value=["Warfarin", "Aspirin", "Heparin"]):
                return await enrich_with_graph_context(
                    question="Warfarin, Aspirin, Heparin interactions?",
                )

        enriched, meta = asyncio.run(_run())
        # combinations(3, 2) = 3 pairs → 3 search calls
        assert call_count["n"] == 3
        assert len(meta["interactions"]) == 1
        assert meta["has_risk_d"] is True
        assert meta["has_risk_x"] is False
