"""Evidence quality gate for AO-03 (minimum citations/confidence)."""

from __future__ import annotations

from typing import Any, Iterable

from app.config import settings


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_confidence(value: Any) -> float:
    numeric = _to_float(value)
    if numeric is None:
        return 0.0
    if numeric > 1 and numeric <= 100:
        numeric = numeric / 100.0
    if numeric < 0:
        return 0.0
    if numeric > 1:
        return 1.0
    return numeric


def _confidence_from_citations(citations: Iterable[dict[str, Any]]) -> float:
    scores: list[float] = []
    for citation in citations:
        score = _to_float(citation.get("score"))
        if score is None:
            score = _to_float(citation.get("relevance"))
        if score is not None:
            scores.append(score)
    if not scores:
        return 0.0
    max_score = max(scores)
    if max_score > 1 and max_score <= 100:
        max_score = max_score / 100.0
    if max_score < 0:
        return 0.0
    if max_score > 1:
        return 1.0
    return float(max_score)


def evaluate_evidence_gate(
    *,
    citations: list[dict[str, Any]] | None,
    confidence: Any = None,
    min_citations: int | None = None,
    min_confidence: float | None = None,
) -> dict[str, Any]:
    citation_list = list(citations or [])
    threshold_citations = max(0, min_citations if min_citations is not None else settings.RAG_MIN_CITATIONS)
    threshold_confidence = _normalize_confidence(
        min_confidence if min_confidence is not None else settings.RAG_MIN_CONFIDENCE
    )

    confidence_value = _normalize_confidence(confidence)
    if confidence is None:
        confidence_value = _confidence_from_citations(citation_list)

    citation_ok = len(citation_list) >= threshold_citations
    confidence_ok = confidence_value >= threshold_confidence
    passed = citation_ok and confidence_ok

    if passed:
        reason_code = None
        display_reason = None
    elif len(citation_list) == 0:
        reason_code = "EVIDENCE_NOT_FOUND"
        display_reason = "目前查無足夠文獻證據，AI 已拒答，請改寫問題或補充知識庫。"
    elif not citation_ok:
        reason_code = "INSUFFICIENT_CITATIONS"
        display_reason = (
            f"引用證據不足（需至少 {threshold_citations} 筆，現有 {len(citation_list)} 筆），AI 已拒答。"
        )
    else:
        reason_code = "LOW_CONFIDENCE"
        display_reason = (
            f"證據信心不足（需至少 {threshold_confidence:.2f}，目前 {confidence_value:.2f}），AI 已拒答。"
        )

    return {
        "passed": passed,
        "reason_code": reason_code,
        "display_reason": display_reason,
        "citation_count": len(citation_list),
        "confidence": round(confidence_value, 4),
        "thresholds": {
            "min_citations": threshold_citations,
            "min_confidence": round(threshold_confidence, 4),
        },
    }
