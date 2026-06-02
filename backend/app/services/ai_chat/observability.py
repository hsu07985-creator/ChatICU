"""Observability glue for the ICU chat stream.

Read-only signal emission that NEVER changes what the user sees or blocks a
reply:

- Hedging detection (``_HEDGING_PATTERNS`` / ``_reply_looks_hedged``) +
  ``log_hedging_signal`` — emits the [CHAT][PREFETCH][MISS_LIKELY] /
  [CHAT][REPLY][HEDGED] F4-trigger signals.
- ``run_citation_audit`` — post-stream [用藥] citation fabrication audit
  (audit-logs suspects; sycophancy mitigation step).
- ``detect_and_inject_assertion_conflict`` — user-assertion vs snapshot
  conflict detection; injects a deterministic [系統偵測] block into the
  ephemeral user_message and audit-logs the conflict.
"""

import logging
from datetime import timezone
from typing import List, Optional, Tuple

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.audit import create_audit_log
from app.models.user import User
from app.services.assertion_conflict import (
    detect_med_negation_conflict,
    format_med_conflict_block,
)
from app.services.citation_audit import audit_citations, summarize_suspects
from app.utils.request import get_client_ip
from .prompt_assembly import _maybe_inject_assertion_conflict_into_user_message

logger = logging.getLogger("chaticu")


# M1: phrases the LLM tends to use when it wants more clinical context than
# the snapshot+prefetch gave it. Bilingual on purpose — the same model code-
# switches per question. Conservative list; biased toward false negatives so
# we don't drown the [MISS_LIKELY] signal in noise. Aggregated against the
# per-turn [CHAT][PREFETCH] log to estimate "F4 would have helped" rate.
#
# M3 (2026-05-03): widened after prod testing showed real prefetch misses
# whose hedging phrasing didn't intersect the original list. The DAY20
# test case "最近 72 小時改了什麼藥" had reply "無法判定 ... 目前系統無 ...
# 需要的資料包括 ..." — none of the original 12 patterns matched, so
# MISS_LIKELY didn't fire on the strongest F4-trigger candidate. New
# patterns target Chinese hedging idioms grouped into 4 buckets
# (uncertainty, missing-data, ask-for-data, conditional) so future
# additions stay legible.
_HEDGING_PATTERNS: tuple[str, ...] = (
    # Uncertainty / inability
    "缺少",
    "資料不足",
    "尚無提及",
    "尚無",
    "尚未提供",
    "無法判定",
    "無法判斷",
    "無法確認",
    "無法判讀",
    "難以判斷",
    "暫時無法",
    "I don't have",
    "without more",
    "insufficient information",
    "cannot determine",
    "unable to determine",
    "unable to assess",
    # Missing-data acknowledgements
    "未提供",
    "目前系統無",
    "目前資料無",
    "目前沒有相關",
    "目前沒有看到",
    "未見",
    "查無",
    "no data available",
    # Ask-for-data
    "請提供",
    "請補充",
    "請補上",
    "請補登",
    "建議補充",
    "需要的資料",
    "需更多資料",
    "建議補上",
    "please provide",
    # Conditional / hypothetical
    "若有更多",
    "如果有",
    "若無",
    "若無法",
    "若臨床",
    "若進一步",
)


def _reply_looks_hedged(reply: str) -> bool:
    """True when the assistant reply hints it wished it had more data.

    Used purely for log emission — never affects what the user sees. Match
    is case-insensitive for the English fragments; Chinese stays literal.
    """
    if not reply:
        return False
    lowered = reply.lower()
    for pattern in _HEDGING_PATTERNS:
        if pattern.lower() in lowered:
            return True
    return False


def log_hedging_signal(
    full_reply: str,
    *,
    had_patient_context: bool,
    prefetch_fired: bool,
    session_id: str,
) -> None:
    """M1: F4 trigger signal — turns where the LLM hedged AND we had patient
    context AND no prefetch fired. Aggregating these over time answers
    "would a real LLM tool loop catch questions our keyword prefetch
    doesn't?" — see docs/ai-chat-tool-loop-decision-2026-05-03.md §5
    signal B. Lower-tier [REPLY][HEDGED] log captures hedging in cases
    where prefetch did fire (less actionable for F4 but useful sanity).
    """
    if not (full_reply and had_patient_context):
        return
    hedged = _reply_looks_hedged(full_reply)
    if hedged and not prefetch_fired:
        logger.warning(
            "[CHAT][PREFETCH][MISS_LIKELY] session=%s reply_chars=%d "
            "— had patient context, no prefetch fired, reply hedged. "
            "Candidate question for F4 tool-loop coverage.",
            session_id,
            len(full_reply),
        )
    elif hedged:
        logger.info(
            "[CHAT][REPLY][HEDGED] session=%s reply_chars=%d prefetch_fired=%s "
            "— LLM hedged despite prefetch firing; check whether prefetch "
            "returned no_data or denied.",
            session_id,
            len(full_reply),
            prefetch_fired,
        )


async def run_citation_audit(
    db: AsyncSession,
    request: Request,
    *,
    full_reply: str,
    current_user: Optional[User],
    active_med_aliases: List[str],
    session_id: str,
    patient_id: Optional[str],
) -> None:
    """Sycophancy step — post-stream citation audit. Scans the assistant
    reply for [用藥] citations and flags any that name a drug not in the
    patient's active medication list (catches the LLM inventing a
    regimen). Read-only: never modifies or blocks the reply. The audit
    log is the ROI here — after a week of production we can see how
    often the LLM fabricates citations and decide on remediation.
    """
    if not (full_reply and current_user is not None):
        return
    try:
        cit_audit = audit_citations(full_reply, active_med_aliases or [])
        if cit_audit["total"] > 0:
            summary = summarize_suspects(cit_audit["suspects"])
            logger.info(
                "[CHAT][CITATION] session=%s patient=%s total=%d "
                "by_section=%s suspects=%s",
                session_id,
                patient_id or "-",
                cit_audit["total"],
                cit_audit["by_section"],
                summary or "none",
            )
            if cit_audit["suspects"]:
                await create_audit_log(
                    db,
                    user_id=current_user.id,
                    user_name=current_user.name,
                    role=current_user.role,
                    action="ai_chat_citation_fabrication_suspected",
                    target=patient_id,
                    status="detected",
                    ip=get_client_ip(request),
                    details={
                        "session_id": session_id,
                        "total_citations": cit_audit["total"],
                        "by_section": cit_audit["by_section"],
                        "suspects": [
                            {
                                "section": s["section"],
                                "token": s["token"],
                                "reason": s["reason"],
                                "content": s["content"][:80],
                            }
                            for s in cit_audit["suspects"]
                        ],
                    },
                )
                try:
                    await db.commit()
                except Exception:
                    await db.rollback()
    except Exception:  # pragma: no cover — never block the reply
        logger.warning(
            "[CHAT][CITATION] audit failed session=%s",
            session_id,
            exc_info=True,
        )


async def detect_and_inject_assertion_conflict(
    db: AsyncSession,
    request: Request,
    *,
    user_message: str,
    original_message: str,
    active_meds: list,
    current_user: User,
    session_id: str,
    patient_id: str,
) -> str:
    """Step 2: user-assertion vs snapshot conflict detection.

    Surface "user says no X but snapshot still has X active" as a
    deterministic [系統偵測] block so the LLM (per step-1 fact-checking
    rules) cannot silently agree with the user. Cheap: the matcher is
    sub-millisecond.

    ``active_meds`` is the already-fetched active-medication list (reused
    from the caller so we don't re-query). Returns ``user_message``,
    possibly with the conflict block injected. Audited so we can later
    quantify how often this fires and whether the LLM actually pushed back.
    """
    try:
        conflict_med_names = [m.name for m in active_meds if m and m.name]
        conflicts = detect_med_negation_conflict(original_message, conflict_med_names)
        if conflicts:
            med_records = [
                {
                    "name": m.name,
                    "dose": m.dose,
                    "unit": m.unit,
                    "frequency": m.frequency,
                    "route": m.route,
                    "updated_at_str": (
                        m.updated_at.astimezone(timezone.utc).strftime(
                            "%Y-%m-%d %H:%M UTC"
                        )
                        if m.updated_at
                        else None
                    ),
                }
                for m in active_meds
            ]
            conflict_block = format_med_conflict_block(conflicts, med_records)
            user_message = _maybe_inject_assertion_conflict_into_user_message(
                user_message, conflict_block
            )
            logger.info(
                "[CHAT][CONFLICT] session=%s patient=%s conflicts=%s",
                session_id,
                patient_id,
                [c["med_name"] for c in conflicts],
            )
            await create_audit_log(
                db,
                user_id=current_user.id,
                user_name=current_user.name,
                role=current_user.role,
                action="ai_chat_user_assertion_conflict",
                target=patient_id,
                status="detected",
                ip=get_client_ip(request),
                details={
                    "session_id": session_id,
                    "conflict_count": len(conflicts),
                    "conflicts": [
                        {
                            "med_name": c["med_name"],
                            "matched_cue": c["matched_cue"],
                        }
                        for c in conflicts
                    ],
                },
            )
    except Exception as exc:  # pragma: no cover — defensive: never block a reply
        logger.warning(
            "[CHAT][CONFLICT] detection failed session=%s patient=%s: %s",
            session_id,
            patient_id,
            exc,
        )
    return user_message
