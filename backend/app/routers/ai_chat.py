"""AI Chat endpoints — database-backed, LLM-powered (Phase 3)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.llm import call_llm
from app.middleware.auth import get_current_user
from app.middleware.audit import create_audit_log
from app.models.ai_session import AIMessage, AISession
from app.models.user import User
from app.schemas.clinical import AIChatRequest
from app.services.llm_services.rag_service import rag_service
from app.services.safety_guardrail import apply_safety_guardrail
from app.utils.response import success_response

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/chat")
async def ai_chat(
    req: AIChatRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_id = req.sessionId or f"session_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)

    # Get or create session
    result = await db.execute(select(AISession).where(AISession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        session = AISession(
            id=session_id,
            user_id=user.id,
            patient_id=req.patientId,
            title=req.message[:50],
        )
        db.add(session)
        await db.flush()

    # Store user message
    user_msg_id = f"msg_{uuid.uuid4().hex[:8]}"
    user_msg = AIMessage(
        id=user_msg_id,
        session_id=session_id,
        role="user",
        content=req.message,
    )
    db.add(user_msg)

    # RAG-augmented LLM response
    citations = []
    rag_context = ""
    if rag_service.is_indexed:
        sources = rag_service.retrieve(req.message, top_k=3)
        rag_context = "\n\n---\n\n".join([s["text"] for s in sources])
        citations = [
            {
                "id": f"cite_{i}",
                "type": "guideline",
                "title": s["doc_id"].split("/")[-1] if "/" in s["doc_id"] else s["doc_id"],
                "source": s["category"],
                "relevance": round(s["score"], 3),
            }
            for i, s in enumerate(sources)
        ]

    llm_result = await asyncio.to_thread(
        call_llm,
        task="rag_generation",
        input_data={"question": req.message, "context": rag_context},
    )

    raw_content = llm_result.get("content", "Unable to generate response.")

    # Apply medical safety guardrail (T30)
    guardrail_result = apply_safety_guardrail(raw_content)
    ai_content = guardrail_result["content"]

    ai_msg_id = f"msg_{uuid.uuid4().hex[:8]}"
    ai_msg = AIMessage(
        id=ai_msg_id,
        session_id=session_id,
        role="assistant",
        content=ai_content,
        citations=citations or None,
    )
    db.add(ai_msg)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="AI 對話", target=session_id, status="success",
        ip=request.client.host if request.client else None,
        details={
            "patient_id": req.patientId,
            "message_length": len(req.message),
            "safety_flagged": guardrail_result["flagged"],
        },
    )
    await db.commit()

    return success_response(data={
        "message": {
            "id": ai_msg_id,
            "role": "assistant",
            "content": ai_content,
            "timestamp": now.isoformat() + "Z",
            "citations": citations,
            "safetyWarnings": guardrail_result["warnings"] if guardrail_result["flagged"] else None,
            "requiresExpertReview": guardrail_result.get("requiresExpertReview", False),
        },
        "sessionId": session_id,
    })


@router.get("/sessions")
async def list_sessions(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    patientId: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(AISession).where(AISession.user_id == user.id)
    count_query = select(func.count()).select_from(AISession).where(AISession.user_id == user.id)

    if patientId:
        query = query.where(AISession.patient_id == patientId)
        count_query = count_query.where(AISession.patient_id == patientId)

    total = (await db.execute(count_query)).scalar() or 0
    query = query.order_by(AISession.updated_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    sessions = result.scalars().all()

    return success_response(data={
        "sessions": [
            {
                "id": s.id,
                "userId": s.user_id,
                "patientId": s.patient_id,
                "title": s.title,
                "createdAt": s.created_at.isoformat() + "Z" if s.created_at else None,
                "updatedAt": s.updated_at.isoformat() + "Z" if s.updated_at else None,
            }
            for s in sessions
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit,
        },
    })


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AISession)
        .options(selectinload(AISession.messages))
        .where(AISession.id == session_id, AISession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return success_response(data={
        "session": {
            "id": session.id,
            "userId": session.user_id,
            "patientId": session.patient_id,
            "title": session.title,
            "createdAt": session.created_at.isoformat() + "Z" if session.created_at else None,
            "updatedAt": session.updated_at.isoformat() + "Z" if session.updated_at else None,
        },
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "timestamp": m.created_at.isoformat() + "Z" if m.created_at else None,
                "citations": m.citations,
                "suggestedActions": m.suggested_actions,
            }
            for m in sorted(session.messages, key=lambda x: x.created_at)
        ],
    })


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AISession).where(AISession.id == session_id, AISession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return success_response(message="Session deleted")


# ── T30: Expert Review Mechanism ──────────────────────────────────────
from app.middleware.auth import require_roles


@router.post("/messages/{message_id}/review")
async def review_ai_message(
    message_id: str,
    request: Request,
    user: User = Depends(require_roles("doctor", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """Mark an AI message as reviewed by a medical expert.
    Stores review metadata in the message's suggested_actions JSONB field
    and creates an audit log entry for compliance tracking."""
    result = await db.execute(select(AIMessage).where(AIMessage.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if msg.role != "assistant":
        raise HTTPException(status_code=400, detail="Only AI messages can be reviewed")

    # Store review metadata in JSONB field
    review_info = {
        "expertReview": {
            "reviewedBy": {"id": user.id, "name": user.name, "role": user.role},
            "reviewedAt": datetime.now(timezone.utc).isoformat() + "Z",
            "status": "reviewed",
        }
    }
    msg.suggested_actions = review_info

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="AI 輸出專家審閱", target=message_id, status="success",
        ip=request.client.host if request.client else None,
        details={"session_id": msg.session_id},
    )
    await db.commit()

    return success_response(data={
        "messageId": message_id,
        "review": review_info["expertReview"],
    }, message="AI 輸出已標記為專家審閱完成")
