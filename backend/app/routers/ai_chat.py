"""
ai_chat.py — ICU Chat Assistant endpoint (new clean-chain architecture).

Flow:
  1. Get or create AISession
  2. First turn → build_clinical_snapshot() → embed in system prompt
     Subsequent turns → build_delta() if snapshot is > 30 min old
  3. Load last N message pairs (context compression window)
  4. Stream LLM response via SSE
  5. Persist assistant reply + update session

This router stays a THIN transport/orchestration layer. The heavy lifting
lives in ``app.services.ai_chat``:
  - sse                 — heartbeat wrapper + web-citation mapping
  - prompt_assembly     — CACHE-SENSITIVE prompt / user-message assembly
  - snapshot_lifecycle  — snapshot build/refresh + background deferred fill
  - observability       — hedging / citation-audit / assertion-conflict glue

Several symbols are intentionally re-exported at module scope below so that
existing ``from app.routers.ai_chat import ...`` consumers and
``monkeypatch.setattr("app.routers.ai_chat.<name>", ...)`` test sites keep
working unchanged.
"""

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.llm import call_llm_stream, TASK_PROMPTS
from app.middleware.audit import create_audit_log, diff_dict, snapshot_fields
from app.middleware.auth import get_current_user
from app.models.ai_session import AISession, AIMessage
from app.models.user import User
from app.services.ai_question_prefetch import build_question_prefetch_with_metadata
from app.services.patient_acl import assert_patient_chat_access
from app.services.patient_context_builder import (
    build_clinical_snapshot,
    build_critical_snapshot,
    build_delta,
    build_med_change_delta,
    extract_snapshot_key_values,
    _get_latest_lab,
    _get_active_medications,
)
from app.utils.request import get_client_ip
from app.utils.response import success_response
from app.utils.sse import format_sse, done_frame, SSE_HEADERS, SSE_MEDIA_TYPE

# ── Re-exports (keep original import / monkeypatch paths working) ───────────────
from app.services.ai_chat.prompt_assembly import (  # noqa: F401
    _build_system_prompt,
    _maybe_inject_deferred_into_user_message,
    _maybe_inject_question_prefetch_into_user_message,
    _maybe_inject_assertion_conflict_into_user_message,
)
from app.services.ai_chat.sse import (  # noqa: F401
    _with_heartbeat,
    _web_annotations_to_citations,
    split_main_and_detail,
)
from app.services.ai_chat.snapshot_lifecycle import (  # noqa: F401
    _fill_deferred_snapshot_bg,
    build_session_snapshot_meta,
)
from app.services.ai_chat.observability import (  # noqa: F401
    _HEDGING_PATTERNS,
    _reply_looks_hedged,
    log_hedging_signal,
    run_citation_audit,
    detect_and_inject_assertion_conflict,
)

logger = logging.getLogger("chaticu")

router = APIRouter(prefix="/ai", tags=["AI Chat"])

# Keep last N conversation pairs in the context window
_CONTEXT_WINDOW = 10

# Upper bound on a single user message. Bumped from 4000 → 8000 (2026-05-13)
# after users hit HTTP 422 when pasting ~4200-char clinical drafts. The
# frontend mirrors this in its char-counter + textarea maxLength; this check
# is the server-side belt-and-suspenders for non-browser callers.
_MAX_MESSAGE_LENGTH = 8000


# ── Request / Response schemas ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # max_length kept loose here so we can return a friendly Chinese error
    # from the endpoint rather than the generic Pydantic "string_too_long".
    message: str = Field(..., min_length=1)
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
) -> Tuple[AISession, bool]:
    """Return (session, was_created). was_created lets the caller audit
    session creation as a coarse-grained event (per-stream messages are
    intentionally NOT audited — too noisy)."""
    if session_id:
        result = await db.execute(
            select(AISession).where(
                AISession.id == session_id,
                AISession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()
        if session:
            return session, False

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
    return new_session, True


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


def _messages_to_api_format(messages: List[AIMessage]) -> List[dict]:
    return [{"role": m.role, "content": m.content} for m in messages]


# ── SSE event stream ──────────────────────────────────────────────────────────

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
    current_user: Optional[User] = None,
    patient_id: Optional[str] = None,
    active_med_aliases: Optional[List[str]] = None,
    original_message: Optional[str] = None,
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
    web_annotations: list[dict] = []

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
                    import json
                    meta = json.loads(chunk)
                    usage = meta.get("usage", {}) or {}
                    token_count = (
                        usage.get("completion_tokens")
                        or usage.get("output_tokens")
                        or 0
                    )
                    prompt_tokens = usage.get("prompt_tokens") or 0
                    cached_tokens = usage.get("cached_tokens") or 0
                    web_annotations = meta.get("annotations") or []
                except Exception:
                    pass
                break
            elif chunk.startswith("[ERROR]"):
                error_msg = chunk[7:].strip() if len(chunk) > 7 else "AI service error"
                yield format_sse({"message": error_msg}, event="error")
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
                yield format_sse({"chunk": chunk}, event="delta")

    except Exception as e:
        logger.error("[AI_CHAT] Stream error: %s", str(e)[:500])
        yield format_sse({"message": str(e)}, event="error")
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
        # _merged_snapshot incident referenced in prompt_assembly where canary
        # dropped 70% → 0%). Threshold is conservative — adjust if it's noisy.
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

    # Sycophancy step — post-stream citation audit (read-only, never blocks).
    await run_citation_audit(
        db,
        request,
        full_reply=full_reply,
        current_user=current_user,
        active_med_aliases=active_med_aliases or [],
        session_id=session_id,
        patient_id=patient_id,
    )

    # M1: F4 trigger signal — hedged reply + patient context + no prefetch.
    log_hedging_signal(
        full_reply,
        had_patient_context=had_patient_context,
        prefetch_fired=prefetch_fired,
        session_id=session_id,
        user_question=original_message,
    )

    # Send done event — frontend expects ChatResponse shape:
    # { message: ChatMessage, sessionId: string, prefetchRefs?: {...} }
    # F3: prefetchRefs surfaces deep-link metadata (currently advice records)
    # so the chat UI can render clickable chips below the assistant bubble.
    # Live-only — not persisted to ai_messages, so the chips disappear on
    # page reload. Persistence is a future enhancement (would need either
    # a new JSONB column or co-opting suggested_actions).
    now_iso = datetime.now(timezone.utc).isoformat()
    # B14: split at 【說明/補充】 so the frontend detail panel gets a real
    # `explanation`. The persisted AIMessage keeps the FULL text — session
    # reload re-splits client-side (splitMainAndDetail in src/lib/api/ai.ts),
    # and LLM history continuity needs the unsplit blob anyway.
    main_content, detail = split_main_and_detail(full_reply)
    done_payload = {
        "message": {
            "id": assistant_msg_id,
            "role": "assistant",
            "content": main_content,
            "timestamp": now_iso,
            "explanation": detail,
            "citations": _web_annotations_to_citations(web_annotations, full_reply),
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
    yield done_frame(done_payload)


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
    # Length gate — see _MAX_MESSAGE_LENGTH note. Friendly Chinese reply
    # via the global HTTPException handler in main.py (returns
    # {success: false, message: "..."} which the frontend renders verbatim).
    msg_len = len(body.message)
    if msg_len > _MAX_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=(
                f"訊息過長：目前 {msg_len} 字,上限 {_MAX_MESSAGE_LENGTH} 字。"
                "請縮短內容或拆成多次提問。"
            ),
        )
    # W1-T1 ACL: verify patient exists + role gate + audit log.
    # No-op when body.patient_id is None (general chat).
    await assert_patient_chat_access(
        db,
        current_user,
        body.patient_id,
        ip=get_client_ip(request),
    )
    session, session_was_created = await _get_or_create_session(
        db, current_user.id, body.patient_id, body.session_id
    )
    t_session = time.perf_counter()

    # Audit session creation (coarse-grained — per-message audit intentionally
    # skipped to keep audit_logs from being flooded by chat traffic).
    if session_was_created:
        await create_audit_log(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            role=current_user.role,
            action="建立 AI 對話 session",
            target=session.id,
            ip=get_client_ip(request),
            details={
                "session_id": session.id,
                "patient_id": body.patient_id,
            },
        )

    patient_id = body.patient_id or session.patient_id
    is_first_turn = session.snapshot_metadata is None

    # ── Build system prompt ────────────────────────────────────────────────
    if patient_id and is_first_turn:
        # First turn: build snapshot and store only the snapshot text.
        # We do NOT store the full system_prompt so that prompt updates in
        # TASK_PROMPTS["icu_chat"] take effect immediately for all sessions.
        #
        # Builder callables are passed explicitly (resolved from THIS module's
        # globals at call time) so tests that monkeypatch
        # app.routers.ai_chat.build_critical_snapshot stay effective.
        new_meta, intubated = await build_session_snapshot_meta(
            patient_id,
            db,
            deferred_enabled=settings.SNAPSHOT_DEFERRED_ENABLED,
            critical_builder=build_critical_snapshot,
            clinical_builder=build_clinical_snapshot,
            latest_lab_getter=_get_latest_lab,
            active_meds_getter=_get_active_medications,
            key_values_extractor=extract_snapshot_key_values,
        )
        session.snapshot_metadata = new_meta
        await db.flush()
        if settings.SNAPSHOT_DEFERRED_ENABLED:
            # Fire-and-forget. Uses its own AsyncSession (the request one is
            # closed shortly after this handler returns). Failures are logged
            # but never break the chat reply.
            asyncio.create_task(
                _fill_deferred_snapshot_bg(
                    session.id,
                    patient_id,
                    intubated or False,
                )
            )
    t_snapshot = time.perf_counter()

    if session.snapshot_metadata and session.snapshot_metadata.get("clinical_snapshot"):
        # Always rebuild from current TASK_PROMPTS so prompt updates apply immediately.
        # B15-A1.1: read clinical_snapshot directly (critical-only when
        # SNAPSHOT_DEFERRED_ENABLED is on, full when off). The deferred
        # follow-up is NEVER merged into system_prompt — it would mutate
        # the byte-stable prefix and bust OpenAI prompt cache (the prior
        # _merged_snapshot path dropped cache_hit_ratio_p50 from 70% to 0%
        # in canary, see docs/his-sync/b15-snapshot-latency-plan-2026-04-30.md).
        # Deferred is instead injected into the ephemeral user_message
        # below via _maybe_inject_deferred_into_user_message.
        system_prompt = _build_system_prompt(session.snapshot_metadata["clinical_snapshot"])
    elif session.snapshot_metadata and session.snapshot_metadata.get("system_prompt"):
        # Backward compat: old sessions that stored full system_prompt
        system_prompt = _build_system_prompt(
            session.snapshot_metadata["system_prompt"].split("[目前病患資料]")[-1].strip()
            if "[目前病患資料]" in session.snapshot_metadata.get("system_prompt", "")
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
        ip=get_client_ip(request),
    )
    user_message = _maybe_inject_question_prefetch_into_user_message(
        user_message, prefetch_context
    )

    # Step 2: user-assertion vs snapshot conflict detection + reuse of the
    # active-med fetch to build active_med_aliases for the post-stream
    # citation audit. Only fetch the active-med list when patient_id is set.
    active_med_aliases: List[str] = []
    if patient_id:
        # Defensive: a meds-fetch failure must never block a reply. On error
        # active_med_aliases stays empty and conflict detection is skipped,
        # matching the original single-try-block behavior.
        try:
            conflict_meds = await _get_active_medications(db, patient_id)
            for m in conflict_meds:
                if m and m.name:
                    active_med_aliases.append(m.name)
                if m and getattr(m, "generic_name", None):
                    active_med_aliases.append(m.generic_name)
            # llm-1: the system prompt's [用藥] list is frozen at session start
            # (and build_delta only diffs numeric labs). Surface any drug started
            # or stopped since the snapshot so the LLM never reasons over a stale
            # med list — ephemeral, injected into user_message only.
            if session.snapshot_metadata:
                med_change = build_med_change_delta(
                    session.snapshot_metadata.get("snapshot_key_values", {}),
                    conflict_meds,
                )
                if med_change:
                    user_message = f"{med_change}\n{user_message}"
            user_message = await detect_and_inject_assertion_conflict(
                db,
                request,
                user_message=user_message,
                original_message=body.message,
                active_meds=conflict_meds,
                current_user=current_user,
                session_id=session.id,
                patient_id=patient_id,
            )
        except Exception as exc:  # pragma: no cover — defensive: never block a reply
            logger.warning(
                "[CHAT][CONFLICT] detection failed session=%s patient=%s: %s",
                session.id,
                patient_id,
                exc,
            )

    # M1: structured prefetch metric so prod can answer "is the keyword-based
    # prefetch missing user questions?" without scraping LLM replies. PII-safe
    # — log only categories that fired, message length, advice-ref count;
    # never the message text itself. Pair with the [CHAT][PREFETCH][MISS_LIKELY]
    # signal emitted by _event_stream after the LLM reply is complete to
    # answer the F4 trigger question (see docs/ai-chat/ai-chat-tool-loop-decision-2026-05-03.md §5).
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
            current_user=current_user,
            patient_id=patient_id,
            active_med_aliases=active_med_aliases,
            original_message=body.message,
        ),
        media_type=SSE_MEDIA_TYPE,
        headers=SSE_HEADERS,
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

    return success_response(data={
        "sessions": [_session_to_dict(s, counts.get(s.id, 0)) for s in sessions],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": max(1, (total + limit - 1) // limit),
        },
    })


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

    # Step 3 (sycophancy mitigation): expose the snapshot the LLM saw so the
    # frontend can show an "AI 看到什麼" panel next to the chat. Only included
    # on the single-session GET (never the paginated list) so we don't bloat
    # /sessions list responses by ~1.5KB per row. Frontend renders the text
    # as preformatted markdown for now; structured extraction can come later.
    snapshot_view = None
    if session.snapshot_metadata and isinstance(session.snapshot_metadata, dict):
        snap_meta = session.snapshot_metadata
        snapshot_view = {
            "snapshotText": snap_meta.get("clinical_snapshot") or "",
            "snapshotTakenAt": snap_meta.get("snapshot_taken_at"),
            "deferredStatus": snap_meta.get("deferred_status"),
            "deferredText": snap_meta.get("clinical_snapshot_deferred") or "",
        }

    return success_response(data={
        "session": _session_to_dict(session, len(messages)),
        "messages": [_message_to_dict(m) for m in messages],
        "snapshot": snapshot_view,
    })


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    request: Request,
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

    # Snapshot details before delete so audit log captures what was destroyed.
    msg_count = (await db.execute(
        select(func.count()).select_from(AIMessage).where(AIMessage.session_id == session_id)
    )).scalar() or 0
    audit_details = {
        "session_id": session.id,
        "patient_id": session.patient_id,
        "title": session.title,
        "message_count": msg_count,
    }

    await db.delete(session)
    await db.flush()

    await create_audit_log(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        role=current_user.role,
        action="刪除 AI 對話 session",
        target=session_id,
        ip=get_client_ip(request),
        details=audit_details,
    )

    await db.commit()
    # Explicit None payload preserved (success_response omits a None `data`).
    return {"success": True, "data": None}


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: str,
    body: dict,
    request: Request,
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

    before_state = snapshot_fields(session, ["title"])
    if "title" in body:
        session.title = body["title"]
    after_state = snapshot_fields(session, ["title"])
    audit_details = diff_dict(before_state, after_state)
    audit_details["session_id"] = session_id

    await db.flush()
    # Only audit if something actually changed (title rename is the only
    # supported field today — guard against no-op PATCH).
    if audit_details["fields_changed"]:
        await create_audit_log(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            role=current_user.role,
            action="更新 AI 對話 session",
            target=session_id,
            ip=get_client_ip(request),
            details=audit_details,
        )

    await db.commit()
    await db.refresh(session)
    return success_response(data=_session_to_dict(session))


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
        ip=get_client_ip(request),
    )

    patient_id = session.patient_id
    # Builder callables passed explicitly so monkeypatches on
    # app.routers.ai_chat.build_critical_snapshot stay effective.
    new_meta, intubated = await build_session_snapshot_meta(
        patient_id,
        db,
        deferred_enabled=settings.SNAPSHOT_DEFERRED_ENABLED,
        critical_builder=build_critical_snapshot,
        clinical_builder=build_clinical_snapshot,
        latest_lab_getter=_get_latest_lab,
        active_meds_getter=_get_active_medications,
        key_values_extractor=extract_snapshot_key_values,
    )
    session.snapshot_metadata = new_meta
    await db.commit()
    if settings.SNAPSHOT_DEFERRED_ENABLED:
        # Fire-and-forget background fill (own AsyncSession, never blocks).
        asyncio.create_task(
            _fill_deferred_snapshot_bg(
                session.id,
                patient_id,
                intubated or False,
            )
        )

    logger.info(
        "[CHAT][REFRESH_SNAPSHOT] session=%s patient=%s user=%s",
        session.id, patient_id, current_user.id,
    )

    return success_response(data={
        "sessionId": session.id,
        "patientId": patient_id,
        "snapshotTakenAt": new_meta["snapshot_taken_at"],
        "deferredStatus": new_meta.get("deferred_status", "n/a"),
    })


@router.patch("/chat/messages/{message_id}/feedback")
async def update_message_feedback(
    message_id: str,
    body: MessageFeedbackRequest,
    request: Request,
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

    previous_feedback = message.feedback
    message.feedback = body.feedback
    await db.flush()

    # Feedback is low-volume critical signal — keep per-event audit.
    if previous_feedback != body.feedback:
        await create_audit_log(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            role=current_user.role,
            action="AI 訊息反饋",
            target=message_id,
            ip=get_client_ip(request),
            details={
                "message_id": message_id,
                "session_id": message.session_id,
                "previous_feedback": previous_feedback,
                "feedback": body.feedback,
            },
        )

    await db.commit()
    await db.refresh(message)

    return success_response(data={
        "id": message.id,
        "feedback": message.feedback,
    })
