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

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.llm import call_llm_stream, TASK_PROMPTS
from app.middleware.auth import get_current_user
from app.models.ai_session import AISession, AIMessage
from app.models.user import User
from app.services.patient_context_builder import (
    build_clinical_snapshot,
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
    original_message: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Generate SSE events from the LLM stream and persist the reply.

    user_message: may include delta prefix for the LLM
    original_message: the clean user message to store in DB history

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
                    token_count = (
                        meta.get("usage", {}).get("completion_tokens")
                        or meta.get("usage", {}).get("output_tokens")
                        or 0
                    )
                except Exception:
                    pass
                break
            elif chunk.startswith("[ERROR]"):
                error_msg = chunk[7:].strip() if len(chunk) > 7 else "AI service error"
                yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"
                return
            else:
                full_reply += chunk
                yield f"event: delta\ndata: {json.dumps({'chunk': chunk})}\n\n"

    except Exception as e:
        logger.error("[AI_CHAT] Stream error: %s", str(e)[:500])
        yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
        return

    # Persist user message + assistant reply (store clean message, not delta-augmented)
    stored_user_message = original_message or user_message
    assistant_msg_id = f"msg_{uuid.uuid4().hex[:16]}"
    if full_reply:
        user_msg = AIMessage(
            id=f"msg_{uuid.uuid4().hex[:16]}",
            session_id=session_id,
            role="user",
            content=stored_user_message,
        )
        assistant_msg = AIMessage(
            id=assistant_msg_id,
            session_id=session_id,
            role="assistant",
            content=full_reply,
            token_count=token_count or None,
        )
        db.add(user_msg)
        db.add(assistant_msg)
        try:
            await db.commit()
        except Exception as e:
            logger.warning("[AI_CHAT] Failed to persist messages: %s", str(e))
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
    session = await _get_or_create_session(
        db, current_user.id, body.patient_id, body.session_id
    )

    patient_id = body.patient_id or session.patient_id
    is_first_turn = session.snapshot_metadata is None

    # ── Build system prompt ────────────────────────────────────────────────
    if patient_id and is_first_turn:
        # First turn: build full snapshot and store only the snapshot text.
        # We do NOT store the full system_prompt so that prompt updates in
        # TASK_PROMPTS["icu_chat"] take effect immediately for all sessions.
        snapshot = await build_clinical_snapshot(patient_id, db)

        lab, meds = await _get_latest_lab(db, patient_id), await _get_active_medications(db, patient_id)
        key_vals = extract_snapshot_key_values(lab, meds)
        session.snapshot_metadata = {
            "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_key_values": key_vals,
            "clinical_snapshot": snapshot,  # store snapshot text, not the full prompt
        }
        await db.flush()

    if session.snapshot_metadata and session.snapshot_metadata.get("clinical_snapshot"):
        # Always rebuild from current TASK_PROMPTS so prompt updates apply immediately
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

    # ── Load recent history ────────────────────────────────────────────────
    messages = await _load_messages(db, session.id, window=_CONTEXT_WINDOW * 2)
    history = _messages_to_api_format(messages)

    # ── Update session patient_id if not set ──────────────────────────────
    if patient_id and not session.patient_id:
        session.patient_id = patient_id
        await db.flush()

    return StreamingResponse(
        _event_stream(user_message, system_prompt, history, session.id, db, request, original_message=body.message),
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
