"""Tests for Core Query Orchestrator (B05).

All external dependencies (drug_graph_bridge, drug_rag_client,
source_registry, intent_classifier) are mocked.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.drug_rag_client import DrugRagResponse, DrugRagChunk, EvidenceItem
from app.services.intent_classifier import IntentResult
from app.services.orchestrator import (
    OrchestratorResult,
    QueryOrchestrator,
    _INTENT_TO_CATEGORY,
)
from app.services.source_registry import (
    IntentSourceConfig,
    SourcePriorityEntry,
)


# ── Test Fixtures ────────────────────────────────────────────────────────

def _make_intent_result(
    intent: str = "pair_interaction",
    confidence: float = 0.90,
    detected_drugs: Optional[List[str]] = None,
) -> IntentResult:
    return IntentResult(
        intent=intent,
        confidence=confidence,
        detected_drugs=detected_drugs or [],
        stage="rule_based",
    )


def _make_drug_rag_response(
    success: bool = True,
    chunks: Optional[List[Dict[str, Any]]] = None,
) -> DrugRagResponse:
    chunk_list = []
    if chunks:
        for c in chunks:
            chunk_list.append(DrugRagChunk(**c))
    return DrugRagResponse(
        success=success,
        answer="Test answer",
        chunks=chunk_list,
        category="test",
    )


def _make_evidence_items(count: int = 2) -> List[EvidenceItem]:
    return [
        EvidenceItem(
            chunk_id=f"chunk_{i}",
            text=f"Evidence text {i}",
            source_system="drug_rag_qdrant",
            relevance_score=0.8 - (i * 0.1),
            drug_names=["TestDrug"],
            evidence_grade="monograph",
        )
        for i in range(count)
    ]


def _make_graph_interaction_rows(count: int = 1) -> List[Dict[str, Any]]:
    return [
        {
            "id": f"graphint_{i}",
            "drug1": "DrugA",
            "drug2": "DrugB",
            "severity": "major",
            "mechanism": "CYP3A4 inhibition",
            "management": "Monitor closely",
            "source": "drug_graph",
        }
        for i in range(count)
    ]


def _make_compat_result() -> Dict[str, Any]:
    return {
        "id": "graphcomp_test",
        "drug1": "DrugA",
        "drug2": "DrugB",
        "solution": "NS",
        "compatible": True,
        "notes": "Compatible in NS within 24h",
        "source": "drug_graph",
    }


def _build_orchestrator(
    intent_fn=None,
    registry=None,
    drug_rag=None,
    graph_bridge=None,
) -> QueryOrchestrator:
    """Build orchestrator with mock dependencies."""
    if registry is None:
        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="parallel",
            sources=[
                SourcePriorityEntry(source="source_c_graph", priority=1),
                SourcePriorityEntry(source="source_b_qdrant", priority=2),
            ],
            confidence_threshold=0.60,
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_c_graph", priority=1),
            SourcePriorityEntry(source="source_b_qdrant", priority=2),
        ]

    if intent_fn is None:
        intent_fn = MagicMock(return_value=_make_intent_result())

    if drug_rag is None:
        drug_rag = MagicMock()
        drug_rag.query = AsyncMock(return_value=_make_drug_rag_response())
        drug_rag.to_evidence_items = MagicMock(return_value=_make_evidence_items(2))

    if graph_bridge is None:
        graph_bridge = MagicMock()
        graph_bridge.search_interactions = MagicMock(
            return_value=_make_graph_interaction_rows(1)
        )
        graph_bridge.check_compatibility = MagicMock(
            return_value=_make_compat_result()
        )

    return QueryOrchestrator(
        source_registry=registry,
        intent_classifier_fn=intent_fn,
        drug_rag_client=drug_rag,
        drug_graph_bridge=graph_bridge,
    )


# ── Test Classes ─────────────────────────────────────────────────────────

class TestParallelDispatch:
    """Test parallel dispatch strategy."""

    @pytest.mark.asyncio
    async def test_parallel_dispatch_all_sources_available(self):
        """Test 1: Parallel dispatch with all sources available."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="pair_interaction",
            confidence=0.90,
            detected_drugs=["Warfarin", "Aspirin"],
        ))

        orch = _build_orchestrator(intent_fn=intent_fn)
        result = await orch.orchestrate("Warfarin and Aspirin interaction?")

        assert isinstance(result, OrchestratorResult)
        assert result.intent == "pair_interaction"
        assert result.intent_confidence == 0.90
        assert "Warfarin" in result.detected_drugs
        assert "Aspirin" in result.detected_drugs
        assert len(result.evidence_items) > 0
        assert "source_c_graph" in result.sources_queried
        assert "source_b_qdrant" in result.sources_queried
        assert "source_c_graph" in result.sources_succeeded
        assert "source_b_qdrant" in result.sources_succeeded
        assert len(result.sources_failed) == 0
        assert result.total_duration_ms > 0

    @pytest.mark.asyncio
    async def test_parallel_dispatch_source_c_only(self):
        """Test 2: Parallel dispatch with Source C only (B unavailable)."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="pair_interaction",
            confidence=0.90,
            detected_drugs=["Warfarin", "Aspirin"],
        ))

        drug_rag = MagicMock()
        drug_rag.query = AsyncMock(
            return_value=DrugRagResponse(success=False, error="connection_failed")
        )
        drug_rag.to_evidence_items = MagicMock(return_value=[])

        orch = _build_orchestrator(intent_fn=intent_fn, drug_rag=drug_rag)
        result = await orch.orchestrate("Warfarin and Aspirin interaction?")

        assert result.intent == "pair_interaction"
        assert "source_c_graph" in result.sources_succeeded
        # Source B returns empty (not failed, just no items) because
        # the client returned success=False but to_evidence_items returned []
        assert len(result.evidence_items) > 0
        # Source C evidence should be present
        graph_items = [e for e in result.evidence_items if e.source_system == "drug_graph"]
        assert len(graph_items) > 0


class TestSequentialDispatch:
    """Test sequential dispatch strategy."""

    @pytest.mark.asyncio
    async def test_sequential_dispatch_cascade(self):
        """Test 3: Sequential dispatch with cascade condition."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="clinical_guideline",
            confidence=0.82,
            detected_drugs=[],
        ))

        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="sequential",
            sources=[
                SourcePriorityEntry(source="source_a_guideline", priority=1, required=True),
                SourcePriorityEntry(source="source_b_qdrant", priority=2),
            ],
            confidence_threshold=0.55,
            cascade_condition="primary_insufficient",
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_a_guideline", priority=1, required=True),
            SourcePriorityEntry(source="source_b_qdrant", priority=2),
        ]

        # Source A returns empty (insufficient)
        drug_rag = MagicMock()
        drug_rag.query = AsyncMock(return_value=_make_drug_rag_response(
            success=True,
            chunks=[
                {"chunk_id": "b_1", "text": "Guideline content", "score": 0.75, "drug_name": None},
                {"chunk_id": "b_2", "text": "More guideline", "score": 0.65, "drug_name": None},
            ],
        ))
        drug_rag.to_evidence_items = MagicMock(return_value=_make_evidence_items(2))

        orch = _build_orchestrator(
            intent_fn=intent_fn,
            registry=registry,
            drug_rag=drug_rag,
        )
        result = await orch.orchestrate("What does PADIS 2025 say about sedation targets?")

        assert result.intent == "clinical_guideline"
        # Source A is queried first (returns empty placeholder)
        assert "source_a_guideline" in result.sources_queried
        # Since primary returned 0 items (empty placeholder), cascade should fire
        assert "source_b_qdrant" in result.sources_queried

    @pytest.mark.asyncio
    async def test_sequential_dispatch_primary_sufficient_skips_cascade(self):
        """Test 3b: Sequential dispatch - primary sufficient, skip cascade."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="clinical_guideline",
            confidence=0.82,
            detected_drugs=[],
        ))

        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="sequential",
            sources=[
                SourcePriorityEntry(source="source_c_graph", priority=1),
                SourcePriorityEntry(source="source_b_qdrant", priority=2),
            ],
            confidence_threshold=0.55,
            cascade_condition="primary_insufficient",
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_c_graph", priority=1),
            SourcePriorityEntry(source="source_b_qdrant", priority=2),
        ]

        # Source C returns 3 high-quality items
        graph_bridge = MagicMock()
        graph_bridge.search_interactions = MagicMock(
            return_value=_make_graph_interaction_rows(3)
        )

        drug_rag = MagicMock()
        drug_rag.query = AsyncMock()

        orch = _build_orchestrator(
            intent_fn=intent_fn,
            registry=registry,
            drug_rag=drug_rag,
            graph_bridge=graph_bridge,
        )

        # Override intent to one that makes Source C return items
        intent_fn.return_value = _make_intent_result(
            intent="pair_interaction",
            confidence=0.85,
            detected_drugs=["DrugA", "DrugB"],
        )

        result = await orch.orchestrate("DrugA and DrugB interaction?")

        # Source C queried and returned sufficient items
        assert "source_c_graph" in result.sources_queried
        assert "source_c_graph" in result.sources_succeeded
        # Source B should NOT be queried since primary returned >= 2 quality items
        assert "source_b_qdrant" not in result.sources_queried


class TestIntentSpecificRouting:
    """Test intent-specific routing to correct sources."""

    @pytest.mark.asyncio
    async def test_iv_compatibility_source_c_only(self):
        """Test 4: iv_compatibility goes only to Source C."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="iv_compatibility",
            confidence=0.92,
            detected_drugs=["Dexmedetomidine", "Propofol"],
        ))

        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="sequential",
            sources=[
                SourcePriorityEntry(source="source_c_graph", priority=1, required=True),
            ],
            confidence_threshold=0.90,
            refuse_if_no_results=True,
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_c_graph", priority=1, required=True),
        ]

        orch = _build_orchestrator(intent_fn=intent_fn, registry=registry)
        result = await orch.orchestrate("Is Dexmedetomidine compatible with Propofol?")

        assert result.intent == "iv_compatibility"
        assert result.confidence_threshold == 0.90
        assert "source_c_graph" in result.sources_queried
        assert "source_b_qdrant" not in result.sources_queried
        # Check compatibility was called
        orch._graph_bridge.check_compatibility.assert_called_once()
        # Evidence items should include compatibility data
        compat_items = [e for e in result.evidence_items if "IV Compatibility" in e.text]
        assert len(compat_items) == 1

    @pytest.mark.asyncio
    async def test_dose_calculation_queries_a_and_b(self):
        """Test 5: dose_calculation queries both Source A + B."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="dose_calculation",
            confidence=0.88,
            detected_drugs=["Vancomycin"],
        ))

        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="parallel",
            sources=[
                SourcePriorityEntry(source="source_a_pad", priority=1),
                SourcePriorityEntry(source="source_b_qdrant", priority=2, required=True),
            ],
            confidence_threshold=0.75,
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_a_pad", priority=1),
            SourcePriorityEntry(source="source_b_qdrant", priority=2, required=True),
        ]

        orch = _build_orchestrator(intent_fn=intent_fn, registry=registry)
        result = await orch.orchestrate("Vancomycin dose for eGFR 22?")

        assert result.intent == "dose_calculation"
        assert result.confidence_threshold == 0.75
        assert "source_a_pad" in result.sources_queried
        assert "source_b_qdrant" in result.sources_queried
        # Source B evidence items should be present
        assert len(result.evidence_items) > 0

    @pytest.mark.asyncio
    async def test_pair_interaction_with_two_drugs(self):
        """Test 6: pair_interaction with 2 detected drugs -> Source C + B."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="pair_interaction",
            confidence=0.90,
            detected_drugs=["Warfarin", "Aspirin"],
        ))

        orch = _build_orchestrator(intent_fn=intent_fn)
        result = await orch.orchestrate("Warfarin Aspirin interaction?")

        assert result.intent == "pair_interaction"
        assert "source_c_graph" in result.sources_queried
        assert "source_b_qdrant" in result.sources_queried
        # Source C should have called search_interactions with both drugs
        orch._graph_bridge.search_interactions.assert_called_once_with(
            drug_a="Warfarin", drug_b="Aspirin", page=1, limit=10
        )
        # Evidence should include items from both sources
        graph_items = [e for e in result.evidence_items if e.source_system == "drug_graph"]
        assert len(graph_items) >= 1

    @pytest.mark.asyncio
    async def test_multi_drug_rx_all_pairs(self):
        """Test 7: multi_drug_rx with 3+ drugs -> all pairs to Source C."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="multi_drug_rx",
            confidence=0.85,
            detected_drugs=["DrugA", "DrugB", "DrugC"],
        ))

        graph_bridge = MagicMock()
        graph_bridge.search_interactions = MagicMock(
            return_value=_make_graph_interaction_rows(1)
        )

        orch = _build_orchestrator(
            intent_fn=intent_fn,
            graph_bridge=graph_bridge,
        )
        result = await orch.orchestrate("Check DrugA DrugB DrugC for interactions")

        assert result.intent == "multi_drug_rx"
        # With 3 drugs, there should be 3 pair combinations: (A,B), (A,C), (B,C)
        assert graph_bridge.search_interactions.call_count == 3
        # All 3 pairs should produce evidence items
        graph_items = [e for e in result.evidence_items if e.source_system == "drug_graph"]
        assert len(graph_items) == 3


class TestErrorHandling:
    """Test error and timeout handling."""

    @pytest.mark.asyncio
    async def test_source_timeout_handling(self):
        """Test 8: Source timeout handling (mock slow source)."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="pair_interaction",
            confidence=0.90,
            detected_drugs=["Warfarin", "Aspirin"],
        ))

        # Source B times out
        drug_rag = MagicMock()

        async def _slow_query(*args, **kwargs):
            await asyncio.sleep(20)  # will be cancelled by timeout
            return _make_drug_rag_response()

        drug_rag.query = _slow_query
        drug_rag.to_evidence_items = MagicMock(return_value=[])

        orch = _build_orchestrator(intent_fn=intent_fn, drug_rag=drug_rag)

        # Patch _SOURCE_TIMEOUT to 0.1s for fast test
        with patch("app.services.orchestrator._SOURCE_TIMEOUT", 0.1):
            result = await orch.orchestrate("Warfarin Aspirin interaction?")

        # Source B should be in failed list due to timeout
        assert "source_b_qdrant" in result.sources_failed
        # Source C should still succeed
        assert "source_c_graph" in result.sources_succeeded
        # Overall result should still have Source C evidence
        graph_items = [e for e in result.evidence_items if e.source_system == "drug_graph"]
        assert len(graph_items) >= 1

    @pytest.mark.asyncio
    async def test_all_sources_unavailable(self):
        """Test 9: All sources unavailable -> empty result."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="pair_interaction",
            confidence=0.90,
            detected_drugs=["Warfarin", "Aspirin"],
        ))

        # Source C fails
        graph_bridge = MagicMock()
        graph_bridge.search_interactions = MagicMock(side_effect=RuntimeError("Graph not loaded"))

        # Source B fails
        drug_rag = MagicMock()
        drug_rag.query = AsyncMock(side_effect=RuntimeError("Connection refused"))
        drug_rag.to_evidence_items = MagicMock(return_value=[])

        orch = _build_orchestrator(
            intent_fn=intent_fn,
            drug_rag=drug_rag,
            graph_bridge=graph_bridge,
        )
        result = await orch.orchestrate("Warfarin Aspirin interaction?")

        assert result.intent == "pair_interaction"
        assert len(result.evidence_items) == 0
        assert "source_c_graph" in result.sources_failed
        assert "source_b_qdrant" in result.sources_failed
        assert len(result.sources_succeeded) == 0


class TestModels:
    """Test Pydantic models and field validation."""

    def test_orchestrator_result_has_correct_fields(self):
        """Test 10: OrchestratorResult model has correct fields."""
        result = OrchestratorResult(
            intent="pair_interaction",
            intent_confidence=0.90,
            detected_drugs=["Warfarin", "Aspirin"],
            evidence_items=[
                EvidenceItem(
                    chunk_id="test",
                    text="Test",
                    source_system="drug_graph",
                    relevance_score=0.95,
                    drug_names=["Warfarin"],
                    evidence_grade="curated",
                )
            ],
            sources_queried=["source_c_graph", "source_b_qdrant"],
            sources_succeeded=["source_c_graph"],
            sources_failed=["source_b_qdrant"],
            total_duration_ms=150.5,
            per_source_duration_ms={"source_c_graph": 3.2, "source_b_qdrant": 0.0},
            confidence_threshold=0.60,
            raw_graph_result={"results": []},
        )

        assert result.intent == "pair_interaction"
        assert result.intent_confidence == 0.90
        assert result.detected_drugs == ["Warfarin", "Aspirin"]
        assert len(result.evidence_items) == 1
        assert result.sources_queried == ["source_c_graph", "source_b_qdrant"]
        assert result.sources_succeeded == ["source_c_graph"]
        assert result.sources_failed == ["source_b_qdrant"]
        assert result.total_duration_ms == 150.5
        assert result.per_source_duration_ms["source_c_graph"] == 3.2
        assert result.confidence_threshold == 0.60
        assert result.raw_graph_result is not None

    def test_orchestrator_result_defaults(self):
        """Test 10b: OrchestratorResult defaults."""
        result = OrchestratorResult()
        assert result.intent == ""
        assert result.intent_confidence == 0.0
        assert result.detected_drugs == []
        assert result.evidence_items == []
        assert result.sources_queried == []
        assert result.sources_succeeded == []
        assert result.sources_failed == []
        assert result.total_duration_ms == 0.0
        assert result.per_source_duration_ms == {}
        assert result.confidence_threshold == 0.55
        assert result.raw_graph_result is None


class TestIntentFlow:
    """Test intent classification flows through correctly."""

    @pytest.mark.asyncio
    async def test_intent_classification_flows_through(self):
        """Test 11: Intent classification flows through correctly."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="drug_monograph",
            confidence=0.82,
            detected_drugs=["Vancomycin"],
        ))

        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="sequential",
            sources=[
                SourcePriorityEntry(source="source_b_qdrant", priority=1, required=True),
            ],
            confidence_threshold=0.55,
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_b_qdrant", priority=1, required=True),
        ]

        orch = _build_orchestrator(intent_fn=intent_fn, registry=registry)
        result = await orch.orchestrate("What are Vancomycin side effects?")

        # Intent classifier was called with the question
        intent_fn.assert_called_once_with("What are Vancomycin side effects?")
        # Result carries the classified intent
        assert result.intent == "drug_monograph"
        assert result.intent_confidence == 0.82
        assert "Vancomycin" in result.detected_drugs
        # Registry was called with the correct intent
        registry.get_intent_config.assert_called_once_with("drug_monograph")
        registry.get_available_sources.assert_called_once_with("drug_monograph")


class TestDurationTracking:
    """Test per-source duration tracking."""

    @pytest.mark.asyncio
    async def test_per_source_duration_populated(self):
        """Test 12: per_source_duration_ms is populated."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="pair_interaction",
            confidence=0.90,
            detected_drugs=["Warfarin", "Aspirin"],
        ))

        orch = _build_orchestrator(intent_fn=intent_fn)
        result = await orch.orchestrate("Warfarin Aspirin interaction?")

        # Both sources should have duration entries
        assert "source_c_graph" in result.per_source_duration_ms
        assert "source_b_qdrant" in result.per_source_duration_ms
        # Durations should be non-negative
        assert result.per_source_duration_ms["source_c_graph"] >= 0
        assert result.per_source_duration_ms["source_b_qdrant"] >= 0
        # Total duration should be populated
        assert result.total_duration_ms > 0

    @pytest.mark.asyncio
    async def test_total_duration_includes_all_sources(self):
        """Test 12b: total_duration_ms is set and per_source tracked."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="drug_monograph",
            confidence=0.55,
            detected_drugs=["Vancomycin"],
        ))

        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="sequential",
            sources=[
                SourcePriorityEntry(source="source_b_qdrant", priority=1),
            ],
            confidence_threshold=0.55,
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_b_qdrant", priority=1),
        ]

        # Introduce a tiny delay in Source B so duration is measurable
        async def _slow_query(*args, **kwargs):
            await asyncio.sleep(0.005)
            return _make_drug_rag_response()

        drug_rag = MagicMock()
        drug_rag.query = _slow_query
        drug_rag.to_evidence_items = MagicMock(return_value=_make_evidence_items(1))

        orch = _build_orchestrator(
            intent_fn=intent_fn, registry=registry, drug_rag=drug_rag
        )
        result = await orch.orchestrate("Vancomycin monograph?")

        assert result.total_duration_ms >= 0
        assert "source_b_qdrant" in result.per_source_duration_ms
        assert result.per_source_duration_ms["source_b_qdrant"] >= 0


class TestCategoryHintMapping:
    """Test intent-to-Source-B category hint mapping."""

    def test_intent_category_mapping_exists(self):
        """Test that all 13 intents have category hint mappings."""
        expected_intents = {
            "dose_calculation",
            "pair_interaction",
            "multi_drug_rx",
            "iv_compatibility",
            "drug_monograph",
            "single_drug_interactions",
            "nhi_reimbursement",
            "clinical_guideline",
            "clinical_decision",
            "patient_education",
            "clinical_summary",
            "drug_comparison",
            "general_pharmacology",
        }
        for intent in expected_intents:
            assert intent in _INTENT_TO_CATEGORY, f"Missing category hint for {intent}"

    @pytest.mark.asyncio
    async def test_source_b_receives_category_hint(self):
        """Test that Source B query includes the correct category hint."""
        intent_fn = MagicMock(return_value=_make_intent_result(
            intent="dose_calculation",
            confidence=0.88,
            detected_drugs=["Vancomycin"],
        ))

        registry = MagicMock()
        registry.get_intent_config.return_value = IntentSourceConfig(
            strategy="parallel",
            sources=[
                SourcePriorityEntry(source="source_b_qdrant", priority=1),
            ],
            confidence_threshold=0.75,
        )
        registry.get_available_sources.return_value = [
            SourcePriorityEntry(source="source_b_qdrant", priority=1),
        ]

        drug_rag = MagicMock()
        drug_rag.query = AsyncMock(return_value=_make_drug_rag_response())
        drug_rag.to_evidence_items = MagicMock(return_value=_make_evidence_items(1))

        orch = _build_orchestrator(
            intent_fn=intent_fn,
            registry=registry,
            drug_rag=drug_rag,
        )
        await orch.orchestrate("Vancomycin dose for eGFR 22?")

        # Verify the query was called with category_hint "d" for dose_calculation
        drug_rag.query.assert_called_once()
        call_kwargs = drug_rag.query.call_args
        assert call_kwargs.kwargs.get("category_hint") == "d"


class TestGraphConversion:
    """Test Drug Graph result conversion to EvidenceItem."""

    def test_graph_rows_to_evidence(self):
        """Test conversion of graph interaction rows."""
        rows = _make_graph_interaction_rows(2)
        items = QueryOrchestrator._graph_rows_to_evidence(rows)
        assert len(items) == 2
        for item in items:
            assert item.source_system == "drug_graph"
            assert item.evidence_grade == "curated"
            assert item.relevance_score == 1.0
            assert "DrugA" in item.drug_names
            assert "DrugB" in item.drug_names
            assert "MAJOR" in item.text

    def test_compat_to_evidence(self):
        """Test conversion of compatibility result."""
        result = _make_compat_result()
        item = QueryOrchestrator._compat_to_evidence(result)
        assert item.source_system == "drug_graph"
        assert item.evidence_grade == "curated"
        assert "Compatible" in item.text
        assert "DrugA" in item.drug_names
        assert "DrugB" in item.drug_names

    def test_compat_to_evidence_incompatible(self):
        """Test conversion of incompatible result."""
        result = _make_compat_result()
        result["compatible"] = False
        item = QueryOrchestrator._compat_to_evidence(result)
        assert "NOT Compatible" in item.text


class TestSingletonAndConvenience:
    """Test module-level singleton and convenience function."""

    def test_get_orchestrator_returns_instance(self):
        """Test get_orchestrator lazy initialization."""
        with patch("app.services.orchestrator.source_registry", create=True) as mock_reg, \
             patch("app.services.orchestrator.classify_intent", create=True) as mock_clf, \
             patch("app.services.orchestrator.drug_rag_client", create=True) as mock_rag, \
             patch("app.services.orchestrator.drug_graph_bridge", create=True) as mock_graph:

            # Reset the singleton
            import app.services.orchestrator as orch_mod
            orch_mod._orchestrator = None

            orch = orch_mod.get_orchestrator()
            assert isinstance(orch, QueryOrchestrator)

            # Second call returns same instance
            orch2 = orch_mod.get_orchestrator()
            assert orch is orch2

            # Cleanup
            orch_mod._orchestrator = None

    @pytest.mark.asyncio
    async def test_orchestrate_query_convenience(self):
        """Test orchestrate_query convenience function."""
        import app.services.orchestrator as orch_mod
        mock_orch = MagicMock()
        mock_orch.orchestrate = AsyncMock(return_value=OrchestratorResult(
            intent="test",
            intent_confidence=0.5,
        ))

        original = orch_mod._orchestrator
        orch_mod._orchestrator = mock_orch
        try:
            result = await orch_mod.orchestrate_query("test question")
            assert result.intent == "test"
            mock_orch.orchestrate.assert_called_once_with(
                question="test question",
                patient_context=None,
                user_role=None,
            )
        finally:
            orch_mod._orchestrator = original
