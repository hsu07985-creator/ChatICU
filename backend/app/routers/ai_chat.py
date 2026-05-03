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


async def _fill_deferred_snapshot_bg(
    session_id: str, patient_id: str, intubated: bool
) -> None:
    """Fire-and-forget background task: fetch deferred snapshot sections
    (vent / reports / scores) and persist into AISession.snapshot_metadata.

    Runs on its own AsyncSession (the request session is already closed
    by the time this fires). Failures are non-fatal — chat keeps working
    with critical-only snapshot if this background fill never completes.
    """
    try:
        async with async_session() as bg_db:
            deferred_text = await build_deferred_snapshot(
                patient_id, bg_db, intubated=intubated
            )
            result = await bg_db.execute(
                select(AISession).where(AISession.id == session_id)
            )
            sess = result.scalar_one_or_none()
            if sess is None:
                logger.warning(
                    "[CHAT][DEFERRED] session=%s gone before deferred fill landed",
                    session_id,
                )
                return
            meta = dict(sess.snapshot_metadata or {})
            meta["clinical_snapshot_deferred"] = deferred_text
            meta["deferred_status"] = "ready" if deferred_text else "empty"
            meta["deferred_filled_at"] = datetime.now(timezone.utc).isoformat()
            sess.snapshot_metadata = meta
            await bg_db.commit()
            logger.info(
                "[CHAT][DEFERRED] session=%s deferred_chars=%d status=%s",
                session_id, len(deferred_text), meta["deferred_status"],
            )
    except Exception as exc:  # pragma: no cover - background fault tolerance
        logger.warning(
            "[CHAT][DEFERRED] background fill failed session=%s: %s",
            session_id, exc,
        )


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
        async for chunk in call_llm_stream(
            "icu_chat",
            messages,
            system_prompt_override=system_prompt,
            request_id=request_id,
            trace_id=trace_id,
        ):
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

    # Send done event — frontend expects ChatResponse shape:
    # { message: ChatMessage, sessionId: string }
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

    # ── Load recent history ────────────────────────────────────────────────
    messages = await _load_messages(db, session.id, window=_CONTEXT_WINDOW * 2)
    history = _messages_to_api_format(messages)

    # ── Update session patient_id if not set ──────────────────────────────
    if patient_id and not session.patient_id:
        session.patient_id = patient_id
        await db.flush()

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
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _session_to_dict(s: AISession, message_count: int = 0) -> dict:
    return {
        "id": s.id,
        "userId": s.user_id,
        "patientId": s.patient_id,
        "title": s.title or "新對話",
        "createdAt": s.created_at.isoformat() if s.created_at else None,
        "updatedAt": s.updated_at.isoformat() if s.updated_at else None,
        "messageCount": message_count,
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
