"""Helpers to normalize free-text AI outputs into stable AO-02 schemas."""

from __future__ import annotations

import re
from typing import Any, Iterable

_BULLET_RE = re.compile(r"^\s*(?:[-*•]|\d+\.)\s+(.+)$")
_ACTION_KEYWORDS = (
    "建議",
    "應",
    "請",
    "監測",
    "調整",
    "追蹤",
    "處置",
    "recommend",
)


def _normalize_line(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned.strip("-*• ").strip()


def _dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = _normalize_line(item)
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def _extract_bullets(text: str) -> list[str]:
    bullets: list[str] = []
    for line in text.splitlines():
        match = _BULLET_RE.match(line)
        if match:
            bullets.append(match.group(1))
    return _dedupe(bullets)


def _extract_paragraphs(text: str) -> list[str]:
    paragraphs = re.split(r"\n\s*\n+", text.strip())
    return _dedupe(paragraphs)


def _fallback_points(text: str, limit: int = 6) -> list[str]:
    bullets = _extract_bullets(text)
    if bullets:
        return bullets[:limit]
    paragraphs = _extract_paragraphs(text)
    if paragraphs:
        return paragraphs[:limit]
    inline = [chunk for chunk in re.split(r"[。！？!?]\s*", text) if chunk.strip()]
    return _dedupe(inline)[:limit]


def _select_action_items(points: list[str], *, limit: int = 4) -> list[str]:
    actions = [p for p in points if any(keyword in p for keyword in _ACTION_KEYWORDS)]
    if actions:
        return actions[:limit]
    return points[:limit]


def build_summary_structured(summary_text: str) -> dict[str, Any]:
    points = _fallback_points(summary_text, limit=8)
    overview = points[0] if points else ""
    return {
        "schema_version": "clinical_summary.v1",
        "overview": overview,
        "key_findings": points[:5],
        "recommended_actions": _select_action_items(points, limit=4),
    }


def build_explanation_structured(
    explanation_text: str,
    *,
    topic: str,
    reading_level: str | None,
) -> dict[str, Any]:
    points = _fallback_points(explanation_text, limit=8)
    summary = points[0] if points else ""
    return {
        "schema_version": "patient_explanation.v1",
        "topic": topic.strip() or "general",
        "reading_level": reading_level or "moderate",
        "plain_language_summary": summary,
        "key_points": points[:5],
        "care_advice": _select_action_items(points, limit=4),
    }


def build_decision_structured(
    recommendation_text: str,
    *,
    question: str,
    assessments: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    points = _fallback_points(recommendation_text, limit=8)
    recommendation = points[0] if points else recommendation_text.strip()
    return {
        "schema_version": "decision_support.v1",
        "question": question,
        "recommendation": recommendation,
        "rationale_points": points[:5],
        "action_items": _select_action_items(points, limit=4),
        "assessments_count": len(assessments or []),
    }
