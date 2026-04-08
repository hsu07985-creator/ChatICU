"""Safety Gate (B12) — Per-intent evidence thresholds and confidence safety rules.

Enforces per-intent minimum evidence requirements and confidence thresholds
from the architecture plan §7.1-§7.3 and source_priorities.json.

This module is intentionally stateless and pure-function-based so it can be
called from any clinical endpoint without side effects.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Per-intent confidence thresholds
# Sourced from backend/config/source_priorities.json + §7.1-§7.3
# ---------------------------------------------------------------------------

_INTENT_THRESHOLDS = {
    "dose_calculation": 0.75,
    "pair_interaction": 0.60,
    "multi_drug_rx": 0.60,
    "iv_compatibility": 0.90,
    "drug_monograph": 0.55,
    "single_drug_interactions": 0.60,
    "nhi_reimbursement": 0.65,
    "clinical_guideline": 0.55,
    "clinical_decision": 0.60,
    "patient_education": 0.45,
    "clinical_summary": 0.45,
    "drug_comparison": 0.55,
    "general_pharmacology": 0.45,
}

_DEFAULT_THRESHOLD = 0.55


# ---------------------------------------------------------------------------
# Result model
# ---------------------------------------------------------------------------

class SafetyGateResult(BaseModel):
    """Result of applying per-intent safety rules."""

    passed: bool
    confidence: float
    requires_expert_review: bool = False
    safety_note: Optional[str] = None
    adjusted_answer: Optional[str] = None  # Prefix to prepend to answer if needed


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def apply_safety_gate(
    intent: str,
    confidence: float,
    evidence_count: int,
    has_graph_data: bool = False,
    has_contradiction: bool = False,
    detected_drugs: Optional[List[str]] = None,
) -> SafetyGateResult:
    """Apply per-intent safety rules and return a SafetyGateResult.

    Rules (from architecture plan §7.1-§7.3):
      Rule 1: Very low confidence (<0.35) OR zero evidence (for non-general
              intents) → refuse (requires_expert_review=True, adjusted_answer).
      Rule 2: Below intent-specific threshold → partial confidence flag.
      Rule 3: iv_compatibility without graph data → refuse with safety note.
      Rule 4: Contradiction detected → always flag for expert review.
      Rule 5: dose_calculation with zero evidence → refuse to generate answer.

    Args:
        intent: The classified query intent string.
        confidence: Current evidence confidence in [0.0, 1.0].
        evidence_count: Number of evidence chunks retrieved (0 = no evidence).
        has_graph_data: True if Source C (Drug Graph) returned results.
        has_contradiction: True if evidence fuser detected a contradiction.
        detected_drugs: Optional list of drug names detected in the query.

    Returns:
        SafetyGateResult with passed, confidence, requires_expert_review,
        safety_note, and adjusted_answer fields.
    """
    threshold = _INTENT_THRESHOLDS.get(intent, _DEFAULT_THRESHOLD)
    requires_review = False
    safety_note: Optional[str] = None
    adjusted_answer: Optional[str] = None

    # ── Rule 1: Very low confidence or no evidence ────────────────────────
    if confidence < 0.35 or (evidence_count == 0 and intent != "general_pharmacology"):
        requires_review = True
        if intent == "dose_calculation":
            safety_note = "知識庫中未找到此藥劑量資料。請諮詢藥師。"
            adjusted_answer = "⚠️ " + safety_note
        elif intent == "iv_compatibility":
            safety_note = "此藥物組合無相容性資料。請查閱 IV 相容性參考。"
            adjusted_answer = "⚠️ " + safety_note
        else:
            safety_note = (
                "目前知識庫中未找到相關資料。建議查閱原始文獻或諮詢專科醫師。"
            )

    # ── Rule 2: Below intent-specific threshold ───────────────────────────
    elif confidence < threshold:
        requires_review = True
        safety_note = (
            f"信心度 ({confidence:.0%}) 低於此類型查詢的建議門檻 ({threshold:.0%})。"
            "建議由專業人員確認。"
        )

    # ── Rule 3: IV compatibility without graph data ───────────────────────
    if intent == "iv_compatibility" and not has_graph_data:
        requires_review = True
        _iv_note = "此藥物組合無相容性資料。請查閱 IV 相容性參考。"
        safety_note = _iv_note
        adjusted_answer = "⚠️ " + _iv_note

    # ── Rule 4: Contradiction ─────────────────────────────────────────────
    if has_contradiction:
        requires_review = True
        _contra_suffix = " 多個來源存在分歧，建議由專家審核。"
        safety_note = (safety_note or "") + _contra_suffix

    # ── Rule 5: dose_calculation with no evidence → refuse ───────────────
    if intent == "dose_calculation" and evidence_count == 0:
        adjusted_answer = (
            "⚠️ 知識庫中未找到此藥劑量資料。"
            "請勿依據此回答調整劑量，請諮詢藥師。"
        )
        requires_review = True

    # Determine pass/fail
    # iv_compatibility without graph_data always fails regardless of confidence
    iv_no_graph = intent == "iv_compatibility" and not has_graph_data
    passed = (confidence >= threshold) and not iv_no_graph

    logger.debug(
        "[B12][safety_gate] intent=%s confidence=%.2f threshold=%.2f "
        "evidence_count=%d has_graph=%s has_contradiction=%s "
        "passed=%s requires_review=%s",
        intent,
        confidence,
        threshold,
        evidence_count,
        has_graph_data,
        has_contradiction,
        passed,
        requires_review,
    )

    return SafetyGateResult(
        passed=passed,
        confidence=confidence,
        requires_expert_review=requires_review,
        safety_note=safety_note if safety_note else None,
        adjusted_answer=adjusted_answer,
    )
