"""
ai_chat.py — ICU Chat Assistant endpoint (new clean-chain architecture).

Flow:
  1. Get or create AISession
  2. First turn → build_clinical_snapshot() → embed in system prompt
     Subsequent turns → build_delta() if snapshot is > 30 min old
  3. Load last N message pairs (context compression window)
  4. Stream LLM response via SSE
  5. Persist assistant reply + update session
"""

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session, get_db
from app.llm import call_llm_stream, TASK_PROMPTS
from app.middleware.auth import get_current_user
from app.models.ai_session import AISession, AIMessage
from app.models.user import User
from app.services.ai_question_prefetch import build_question_prefetch_with_metadata
from app.services.patient_acl import assert_patient_chat_access
from app.services.patient_context_builder import (
    build_clinical_snapshot,
    build_critical_snapshot,
    build_deferred_snapshot,
    build_delta,
    extract_snapshot_key_values,
    _get_latest_lab,
    _get_active_medications,
)

logger = logging.getLogger("chaticu")

router = APIRouter(prefix="/ai", tags=["AI Chat"])

# Keep last N conversation pairs in the context window
_CONTEXT_WINDOW = 10


# ── Request / Response schemas ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(..., min_length=1, max_length=4000)
    patient_id: Optional[str] = Field(None, alias="patientId")
    session_id: Optional[str] = Field(None, alias="sessionId")


class MessageFeedbackRequest(BaseModel):
    # "up" / "down" / null. Pydantic accepts None → clears feedback.
    feedback: Optional[str] = Field(None, description="'up', 'down', or null to clear")


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_session(
    db: AsyncSession,
    user_id: str,
    patient_id: Optional[str],
    session_id: Optional[str],
) -> AISession:
    if session_id:
        result = await db.execute(
            select(AISession).where(
                AISession.id == session_id,
                AISession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()
        if session:
            return session

    new_session = AISession(
        id=f"sess_{uuid.uuid4().hex[:16]}",
        user_id=user_id,
        patient_id=patient_id,
        title=None,
        summary=None,
        summary_up_to=0,
        snapshot_metadata=None,
    )
    db.add(new_session)
    await db.flush()
    return new_session


async def _load_messages(
    db: AsyncSession,
    session_id: str,
    window: int,
) -> List[AIMessage]:
    """Load the most recent `window` messages, oldest first."""
    result = await db.execute(
        select(AIMessage)
        .where(AIMessage.session_id == session_id)
        .order_by(desc(AIMessage.created_at))
        .limit(window)
    )
    msgs = list(result.scalars().all())
    msgs.reverse()
    return msgs


def _build_system_prompt(snapshot: str) -> str:
    base = TASK_PROMPTS["icu_chat"]
    return f"{base}\n\n[病患臨床快照]\n{snapshot}"


def _maybe_inject_deferred_into_user_message(
    user_message: str, snapshot_metadata: Optional[dict]
) -> str:
    """B15-A1.1: prepend deferred snapshot context to the LLM-facing user
    message when the background fill has completed, so the deferred bytes
    are NEVER part of system_prompt or persisted history.

    Why this matters for OpenAI prompt cache:
      The cache key is the message-array prefix that is byte-identical
      across requests. system_prompt + persisted history forms the
      stable prefix; mutating system_prompt mid-session (which the prior
      _merged_snapshot helper did) busts cache for every subsequent turn
      in that session — measured in canary at hit_ratio_p50 dropping
      from 70% to 0%.

      A1.1 keeps system_prompt = TASK_PROMPTS + critical-snapshot-only,
      byte-stable per session. Deferred context is folded into the
      ephemeral user_message — it goes to the LLM but is NOT persisted
      via _event_stream (original_message stays clean for DB history).

    Returns user_message unchanged when:
      - SNAPSHOT_DEFERRED_ENABLED is false (legacy path)
      - snapshot_metadata is None (no session context yet)
      - deferred_status is not "ready" (background fill still pending or failed)
      - deferred text is empty (e.g. patient has no reports/scores/vent)
    """
    if not settings.SNAPSHOT_DEFERRED_ENABLED:
        return user_message
    if not snapshot_metadata:
        return user_message
    if snapshot_metadata.get("deferred_status") != "ready":
        return user_message
    deferred = (snapshot_metadata.get("clinical_snapshot_deferred") or "").strip()
    if not deferred:
        return user_message
    return (
        "[以下為背景補充資料，僅供回答本輪問題使用]\n"
        f"{deferred}\n\n"
        f"[使用者提問]\n{user_message}"
    )


def _maybe_inject_question_prefetch_into_user_message(
    user_message: str,
    prefetch_context: str,
) -> str:
    """Attach question-triggered context to the current LLM turn only.

    Like deferred snapshot injection, this must not be persisted into
    ai_messages and must not mutate the session's system prompt. If deferred
    context is already wrapped around the question, insert the prefetch block
    before the final [使用者提問] marker to avoid nested question wrappers.
    """
    context = (prefetch_context or "").strip()
    if not context:
        return user_message

    block = (
        "[以下為依本輪問題預取的資料，僅供回答本輪問題使用]\n"
        f"{context}"
    )
    marker = "[使用者提問]\n"
    if marker in user_message:
        prefix, question = user_message.rsplit(marker, 1)
        return f"{prefix.rstrip()}\n\n{block}\n\n{marker}{question}"
    return f"{block}\n\n{marker}{user_message}"


async def _fill_deferred_snapshot_bg(
    session_id: str, patient_id: str, intubated: bool
) -> None:
    """Fire-and-forget background task: fetch deferred snapshot sections
    (vent / reports / scores) and persist into AISession.snapshot_metadata.

    Runs on its own AsyncSession (the request session is already closed
    by the time this fires). Failures are non-fatal — chat keeps working
    with critical-only snapshot if this background fill never completes.

    W3-T2: writes via PostgreSQL JSONB ``||`` merge so concurrent writers
    can't last-write-wins each other. SQLite (tests) falls back to the
    classic read-modify-write because it has no JSONB merge operator;
    the test harness has no concurrent writers so the race window is
    moot anyway.
    """
    try:
        async with async_session() as bg_db:
            deferred_text = await build_deferred_snapshot(
                patient_id, bg_db, intubated=intubated
            )
            payload = {
                "clinical_snapshot_deferred": deferred_text,
                "deferred_status": "ready" if deferred_text else "empty",
                "deferred_filled_at": datetime.now(timezone.utc).isoformat(),
            }
            dialect = bg_db.bind.dialect.name if bg_db.bind is not None else ""
            if dialect == "postgresql":
                # Atomic merge — UPDATE ... SET col = COALESCE(col, '{}') || :payload
                # so we never read-then-write. Returns rowcount; 0 means session
                # was deleted between create_task() and now.
                from sqlalchemy import text as sa_text
                result = await bg_db.execute(
                    sa_text(
                        "UPDATE ai_sessions "
                        "SET snapshot_metadata = COALESCE(snapshot_metadata, '{}'::jsonb) || CAST(:payload AS jsonb) "
                        "WHERE id = :sid"
                    ),
                    {"payload": json.dumps(payload), "sid": session_id},
                )
                if result.rowcount == 0:
                    logger.warning(
                        "[CHAT][DEFERRED] session=%s gone before deferred fill landed",
                        session_id,
                    )
                    return
            else:
                # SQLite test fallback — read-modify-write in one txn.
                sess = (await bg_db.execute(
                    select(AISession).where(AISession.id == session_id)
                )).scalar_one_or_none()
                if sess is None:
                    logger.warning(
                        "[CHAT][DEFERRED] session=%s gone before deferred fill landed",
                        session_id,
                    )
                    return
                merged = {**(sess.snapshot_metadata or {}), **payload}
                sess.snapshot_metadata = merged
            await bg_db.commit()
            logger.info(
                "[CHAT][DEFERRED] session=%s deferred_chars=%d status=%s",
                session_id, len(deferred_text), payload["deferred_status"],
            )
    except Exception as exc:  # pragma: no cover - background fault tolerance
        logger.warning(
            "[CHAT][DEFERRED] background fill failed session=%s: %s",
            session_id, exc,
        )


def _messages_to_api_format(messages: List[AIMessage]) -> List[dict]:
    return [{"role": m.role, "content": m.content} for m in messages]


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


# ── SSE event stream ──────────────────────────────────────────────────────────

# O-2: SSE comment-frame heartbeat. Emitted during LLM stalls so Vercel /
# Railway / nginx-style proxies don't kill an idle-looking connection.
# The frontend's parseSseFrame in src/lib/api/ai.ts:244 treats lines without
# `event:`/`data:` prefixes as no-ops, so heartbeat frames flow through
# transparently without affecting the rendered conversation.
_HEARTBEAT_INTERVAL_S = 15.0


async def _with_heartbeat(stream, interval_s: float = _HEARTBEAT_INTERVAL_S):
    """Wrap an async iterator so heartbeats fire during stalls.

    Yields:
      ('chunk', value)      for every item the underlying stream emits
      ('heartbeat', None)   every ``interval_s`` seconds of inactivity

    A producer coroutine drains the upstream into an internal queue so the
    consumer can race between real chunks and the heartbeat timer. The
    upstream task is always cancelled on exit (e.g. client disconnect) so
    the LLM stream is not leaked.
    """
    import asyncio
    queue: asyncio.Queue = asyncio.Queue()
    _DONE = object()

    async def producer() -> None:
        try:
            async for item in stream:
                await queue.put(item)
        finally:
            await queue.put(_DONE)

    task = asyncio.create_task(producer())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=interval_s)
            except asyncio.TimeoutError:
                yield ("heartbeat", None)
                continue
            if item is _DONE:
                return
            yield ("chunk", item)
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


async def _event_stream(
    user_message: str,
    system_prompt: str,
    history: List[dict],
    session_id: str,
    db: AsyncSession,
    request: Request,
    timings: Optional[dict] = None,
    prefetch_meta: Optional[dict] = None,
    prefetch_fired: bool = False,
    had_patient_context: bool = False,
) -> AsyncGenerator[str, None]:
    """
    Generate SSE events from the LLM stream and persist the reply.

    The user message is already persisted by chat_stream() before this
    generator runs (W1-T3), so client disconnects mid-stream do not lose
    the user's question. Only the assistant reply is written here, and only
    when generation completes successfully.

    SSE protocol (matches frontend parseSseFrame expectations):
      event: delta  → {"chunk": "text"}         (streaming tokens)
      event: done   → {"message": "...", "sessionId": "..."}  (final)
      event: error  → {"message": "error text"}  (on failure)
    """
    messages = list(history)
    messages.append({"role": "user", "content": user_message})

    request_id = getattr(request.state, "request_id", None)
    trace_id = getattr(request.state, "trace_id", None)

    full_reply = ""
    token_count = 0
    prompt_tokens = 0
    cached_tokens = 0
    first_token_logged = False
    t_pre_llm = time.perf_counter()

    try:
        llm_stream = call_llm_stream(
            "icu_chat",
            messages,
            system_prompt_override=system_prompt,
            request_id=request_id,
            trace_id=trace_id,
        )
        async for kind, chunk in _with_heartbeat(llm_stream):
            if kind == "heartbeat":
                # SSE comment frame — keeps proxy connections warm during
                # LLM thinking pauses; frontend ignores it.
                yield ": heartbeat\n\n"
                continue
            if chunk.startswith("{") and "__done__" in chunk:
                try:
                    meta = json.loads(chunk)
                    usage = meta.get("usage", {}) or {}
                    token_count = (
                        usage.get("completion_tokens")
                        or usage.get("output_tokens")
                        or 0
                    )
                    prompt_tokens = usage.get("prompt_tokens") or 0
                    cached_tokens = usage.get("cached_tokens") or 0
                except Exception:
                    pass
                break
            elif chunk.startswith("[ERROR]"):
                error_msg = chunk[7:].strip() if len(chunk) > 7 else "AI service error"
                yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"
                return
            else:
                if not first_token_logged:
                    first_token_logged = True
                    t_first = time.perf_counter()
                    if timings:
                        t0 = timings.get("t0", t_pre_llm)
                        t_session = timings.get("t_session", t_pre_llm)
                        t_snapshot = timings.get("t_snapshot", t_pre_llm)
                        logger.info(
                            "[CHAT][TIMING] session=%.0fms snapshot=%.0fms pre_llm=%.0fms ttft=%.0fms total=%.0fms sys_prompt_chars=%d",
                            (t_session - t0) * 1000,
                            (t_snapshot - t_session) * 1000,
                            (t_pre_llm - t_snapshot) * 1000,
                            (t_first - t_pre_llm) * 1000,
                            (t_first - t0) * 1000,
                            len(system_prompt),
                        )
                    else:
                        logger.info(
                            "[CHAT][TIMING] ttft=%.0fms sys_prompt_chars=%d",
                            (t_first - t_pre_llm) * 1000,
                            len(system_prompt),
                        )
                full_reply += chunk
                yield f"event: delta\ndata: {json.dumps({'chunk': chunk})}\n\n"

    except Exception as e:
        logger.error("[AI_CHAT] Stream error: %s", str(e)[:500])
        yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
        return

    if prompt_tokens:
        cache_ratio = (cached_tokens / prompt_tokens * 100) if prompt_tokens else 0
        logger.info(
            "[CHAT][CACHE] prompt_tokens=%d cached_tokens=%d hit_ratio=%.0f%% completion_tokens=%d",
            prompt_tokens,
            cached_tokens,
            cache_ratio,
            token_count,
        )
        # O-1: alert on regression. Skip first turn (cache always 0% on first
        # request of a session — no prior identical prefix exists). On any
        # subsequent turn we expect hit_ratio ≥50% under normal operation; a
        # value below that with a non-trivial prompt usually means the
        # byte-stable system_prompt boundary was broken (see the
        # _merged_snapshot incident referenced above where canary dropped
        # 70% → 0%). Threshold is conservative — adjust if it's noisy.
        if prompt_tokens >= 500 and cached_tokens > 0 and cache_ratio < 50:
            logger.warning(
                "[CHAT][CACHE][LOW_HIT] hit_ratio=%.0f%% prompt_tokens=%d cached_tokens=%d "
                "session=%s — possible byte-stable prefix regression, check recent llm.py / "
                "ai_chat.py edits to system_prompt assembly",
                cache_ratio, prompt_tokens, cached_tokens, session_id,
            )

    # Persist assistant reply only (user message was already committed by
    # chat_stream before the generator started, see W1-T3).
    assistant_msg_id = f"msg_{uuid.uuid4().hex[:16]}"
    if full_reply:
        db.add(AIMessage(
            id=assistant_msg_id,
            session_id=session_id,
            role="assistant",
            content=full_reply,
            token_count=token_count or None,
        ))
        try:
            await db.commit()
        except Exception as e:
            logger.warning("[AI_CHAT] Failed to persist assistant reply: %s", str(e))
            await db.rollback()

    # M1: F4 trigger signal — turns where the LLM hedged AND we had patient
    # context AND no prefetch fired. Aggregating these over time answers
    # "would a real LLM tool loop catch questions our keyword prefetch
    # doesn't?" — see docs/ai-chat-tool-loop-decision-2026-05-03.md §5
    # signal B. Lower-tier [REPLY][HEDGED] log captures hedging in cases
    # where prefetch did fire (less actionable for F4 but useful sanity).
    if full_reply and had_patient_context:
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

    # Send done event — frontend expects ChatResponse shape:
    # { message: ChatMessage, sessionId: string, prefetchRefs?: {...} }
    # F3: prefetchRefs surfaces deep-link metadata (currently advice records)
    # so the chat UI can render clickable chips below the assistant bubble.
    # Live-only — not persisted to ai_messages, so the chips disappear on
    # page reload. Persistence is a future enhancement (would need either
    # a new JSONB column or co-opting suggested_actions).
    now_iso = datetime.now(timezone.utc).isoformat()
    done_payload = {
        "message": {
            "id": assistant_msg_id,
            "role": "assistant",
            "content": full_reply,
            "timestamp": now_iso,
            "explanation": None,
            "citations": [],
            "safetyWarnings": None,
            "requiresExpertReview": False,
            "degraded": False,
            "degradedReason": None,
            "upstreamStatus": None,
            "dataFreshness": None,
            "graphMeta": None,
        },
        "sessionId": session_id,
        "prefetchRefs": prefetch_meta or {},
    }
    yield f"event: done\ndata: {json.dumps(done_payload, ensure_ascii=False)}\n\n"


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    Stream chat response via SSE.

    First turn: builds Clinical Snapshot and embeds it in the system prompt.
    Subsequent turns: checks for data updates (delta) if snapshot > 30 min old.
    """
    t0 = time.perf_counter()
    # W1-T1 ACL: verify patient exists + role gate + audit log.
    # No-op when body.patient_id is None (general chat).
    await assert_patient_chat_access(
        db,
        current_user,
        body.patient_id,
        ip=request.client.host if request.client else None,
    )
    session = await _get_or_create_session(
        db, current_user.id, body.patient_id, body.session_id
    )
    t_session = time.perf_counter()

    patient_id = body.patient_id or session.patient_id
    is_first_turn = session.snapshot_metadata is None

    # ── Build system prompt ────────────────────────────────────────────────
    if patient_id and is_first_turn:
        # First turn: build snapshot and store only the snapshot text.
        # We do NOT store the full system_prompt so that prompt updates in
        # TASK_PROMPTS["icu_chat"] take effect immediately for all sessions.
        if settings.SNAPSHOT_DEFERRED_ENABLED:
            # B15-A1 fast path: critical-only synchronously, deferred in
            # background. Goal is first-turn snapshot_ms ~3s vs ~6s.
            critical, key_vals, deferred_meta = await build_critical_snapshot(
                patient_id, db
            )
            session.snapshot_metadata = {
                "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
                "snapshot_key_values": key_vals,
                "clinical_snapshot": critical,
                "deferred_status": "pending",
                "deferred_intubated": deferred_meta.get("intubated", False),
            }
            await db.flush()
            # Fire-and-forget. Uses its own AsyncSession (the request one is
            # closed shortly after this handler returns). Failures are logged
            # but never break the chat reply.
            asyncio.create_task(
                _fill_deferred_snapshot_bg(
                    session.id,
                    patient_id,
                    deferred_meta.get("intubated", False),
                )
            )
        else:
            # Existing v1 path (full snapshot up front). Run snapshot build
            # + key-value lab/med fetch in parallel so we don't pay two
            # sequential round-trips on the first turn.
            snapshot, (lab, meds) = await asyncio.gather(
                build_clinical_snapshot(patient_id, db),
                asyncio.gather(
                    _get_latest_lab(db, patient_id),
                    _get_active_medications(db, patient_id),
                ),
            )
            key_vals = extract_snapshot_key_values(lab, meds)
            session.snapshot_metadata = {
                "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
                "snapshot_key_values": key_vals,
                "clinical_snapshot": snapshot,
            }
            await db.flush()
    t_snapshot = time.perf_counter()

    if session.snapshot_metadata and session.snapshot_metadata.get("clinical_snapshot"):
        # Always rebuild from current TASK_PROMPTS so prompt updates apply immediately.
        # B15-A1.1: read clinical_snapshot directly (critical-only when
        # SNAPSHOT_DEFERRED_ENABLED is on, full when off). The deferred
        # follow-up is NEVER merged into system_prompt — it would mutate
        # the byte-stable prefix and bust OpenAI prompt cache (the prior
        # _merged_snapshot path dropped cache_hit_ratio_p50 from 70% to 0%
        # in canary, see docs/b15-snapshot-latency-plan-2026-04-30.md).
        # Deferred is instead injected into the ephemeral user_message
        # below via _maybe_inject_deferred_into_user_message.
        system_prompt = _build_system_prompt(session.snapshot_metadata["clinical_snapshot"])
    elif session.snapshot_metadata and session.snapshot_metadata.get("system_prompt"):
        # Backward compat: old sessions that stored full system_prompt
        system_prompt = _build_system_prompt(
            session.snapshot_metadata["system_prompt"].split("[病患臨床快照]")[-1].strip()
            if "[病患臨床快照]" in session.snapshot_metadata.get("system_prompt", "")
            else ""
        )
    elif patient_id:
        snapshot = await build_clinical_snapshot(patient_id, db)
        system_prompt = _build_system_prompt(snapshot)
    else:
        system_prompt = TASK_PROMPTS["icu_chat"]

    # ── Check for data delta on subsequent turns ───────────────────────────
    user_message = body.message
    if patient_id and not is_first_turn and session.snapshot_metadata:
        snap_meta = session.snapshot_metadata
        delta = await build_delta(
            patient_id,
            db,
            snap_meta.get("snapshot_key_values", {}),
            snap_meta.get("snapshot_taken_at"),
        )
        if delta:
            user_message = f"{delta}\n（以下是使用者問題）\n{body.message}"

    # B15-A1.1: inject deferred snapshot context into user_message when ready.
    # original_message (= body.message) is what gets persisted, so this prefix
    # is LLM-only and does not bloat ai_messages history rows.
    user_message = _maybe_inject_deferred_into_user_message(
        user_message, session.snapshot_metadata
    )
    prefetch_context, prefetch_meta = await build_question_prefetch_with_metadata(
        db,
        patient_id,
        body.message,
        user=current_user,
        ip=request.client.host if request.client else None,
    )
    user_message = _maybe_inject_question_prefetch_into_user_message(
        user_message, prefetch_context
    )

    # M1: structured prefetch metric so prod can answer "is the keyword-based
    # prefetch missing user questions?" without scraping LLM replies. PII-safe
    # — log only categories that fired, message length, advice-ref count;
    # never the message text itself. Pair with the [CHAT][PREFETCH][MISS_LIKELY]
    # signal emitted by _event_stream after the LLM reply is complete to
    # answer the F4 trigger question (see docs/ai-chat-tool-loop-decision-2026-05-03.md §5).
    prefetch_categories = list(prefetch_meta.get("prefetchCategories") or [])
    prefetch_fired = bool(prefetch_categories)
    advice_ref_count = len(prefetch_meta.get("adviceRefs") or [])
    logger.info(
        "[CHAT][PREFETCH] session=%s patient=%s msg_chars=%d categories=%s "
        "advice_refs=%d fired=%s",
        session.id,
        patient_id or "-",
        len(body.message),
        ",".join(prefetch_categories) or "none",
        advice_ref_count,
        prefetch_fired,
    )

    # ── Load recent history ────────────────────────────────────────────────
    messages = await _load_messages(db, session.id, window=_CONTEXT_WINDOW * 2)
    history = _messages_to_api_format(messages)

    # ── Update session patient_id if not set ──────────────────────────────
    if patient_id and not session.patient_id:
        session.patient_id = patient_id
        await db.flush()

    # W3-T8: auto-generate session title from the first user message so
    # the sidebar shows real text immediately (no race against the frontend
    # PATCH that previously left "新對話" if the user refreshed too fast).
    if session.title is None:
        session.title = body.message[:50]

    # W1-T3: persist the clean user message BEFORE the SSE generator starts.
    # If the client disconnects mid-stream, the user's question is still in
    # ai_messages so it shows up on session reload. The assistant reply is
    # persisted by _event_stream only when generation actually completes.
    user_msg_id = f"msg_{uuid.uuid4().hex[:16]}"
    db.add(AIMessage(
        id=user_msg_id,
        session_id=session.id,
        role="user",
        content=body.message,
    ))
    await db.commit()

    timings = {"t0": t0, "t_session": t_session, "t_snapshot": t_snapshot}
    return StreamingResponse(
        _event_stream(
            user_message,
            system_prompt,
            history,
            session.id,
            db,
            request,
            timings=timings,
            prefetch_meta=prefetch_meta,
            prefetch_fired=prefetch_fired,
            had_patient_context=bool(patient_id),
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _session_to_dict(s: AISession, message_count: int = 0) -> dict:
    # F2: expose snapshot_taken_at so the frontend can compute "snapshot age"
    # and decide whether to highlight the refresh-snapshot button.
    snapshot_taken_at = None
    if s.snapshot_metadata and isinstance(s.snapshot_metadata, dict):
        snapshot_taken_at = s.snapshot_metadata.get("snapshot_taken_at")
    return {
        "id": s.id,
        "userId": s.user_id,
        "patientId": s.patient_id,
        "title": s.title or "新對話",
        "createdAt": s.created_at.isoformat() if s.created_at else None,
        "updatedAt": s.updated_at.isoformat() if s.updated_at else None,
        "messageCount": message_count,
        "snapshotTakenAt": snapshot_taken_at,
    }


def _message_to_dict(m: AIMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "timestamp": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/sessions")
async def list_sessions(
    patientId: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List AI chat sessions for the current user (matches ChatSessionsResponse schema)."""
    query = select(AISession).where(AISession.user_id == current_user.id)
    if patientId:
        if patientId == "none":
            query = query.where(AISession.patient_id.is_(None))
        else:
            query = query.where(AISession.patient_id == patientId)

    # Count total
    from sqlalchemy import func as sqlfunc
    count_result = await db.execute(
        select(sqlfunc.count()).select_from(
            query.subquery()
        )
    )
    total = count_result.scalar_one() or 0

    # Paginated results
    query = query.order_by(desc(AISession.updated_at)).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    sessions = result.scalars().all()

    # Get message counts
    session_ids = [s.id for s in sessions]
    counts: dict = {}
    if session_ids:
        count_rows = await db.execute(
            select(AIMessage.session_id, sqlfunc.count(AIMessage.id))
            .where(AIMessage.session_id.in_(session_ids))
            .group_by(AIMessage.session_id)
        )
        counts = {row[0]: row[1] for row in count_rows.all()}

    return {
        "success": True,
        "data": {
            "sessions": [_session_to_dict(s, counts.get(s.id, 0)) for s in sessions],
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": max(1, (total + limit - 1) // limit),
            },
        },
    }


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a session with its messages."""
    session_result = await db.execute(
        select(AISession).where(
            AISession.id == session_id,
            AISession.user_id == current_user.id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    msgs_result = await db.execute(
        select(AIMessage)
        .where(AIMessage.session_id == session_id)
        .order_by(AIMessage.created_at)
    )
    messages = msgs_result.scalars().all()
    return {
        "success": True,
        "data": {
            "session": _session_to_dict(session, len(messages)),
            "messages": [_message_to_dict(m) for m in messages],
        },
    }


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session."""
    session_result = await db.execute(
        select(AISession).where(
            AISession.id == session_id,
            AISession.user_id == current_user.id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
    return {"success": True, "data": None}


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: str,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update session title."""
    session_result = await db.execute(
        select(AISession).where(
            AISession.id == session_id,
            AISession.user_id == current_user.id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if "title" in body:
        session.title = body["title"]
    await db.commit()
    await db.refresh(session)
    return {"success": True, "data": _session_to_dict(session)}


@router.post("/chat/sessions/{session_id}/refresh-snapshot")
async def refresh_session_snapshot(
    session_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """F2: rebuild a session's clinical snapshot on demand.

    The first-turn snapshot is normally good for the session, but when a
    chat runs for >30min the LLM may be reasoning off stale vent/lab/score
    data. This endpoint re-runs build_critical_snapshot synchronously and
    fires a new background deferred fill, so the next turn sees fresh data.

    Auth: must own the session AND clear assert_patient_chat_access for
    the session's patient (same gate as chat_stream).
    """
    session_result = await db.execute(
        select(AISession).where(
            AISession.id == session_id,
            AISession.user_id == current_user.id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.patient_id:
        raise HTTPException(
            status_code=400,
            detail="Session has no patient — nothing to refresh",
        )

    await assert_patient_chat_access(
        db,
        current_user,
        session.patient_id,
        ip=request.client.host if request.client else None,
    )

    patient_id = session.patient_id
    if settings.SNAPSHOT_DEFERRED_ENABLED:
        critical, key_vals, deferred_meta = await build_critical_snapshot(
            patient_id, db
        )
        new_meta = {
            "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_key_values": key_vals,
            "clinical_snapshot": critical,
            "deferred_status": "pending",
            "deferred_intubated": deferred_meta.get("intubated", False),
        }
        session.snapshot_metadata = new_meta
        await db.commit()
        # Fire-and-forget background fill (own AsyncSession, never blocks).
        asyncio.create_task(
            _fill_deferred_snapshot_bg(
                session.id,
                patient_id,
                deferred_meta.get("intubated", False),
            )
        )
    else:
        snapshot, (lab, meds) = await asyncio.gather(
            build_clinical_snapshot(patient_id, db),
            asyncio.gather(
                _get_latest_lab(db, patient_id),
                _get_active_medications(db, patient_id),
            ),
        )
        key_vals = extract_snapshot_key_values(lab, meds)
        new_meta = {
            "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_key_values": key_vals,
            "clinical_snapshot": snapshot,
        }
        session.snapshot_metadata = new_meta
        await db.commit()

    logger.info(
        "[CHAT][REFRESH_SNAPSHOT] session=%s patient=%s user=%s",
        session.id, patient_id, current_user.id,
    )

    return {
        "success": True,
        "data": {
            "sessionId": session.id,
            "patientId": patient_id,
            "snapshotTakenAt": new_meta["snapshot_taken_at"],
            "deferredStatus": new_meta.get("deferred_status", "n/a"),
        },
    }


@router.patch("/chat/messages/{message_id}/feedback")
async def update_message_feedback(
    message_id: str,
    body: MessageFeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Set thumbs-up/thumbs-down feedback on an assistant message.

    Body: `{"feedback": "up" | "down" | null}`
    - Only assistant messages can receive feedback.
    - Message must belong to a session owned by the current user (otherwise 404,
      to avoid leaking existence of other users' messages).
    """
    if body.feedback not in (None, "up", "down"):
        raise HTTPException(
            status_code=400,
            detail="feedback must be 'up', 'down', or null",
        )

    result = await db.execute(
        select(AIMessage)
        .join(AISession, AIMessage.session_id == AISession.id)
        .where(
            AIMessage.id == message_id,
            AISession.user_id == current_user.id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    if message.role != "assistant":
        raise HTTPException(
            status_code=400,
            detail="Only assistant messages can receive feedback",
        )

    message.feedback = body.feedback
    await db.commit()
    await db.refresh(message)

    return {
        "success": True,
        "data": {
            "id": message.id,
            "feedback": message.feedback,
        },
    }
