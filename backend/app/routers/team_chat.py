import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.audit import create_audit_log
from app.models.chat_message import TeamChatMessage
from app.models.user import User
from app.schemas.message import TeamChatCreate
from app.utils.response import success_response

router = APIRouter(prefix="/team/chat", tags=["team-chat"])


def chat_to_dict(msg: TeamChatMessage) -> dict:
    return {
        "id": msg.id,
        "userId": msg.user_id,
        "userName": msg.user_name,
        "userRole": msg.user_role,
        "content": msg.content,
        "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
        "pinned": msg.pinned,
        "pinnedBy": msg.pinned_by,
        "pinnedAt": msg.pinned_at.isoformat() if msg.pinned_at else None,
    }


@router.get("")
async def list_team_chat(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TeamChatMessage)
        .order_by(TeamChatMessage.timestamp.desc())
        .limit(limit)
    )
    messages = result.scalars().all()

    return success_response(data={
        "messages": [chat_to_dict(m) for m in reversed(messages)],
    })


@router.post("")
async def send_team_chat(
    request: Request,
    body: TeamChatCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = TeamChatMessage(
        id=f"tchat_{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        user_name=user.name,
        user_role=user.role,
        content=body.content,
        timestamp=datetime.now(timezone.utc),
        pinned=body.pinned,
    )

    if body.pinned:
        msg.pinned_by = {"userId": user.id, "userName": user.name}
        msg.pinned_at = datetime.now(timezone.utc)

    db.add(msg)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="發送團隊訊息", target=msg.id, status="success",
        ip=request.client.host if request.client else None,
    )
    await db.flush()

    return success_response(data=chat_to_dict(msg), message="訊息已發送")


@router.patch("/{message_id}/pin")
async def toggle_pin_message(
    message_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TeamChatMessage).where(TeamChatMessage.id == message_id)
    )
    msg = result.scalar_one_or_none()

    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    msg.pinned = not msg.pinned
    if msg.pinned:
        msg.pinned_by = {"userId": user.id, "userName": user.name}
        msg.pinned_at = datetime.now(timezone.utc)
    else:
        msg.pinned_by = None
        msg.pinned_at = None

    action_text = "置頂訊息" if msg.pinned else "取消置頂"
    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action=action_text, target=message_id, status="success",
        ip=request.client.host if request.client else None,
    )

    action = "已置頂" if msg.pinned else "已取消置頂"
    return success_response(data=chat_to_dict(msg), message=f"訊息{action}")
