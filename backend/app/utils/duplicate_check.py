"""Duplicate-medication adapter for AI snapshot / clinical prompt building.

    from app.utils.duplicate_check import (
        format_duplicate_metadata,
        format_duplicate_text,
    )

``format_duplicate_metadata`` wraps the shared DuplicateDetector service
and retains only the levels most relevant to LLM decisions (critical /
high) to keep prompts compact.

``format_duplicate_text`` formats those filtered warnings into a system-prompt
text block.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# P1-D6: include "moderate" so route-switch PPIs, anticholinergic burden,
# transitional heparin↔LMWH bridging etc. surface in the chat assistant.
# Previous filter only kept critical/high, so the LLM answered "no duplicate
# concerns" while the chart actually had moderate ones (chart-vs-chat
# mismatch is a clinical safety issue).
_LLM_RELEVANT_LEVELS = ("critical", "high", "moderate")

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

    Contract:
      * Empty input → empty string (caller concatenates safely).
      * Header with total count.
      * One bullet per warning, truncated recommendation.
    """
    if not warnings:
        return ""
    total = len(warnings)
    lines = [f"\n[重複用藥警示（自動偵測）] (共 {total} 筆)"]
    cap = 10
    for w in warnings[:cap]:
        badge = _LEVEL_BADGE.get(str(w.get("level", "")), "⚠")
        mech = w.get("mechanism") or "?"
        members = " + ".join(w.get("members") or [])
        rec = (w.get("recommendation") or "")[:160]
        lines.append(f"  {badge} — {mech}：{members}")
        if rec:
            lines.append(f"      建議：{rec}")
    # P1-D7: surface truncation so the LLM knows it didn't see everything.
    # Previously >10 alerts were silently dropped → model could conclude
    # "no further duplicate concerns" while #11+ were unrendered.
    if total > cap:
        lines.append(f"  … 另有 {total - cap} 筆未列出（總計 {total} 筆，請查閱完整警示）")
    return "\n".join(lines)
