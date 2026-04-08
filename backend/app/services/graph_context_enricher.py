"""Graph Context Enricher — B09 implementation.

Extracts drug names from a clinical question and enriches the LLM context
with drug interaction data from DrugGraphBridge (Source C).

Source C is authoritative: its risk ratings MUST be respected by the LLM
and must not be downplayed. Risk X (contraindicated) must trigger an explicit
warning in the context injected into the LLM.
"""

from __future__ import annotations

import logging
from itertools import combinations
from typing import Any, Dict, List, Optional, Tuple

from app.services.drug_graph_bridge import drug_graph_bridge
from app.services.intent_classifier import detect_drugs_from_text

logger = logging.getLogger(__name__)


async def enrich_with_graph_context(
    question: str,
    existing_context: str = "",
    drugs_hint: Optional[List[str]] = None,
) -> Tuple[str, Dict[str, Any]]:
    """Detect drugs in *question*, look up interactions via DrugGraphBridge,
    and return an enriched context string together with metadata.

    The function is intentionally best-effort:
    - If the bridge is unavailable, the original context is returned unchanged.
    - If any individual lookup fails, it is silently skipped.
    - The caller must never receive an exception from this function.

    Args:
        question: The user's clinical question (plain text).
        existing_context: The context string already assembled for the LLM
            (e.g., RAG evidence).  Graph findings are *appended* to this.
        drugs_hint: Pre-detected drug names.  When supplied the function uses
            them directly instead of running ``detect_drugs_from_text``.

    Returns:
        A two-tuple ``(enriched_context, metadata)`` where:
        - *enriched_context* is ``existing_context`` with graph findings
          appended (or ``existing_context`` unchanged when nothing was found).
        - *metadata* is a ``dict`` with keys:
          ``graph_available``, ``drugs_found``, ``interactions``,
          ``has_risk_x``, ``has_risk_d``.
    """
    # ── 1. Check bridge availability ────────────────────────────────────────
    if not drug_graph_bridge.is_ready():
        logger.debug("[B09][GRAPH_ENRICHER] DrugGraphBridge not ready — skipping enrichment")
        return existing_context, {"graph_available": False}

    # ── 2. Detect drug names ────────────────────────────────────────────────
    try:
        if drugs_hint is not None:
            drugs: List[str] = list(drugs_hint)
        else:
            drugs = detect_drugs_from_text(question)
    except Exception as exc:
        logger.warning("[B09][GRAPH_ENRICHER] Drug detection failed: %s", exc)
        return existing_context, {"graph_available": True, "drugs_found": [], "interactions": []}

    if len(drugs) < 2:
        logger.debug(
            "[B09][GRAPH_ENRICHER] Fewer than 2 drugs detected (%d) — no interaction lookup",
            len(drugs),
        )
        return existing_context, {
            "graph_available": True,
            "drugs_found": drugs,
            "interactions": [],
            "has_risk_x": False,
            "has_risk_d": False,
        }

    # ── 3. Look up interactions for every drug pair ─────────────────────────
    interactions: List[Dict[str, Any]] = []
    seen_ids: set = set()

    for drug_a, drug_b in combinations(drugs, 2):
        try:
            rows = drug_graph_bridge.search_interactions(
                drug_a=drug_a,
                drug_b=drug_b,
                page=1,
                limit=10,
            )
            for row in rows or []:
                row_id = str(row.get("id") or "")
                if row_id and row_id in seen_ids:
                    continue
                if row_id:
                    seen_ids.add(row_id)
                interactions.append(row)
        except Exception as exc:
            logger.warning(
                "[B09][GRAPH_ENRICHER] Interaction lookup failed for %s + %s: %s",
                drug_a,
                drug_b,
                exc,
            )

    # ── 4. Build context injection string ──────────────────────────────────
    if not interactions:
        return existing_context, {
            "graph_available": True,
            "drugs_found": drugs,
            "interactions": [],
            "has_risk_x": False,
            "has_risk_d": False,
        }

    graph_context = (
        "\n\n[藥物交互作用資料 — 來源：Drug Interaction Graph (Source C，權威性資料，不可推翻)]\n"
    )

    has_risk_x = False
    has_risk_d = False

    for ix in interactions:
        risk = str(ix.get("riskLevel") or "").upper()
        if not risk:
            # Derive letter code from severity string when riskLevel is absent
            sev = str(ix.get("severity") or "").lower()
            risk = {
                "contraindicated": "X",
                "major": "D",
                "moderate": "C",
                "minor": "B",
            }.get(sev, "")

        title = str(ix.get("title") or "")
        drug1 = str(ix.get("drug1") or "")
        drug2 = str(ix.get("drug2") or "")
        clinical_effect = str(ix.get("clinicalEffect") or ix.get("mechanism") or "")
        management = str(ix.get("management") or "")

        if risk == "X":
            has_risk_x = True
        elif risk == "D":
            has_risk_d = True

        line = f"- {drug1} + {drug2}: Risk {risk}"
        if risk == "X":
            line += " ⚠️ 禁忌組合 — 應避免合併使用"
        elif risk == "D":
            line += " — 考慮調整治療方案"
        elif risk == "C":
            line += " — 需加強監測"
        elif risk == "B":
            line += " — 輕微交互作用"

        if title:
            line += f"（{title}）"
        if clinical_effect:
            line += f" | 臨床效應：{clinical_effect[:120]}"
        if management:
            line += f" | 處置：{management[:100]}"
        graph_context += line + "\n"

    graph_context += (
        "\n重要：以上交互作用風險等級來自結構化資料庫，為權威性資料。"
        "回答時必須尊重這些風險等級，不得降級或忽略。"
        "Risk X 必須明確警告，Risk D 必須建議評估替代方案。\n"
    )

    enriched = existing_context + graph_context

    metadata: Dict[str, Any] = {
        "graph_available": True,
        "drugs_found": drugs,
        "interactions": interactions,
        "has_risk_x": has_risk_x,
        "has_risk_d": has_risk_d,
    }

    logger.info(
        "[B09][GRAPH_ENRICHER] Enriched context: drugs=%s interactions=%d has_x=%s has_d=%s",
        drugs,
        len(interactions),
        has_risk_x,
        has_risk_d,
    )

    return enriched, metadata
