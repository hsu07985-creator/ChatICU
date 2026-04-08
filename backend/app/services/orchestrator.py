"""Core Query Orchestrator (B05) for the multi-source RAG system.

Coordinates intent classification, source selection, parallel/sequential
dispatch to Sources A/B/C, and evidence collection. Evidence fusion is
handled separately by B06 (evidence_fuser.py).

Dispatch strategies:
  - "parallel": Fire all configured sources concurrently via asyncio.gather.
    Source C (Drug Graph) always fires first when in the source list (<5ms).
  - "sequential": Query sources in priority order. If cascade_condition is
    "primary_insufficient", only query the next source when the primary
    returns fewer than 2 chunks with score > 0.5.

Per-source timeout: 8 seconds (configurable).
"""

from __future__ import annotations

import asyncio
import logging
import time
from itertools import combinations
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

from app.services.drug_rag_client import DrugRagClient, EvidenceItem

logger = logging.getLogger(__name__)

_SOURCE_TIMEOUT = 8.0  # seconds per source

# ── Intent-to-Source-B category hint mapping ─────────────────────────────

_INTENT_TO_CATEGORY: Dict[str, str] = {
    "dose_calculation": "d",
    "pair_interaction": "g",
    "multi_drug_rx": "g",
    "iv_compatibility": "g",
    "drug_monograph": "m",
    "single_drug_interactions": "g",
    "nhi_reimbursement": "n",
    "clinical_guideline": "g",
    "clinical_decision": "g",
    "patient_education": "m",
    "clinical_summary": "m",
    "drug_comparison": "m",
    "general_pharmacology": "m",
}


# ── Pydantic Result Model ────────────────────────────────────────────────

class OrchestratorResult(BaseModel):
    """Collected evidence from all queried sources."""
    intent: str = ""
    intent_confidence: float = 0.0
    detected_drugs: List[str] = Field(default_factory=list)
    evidence_items: List[EvidenceItem] = Field(default_factory=list)
    sources_queried: List[str] = Field(default_factory=list)
    sources_succeeded: List[str] = Field(default_factory=list)
    sources_failed: List[str] = Field(default_factory=list)
    total_duration_ms: float = 0.0
    per_source_duration_ms: Dict[str, float] = Field(default_factory=dict)
    confidence_threshold: float = 0.55
    raw_graph_result: Optional[Dict[str, Any]] = None


# ── QueryOrchestrator ────────────────────────────────────────────────────

class QueryOrchestrator:
    """Orchestrates clinical queries across multiple knowledge sources.

    Accepts all dependencies via constructor for testability.
    """

    def __init__(
        self,
        source_registry: Any,
        intent_classifier_fn: Callable,
        drug_rag_client: Any,
        drug_graph_bridge: Any,
    ) -> None:
        self._registry = source_registry
        self._classify_intent = intent_classifier_fn
        self._drug_rag = drug_rag_client
        self._graph_bridge = drug_graph_bridge

    # ── Main entry point ─────────────────────────────────────────────────

    async def orchestrate(
        self,
        question: str,
        patient_context: Optional[Dict[str, Any]] = None,
        user_role: Optional[str] = None,
    ) -> OrchestratorResult:
        """Main entry point for all clinical queries.

        1. Classify intent
        2. Get source config for this intent
        3. Dispatch to sources (parallel or sequential based on config)
        4. Collect evidence items
        5. Return OrchestratorResult (evidence fusion is B06, not here)
        """
        t0 = time.monotonic()

        # 1. Classify intent
        intent_result = self._classify_intent(question)
        intent = intent_result.intent
        confidence = intent_result.confidence
        detected_drugs = list(intent_result.detected_drugs)

        # 2. Get source config
        intent_config = self._registry.get_intent_config(intent)
        strategy = "parallel"
        confidence_threshold = 0.55
        cascade_condition: Optional[str] = None
        if intent_config is not None:
            strategy = intent_config.strategy
            confidence_threshold = intent_config.confidence_threshold
            cascade_condition = intent_config.cascade_condition

        source_entries = self._registry.get_available_sources(intent)
        source_names = [e.source for e in source_entries]

        # 3. Dispatch to sources
        evidence_items: List[EvidenceItem] = []
        sources_queried: List[str] = []
        sources_succeeded: List[str] = []
        sources_failed: List[str] = []
        per_source_ms: Dict[str, float] = {}
        raw_graph_result: Optional[Dict[str, Any]] = None

        if strategy == "sequential":
            seq_result = await self._dispatch_sequential(
                source_names=source_names,
                question=question,
                intent=intent,
                detected_drugs=detected_drugs,
                cascade_condition=cascade_condition,
            )
            evidence_items = seq_result["evidence_items"]
            sources_queried = seq_result["sources_queried"]
            sources_succeeded = seq_result["sources_succeeded"]
            sources_failed = seq_result["sources_failed"]
            per_source_ms = seq_result["per_source_duration_ms"]
            raw_graph_result = seq_result.get("raw_graph_result")
        else:
            par_result = await self._dispatch_parallel(
                source_names=source_names,
                question=question,
                intent=intent,
                detected_drugs=detected_drugs,
            )
            evidence_items = par_result["evidence_items"]
            sources_queried = par_result["sources_queried"]
            sources_succeeded = par_result["sources_succeeded"]
            sources_failed = par_result["sources_failed"]
            per_source_ms = par_result["per_source_duration_ms"]
            raw_graph_result = par_result.get("raw_graph_result")

        total_ms = (time.monotonic() - t0) * 1000

        return OrchestratorResult(
            intent=intent,
            intent_confidence=confidence,
            detected_drugs=detected_drugs,
            evidence_items=evidence_items,
            sources_queried=sources_queried,
            sources_succeeded=sources_succeeded,
            sources_failed=sources_failed,
            total_duration_ms=round(total_ms, 1),
            per_source_duration_ms=per_source_ms,
            confidence_threshold=confidence_threshold,
            raw_graph_result=raw_graph_result,
        )

    # ── Parallel dispatch ────────────────────────────────────────────────

    async def _dispatch_parallel(
        self,
        source_names: List[str],
        question: str,
        intent: str,
        detected_drugs: List[str],
    ) -> Dict[str, Any]:
        """Fire all sources concurrently. Source C fires first if present."""
        evidence_items: List[EvidenceItem] = []
        sources_queried: List[str] = []
        sources_succeeded: List[str] = []
        sources_failed: List[str] = []
        per_source_ms: Dict[str, float] = {}
        raw_graph_result: Optional[Dict[str, Any]] = None

        # Separate Source C from the rest — it fires first (<5ms in-process)
        graph_sources = [s for s in source_names if "source_c" in s]
        other_sources = [s for s in source_names if "source_c" not in s]

        # Fire Source C first
        for src in graph_sources:
            sources_queried.append(src)
            t_start = time.monotonic()
            try:
                items, graph_raw = await asyncio.wait_for(
                    self._query_source_c(intent, detected_drugs),
                    timeout=_SOURCE_TIMEOUT,
                )
                elapsed = (time.monotonic() - t_start) * 1000
                per_source_ms[src] = round(elapsed, 1)
                evidence_items.extend(items)
                if graph_raw is not None:
                    raw_graph_result = graph_raw
                sources_succeeded.append(src)
            except Exception as exc:
                elapsed = (time.monotonic() - t_start) * 1000
                per_source_ms[src] = round(elapsed, 1)
                sources_failed.append(src)
                logger.warning(
                    "[ORCH] Source C dispatch failed: %s", str(exc)[:200]
                )

        # Fire remaining sources in parallel
        if other_sources:
            tasks = []
            for src in other_sources:
                sources_queried.append(src)
                tasks.append(
                    self._query_source_with_timeout(
                        src, question, intent, detected_drugs
                    )
                )

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for src, result in zip(other_sources, results):
                if isinstance(result, Exception):
                    sources_failed.append(src)
                    per_source_ms[src] = 0.0
                    logger.warning(
                        "[ORCH] Source %s dispatch failed: %s",
                        src,
                        str(result)[:200],
                    )
                else:
                    items_list, elapsed_ms = result
                    per_source_ms[src] = round(elapsed_ms, 1)
                    if items_list is not None:
                        evidence_items.extend(items_list)
                        sources_succeeded.append(src)
                    else:
                        sources_failed.append(src)

        return {
            "evidence_items": evidence_items,
            "sources_queried": sources_queried,
            "sources_succeeded": sources_succeeded,
            "sources_failed": sources_failed,
            "per_source_duration_ms": per_source_ms,
            "raw_graph_result": raw_graph_result,
        }

    # ── Sequential dispatch ──────────────────────────────────────────────

    async def _dispatch_sequential(
        self,
        source_names: List[str],
        question: str,
        intent: str,
        detected_drugs: List[str],
        cascade_condition: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Query sources in priority order. Cascade if primary insufficient."""
        evidence_items: List[EvidenceItem] = []
        sources_queried: List[str] = []
        sources_succeeded: List[str] = []
        sources_failed: List[str] = []
        per_source_ms: Dict[str, float] = {}
        raw_graph_result: Optional[Dict[str, Any]] = None

        for idx, src in enumerate(source_names):
            sources_queried.append(src)
            t_start = time.monotonic()

            try:
                if "source_c" in src:
                    items, graph_raw = await asyncio.wait_for(
                        self._query_source_c(intent, detected_drugs),
                        timeout=_SOURCE_TIMEOUT,
                    )
                    if graph_raw is not None:
                        raw_graph_result = graph_raw
                else:
                    items_result = await self._query_source_with_timeout(
                        src, question, intent, detected_drugs
                    )
                    items, _ = items_result
                    if items is None:
                        items = []

                elapsed = (time.monotonic() - t_start) * 1000
                per_source_ms[src] = round(elapsed, 1)
                evidence_items.extend(items)
                sources_succeeded.append(src)

                # Check cascade condition — if primary returned sufficient
                # results, skip remaining sources
                if (
                    cascade_condition == "primary_insufficient"
                    and idx == 0
                    and len(source_names) > 1
                ):
                    high_quality = [
                        e for e in items if e.relevance_score > 0.5
                    ]
                    if len(high_quality) >= 2:
                        logger.debug(
                            "[ORCH] Primary source returned %d quality items, "
                            "skipping cascade",
                            len(high_quality),
                        )
                        break

            except Exception as exc:
                elapsed = (time.monotonic() - t_start) * 1000
                per_source_ms[src] = round(elapsed, 1)
                sources_failed.append(src)
                logger.warning(
                    "[ORCH] Sequential source %s failed: %s",
                    src,
                    str(exc)[:200],
                )

        return {
            "evidence_items": evidence_items,
            "sources_queried": sources_queried,
            "sources_succeeded": sources_succeeded,
            "sources_failed": sources_failed,
            "per_source_duration_ms": per_source_ms,
            "raw_graph_result": raw_graph_result,
        }

    # ── Per-source query helpers ─────────────────────────────────────────

    async def _query_source_with_timeout(
        self,
        source_name: str,
        question: str,
        intent: str,
        detected_drugs: List[str],
    ) -> tuple:
        """Query a single non-graph source with timeout.

        Returns (List[EvidenceItem] | None, elapsed_ms).
        """
        t_start = time.monotonic()
        try:
            items = await asyncio.wait_for(
                self._query_source(source_name, question, intent, detected_drugs),
                timeout=_SOURCE_TIMEOUT,
            )
            elapsed_ms = (time.monotonic() - t_start) * 1000
            return (items, elapsed_ms)
        except asyncio.TimeoutError:
            elapsed_ms = (time.monotonic() - t_start) * 1000
            logger.warning(
                "[ORCH] Source %s timed out after %.0fms", source_name, elapsed_ms
            )
            raise
        except Exception:
            elapsed_ms = (time.monotonic() - t_start) * 1000
            raise

    async def _query_source(
        self,
        source_name: str,
        question: str,
        intent: str,
        detected_drugs: List[str],
    ) -> Optional[List[EvidenceItem]]:
        """Route query to the appropriate source client."""
        if "source_b" in source_name:
            return await self._query_source_b(question, intent)
        elif "source_a" in source_name:
            return await self._query_source_a(question, intent)
        else:
            logger.warning("[ORCH] Unknown source: %s", source_name)
            return None

    async def _query_source_a(
        self,
        question: str,
        intent: str,
    ) -> List[EvidenceItem]:
        """Query Source A (Clinical RAG).

        TODO: Integrate with a dedicated Source A HTTP client when available.
        Currently returns empty results as a placeholder. The existing
        evidence_client.py communicates with func/ which partially covers
        Source A, but a direct async client is planned for B07.
        """
        # Placeholder: Source A integration is planned for a future ticket.
        # The evidence_client (func/) partially covers Source A but is sync.
        return []

    async def _query_source_b(
        self,
        question: str,
        intent: str,
    ) -> List[EvidenceItem]:
        """Query Source B (Drug RAG Qdrant) via DrugRagClient."""
        category_hint = _INTENT_TO_CATEGORY.get(intent)
        response = await self._drug_rag.query(
            question=question,
            category_hint=category_hint,
        )
        if response.success:
            return self._drug_rag.to_evidence_items(response)
        else:
            logger.warning(
                "[ORCH] Source B query failed: %s",
                response.error or "unknown",
            )
            return []

    async def _query_source_c(
        self,
        intent: str,
        detected_drugs: List[str],
    ) -> tuple:
        """Query Source C (Drug Graph Bridge).

        Returns (List[EvidenceItem], raw_graph_dict_or_None).

        Dispatch logic:
          - pair_interaction with 2 drugs: search_interactions(a, b)
          - multi_drug_rx with 3+ drugs: search_interactions for all pairs
          - iv_compatibility with 2 drugs: check_compatibility(a, b)
          - single_drug_interactions with 1 drug: search_interactions(a, None)
          - others: skip (return empty)
        """
        items: List[EvidenceItem] = []
        raw_results: List[Dict[str, Any]] = []

        if intent == "pair_interaction" and len(detected_drugs) >= 2:
            rows = await asyncio.to_thread(
                self._graph_bridge.search_interactions,
                drug_a=detected_drugs[0],
                drug_b=detected_drugs[1],
                page=1,
                limit=10,
            )
            raw_results.extend(rows)
            items.extend(self._graph_rows_to_evidence(rows))

        elif intent == "multi_drug_rx" and len(detected_drugs) >= 2:
            for drug_a, drug_b in combinations(detected_drugs, 2):
                rows = await asyncio.to_thread(
                    self._graph_bridge.search_interactions,
                    drug_a=drug_a,
                    drug_b=drug_b,
                    page=1,
                    limit=5,
                )
                raw_results.extend(rows)
                items.extend(self._graph_rows_to_evidence(rows))

        elif intent == "iv_compatibility" and len(detected_drugs) >= 2:
            result = await asyncio.to_thread(
                self._graph_bridge.check_compatibility,
                drug_a=detected_drugs[0],
                drug_b=detected_drugs[1],
                solution=None,
            )
            if result is not None:
                raw_results.append(result)
                items.append(self._compat_to_evidence(result))

        elif intent == "single_drug_interactions" and len(detected_drugs) >= 1:
            rows = await asyncio.to_thread(
                self._graph_bridge.search_interactions,
                drug_a=detected_drugs[0],
                drug_b=None,
                page=1,
                limit=10,
            )
            raw_results.extend(rows)
            items.extend(self._graph_rows_to_evidence(rows))

        raw_graph = {"results": raw_results} if raw_results else None
        return items, raw_graph

    # ── Conversion helpers ───────────────────────────────────────────────

    @staticmethod
    def _graph_rows_to_evidence(
        rows: List[Dict[str, Any]],
    ) -> List[EvidenceItem]:
        """Convert Drug Graph interaction rows to EvidenceItem format."""
        items: List[EvidenceItem] = []
        for row in rows:
            drug_names: List[str] = []
            if row.get("drug1"):
                drug_names.append(str(row["drug1"]))
            if row.get("drug2"):
                drug_names.append(str(row["drug2"]))

            severity = str(row.get("severity", "unknown"))
            mechanism = str(row.get("mechanism", ""))
            management = str(row.get("management", ""))
            text = f"[{severity.upper()}] {mechanism}"
            if management:
                text += f" | Management: {management}"

            items.append(EvidenceItem(
                chunk_id=str(row.get("id", "")),
                text=text,
                source_system="drug_graph",
                relevance_score=1.0,  # curated data = highest relevance
                drug_names=drug_names,
                evidence_grade="curated",
            ))
        return items

    @staticmethod
    def _compat_to_evidence(result: Dict[str, Any]) -> EvidenceItem:
        """Convert compatibility check result to EvidenceItem."""
        drug_names: List[str] = []
        if result.get("drug1"):
            drug_names.append(str(result["drug1"]))
        if result.get("drug2"):
            drug_names.append(str(result["drug2"]))

        compatible = result.get("compatible", False)
        status_text = "Compatible" if compatible else "NOT Compatible"
        notes = str(result.get("notes", ""))
        solution = str(result.get("solution", ""))
        text = f"[IV Compatibility] {status_text}"
        if solution:
            text += f" in {solution}"
        if notes:
            text += f" — {notes}"

        return EvidenceItem(
            chunk_id=str(result.get("id", "")),
            text=text,
            source_system="drug_graph",
            relevance_score=1.0,
            drug_names=drug_names,
            evidence_grade="curated",
        )


# ── Module-level convenience ─────────────────────────────────────────────

_orchestrator: Optional[QueryOrchestrator] = None


def get_orchestrator() -> QueryOrchestrator:
    """Get or create the singleton orchestrator.

    Lazy-initializes with the standard dependencies from the services layer.
    """
    global _orchestrator
    if _orchestrator is None:
        from app.services.source_registry import source_registry
        from app.services.intent_classifier import classify_intent
        from app.services.drug_rag_client import drug_rag_client
        from app.services.drug_graph_bridge import drug_graph_bridge

        _orchestrator = QueryOrchestrator(
            source_registry=source_registry,
            intent_classifier_fn=classify_intent,
            drug_rag_client=drug_rag_client,
            drug_graph_bridge=drug_graph_bridge,
        )
    return _orchestrator


async def orchestrate_query(
    question: str,
    patient_context: Optional[Dict[str, Any]] = None,
    user_role: Optional[str] = None,
) -> OrchestratorResult:
    """Convenience function for orchestrating a clinical query."""
    return await get_orchestrator().orchestrate(
        question=question,
        patient_context=patient_context,
        user_role=user_role,
    )
