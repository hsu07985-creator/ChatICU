"""Duplicate-medication adapter for AI snapshot / clinical prompt building.

Mirrors the contract of ``app/utils/ddi_check.py`` so snapshot builders can
register both warnings with near-identical shapes:

    from app.utils.ddi_check import format_ddi_metadata
    from app.utils.duplicate_check import (
        format_duplicate_metadata,
        format_duplicate_text,
    )

``format_duplicate_metadata`` wraps the shared DuplicateDetector service
(docs/duplicate-medication-integration-plan.md §2) and retains only the
levels most relevant to LLM decisions (critical / high) to keep prompts
compact.

``format_duplicate_text`` formats those filtered warnings into a system-prompt
text block, matching the style of ``ddi_check.format_ddi_metadata``.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_LLM_RELEVANT_LEVELS = ("critical", "high")

_LEVEL_BADGE: Dict[str, str] = {
    "critical": "🔴 Critical",
    "high": "🟠 High",
    "moderate": "🟡 Moderate",
    "low": "🔵 Low",
    "info": "⚪ Info",
}


async def format_duplicate_metadata(
    db: AsyncSession,
    medications: List[Any],
    context: str = "inpatient",
) -> List[Dict[str, Any]]:
    """Compute duplicate alerts and reduce to an LLM-safe dict list.

    Args:
        db: AsyncSession; passed to DuplicateDetector (reads seed tables only).
        medications: list of ORM Medication or dicts (same shape accepted by
            :meth:`DuplicateDetector.analyze`).
        context: clinical setting ("inpatient" | "outpatient" | "icu" |
            "discharge").

    Returns:
        List of minimal warning dicts keyed by ``level / mechanism / members /
        recommendation``. Only ``critical`` and ``high`` levels are kept so the
        LLM prompt does not balloon. Always returns a list (never None).
    """
    if not medications or len(medications) < 2:
        return []

    # Local import to avoid circulars — detector imports SQLAlchemy heavy-weights.
    from app.services.duplicate_detector import DuplicateDetector

    try:
        detector = DuplicateDetector(db)
        alerts = await detector.analyze(medications, context=context)  # type: ignore[arg-type]
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("format_duplicate_metadata: detector failed: %s", exc)
        return []

    out: List[Dict[str, Any]] = []
    for a in alerts:
        if a.level not in _LLM_RELEVANT_LEVELS:
            continue
        out.append(
            {
                "level": a.level,
                "layer": a.layer,
                "mechanism": a.mechanism,
                "members": [m.generic_name for m in a.members],
                "recommendation": a.recommendation,
                "auto_downgraded": a.auto_downgraded,
            }
        )
    return out


def format_duplicate_text(warnings: List[Dict[str, Any]]) -> str:
    """Format duplicate warnings as a system-prompt metadata block.

    Style-matched to ``ddi_check.format_ddi_metadata``:
      * Empty input → empty string (caller concatenates safely).
      * Header with total count.
      * One bullet per warning, truncated recommendation.
    """
    if not warnings:
        return ""
    lines = [f"\n[重複用藥警示（自動偵測）] (共 {len(warnings)} 筆)"]
    for w in warnings[:10]:
        badge = _LEVEL_BADGE.get(str(w.get("level", "")), "⚠")
        mech = w.get("mechanism") or "?"
        members = " + ".join(w.get("members") or [])
        rec = (w.get("recommendation") or "")[:160]
        lines.append(f"  {badge} — {mech}：{members}")
        if rec:
            lines.append(f"      建議：{rec}")
    return "\n".join(lines)
