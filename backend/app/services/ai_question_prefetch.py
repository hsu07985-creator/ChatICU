"""Question-triggered LLM context prefetch for AI chat.

This is the transitional path before a full LLM tool loop exists. It keeps
large/conditional data out of the stable system prompt, but lets the backend
attach high-value context to the current LLM turn when the user's question
clearly needs it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, List

from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python <3.9 fallback
    from backports.zoneinfo import ZoneInfo  # type: ignore

from app.models.culture_result import CultureResult

logger = logging.getLogger("chaticu")

TAIPEI_TZ = ZoneInfo("Asia/Taipei")

_CULTURE_INTENT_KEYWORDS = (
    "culture",
    "cultures",
    "susceptibility",
    "sensitivity",
    "organism",
    "isolate",
    "antibiotic",
    "antibiotics",
    "de-escalation",
    "deescalation",
    "sepsis",
    "infection",
    "infectious",
    "bacteremia",
    "pneumonia",
    "vap",
    "uti",
    "菌",
    "培養",
    "感受性",
    "敏感性",
    "抗生素",
    "感染",
    "敗血",
    "菌血",
    "肺炎",
    "尿路感染",
    "降階",
    "退階",
    "去升階",
)


def should_prefetch_cultures(message: str) -> bool:
    text = (message or "").lower()
    return any(keyword in text for keyword in _CULTURE_INTENT_KEYWORDS)


def _fmt_dt(value: Any) -> str:
    if not isinstance(value, datetime):
        return "時間不明"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(TAIPEI_TZ).strftime("%Y-%m-%d %H:%M")


def _as_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    if value:
        return [value]
    return []


def _fmt_isolates(value: Any) -> str:
    isolates = _as_list(value)
    if not isolates:
        return "無 isolate"

    parts = []
    for item in isolates[:5]:
        if isinstance(item, dict):
            organism = item.get("organism") or item.get("name") or item.get("value")
            colonies = item.get("colonies")
            if organism and colonies:
                parts.append(f"{organism} ({colonies})")
            elif organism:
                parts.append(str(organism))
            else:
                parts.append(str(item))
        else:
            parts.append(str(item))
    if len(isolates) > 5:
        parts.append(f"另有 {len(isolates) - 5} 項")
    return "；".join(parts)


def _fmt_susceptibility(value: Any) -> str:
    susceptibility = _as_list(value)
    if not susceptibility:
        return "無 susceptibility"

    parts = []
    for item in susceptibility[:8]:
        if isinstance(item, dict):
            antibiotic = (
                item.get("antibiotic")
                or item.get("drug")
                or item.get("name")
                or item.get("code")
            )
            result = item.get("result") or item.get("interpretation")
            if antibiotic and result:
                parts.append(f"{antibiotic} {result}")
            elif antibiotic:
                parts.append(str(antibiotic))
            else:
                parts.append(str(item))
        else:
            parts.append(str(item))
    if len(susceptibility) > 8:
        parts.append(f"另有 {len(susceptibility) - 8} 項")
    return "；".join(parts)


async def get_recent_cultures(
    db: AsyncSession,
    patient_id: str,
    *,
    days: int = 14,
    limit: int = 5,
) -> List[CultureResult]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        select(CultureResult)
        .where(
            CultureResult.patient_id == patient_id,
            or_(
                CultureResult.collected_at >= cutoff,
                CultureResult.reported_at >= cutoff,
            ),
        )
        .order_by(desc(CultureResult.reported_at), desc(CultureResult.collected_at))
        .limit(limit)
    )
    return list(result.scalars().all())


def format_culture_context(cultures: List[CultureResult], *, days: int = 14) -> str:
    lines = [f"【微生物培養 最近{days}天】"]
    if not cultures:
        lines.append(f"狀態: no_data（未查到最近{days}天 culture_results）")
        return "\n".join(lines)

    lines.append(f"狀態: ok（{len(cultures)} 筆，最多顯示 5 筆）")
    for culture in cultures[:5]:
        collected = _fmt_dt(getattr(culture, "collected_at", None))
        reported = _fmt_dt(getattr(culture, "reported_at", None))
        specimen = getattr(culture, "specimen", None) or "specimen 不明"
        result_text = getattr(culture, "result", None) or "未列 result"
        q_score = getattr(culture, "q_score", None)
        q_score_text = f" | Q score {q_score}" if q_score is not None else ""
        lines.append(
            f"- {specimen} | 採檢 {collected} | 報告 {reported}{q_score_text}"
        )
        lines.append(f"  結果: {result_text}")
        lines.append(f"  Isolates: {_fmt_isolates(getattr(culture, 'isolates', None))}")
        lines.append(
            "  Susceptibility: "
            + _fmt_susceptibility(getattr(culture, "susceptibility", None))
        )
    return "\n".join(lines)


async def build_question_prefetch_context(
    db: AsyncSession,
    patient_id: str,
    message: str,
) -> str:
    if not patient_id or not should_prefetch_cultures(message):
        return ""

    try:
        cultures = await get_recent_cultures(db, patient_id)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "[CHAT][PREFETCH] culture prefetch failed patient=%s: %s",
            patient_id,
            exc,
        )
        return "【微生物培養 最近14天】\n狀態: error（讀取 culture_results 失敗）"
    return format_culture_context(cultures)
