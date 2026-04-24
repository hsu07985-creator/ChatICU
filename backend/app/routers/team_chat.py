import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.chat_message import TeamChatMessage
from app.models.user import User
from app.schemas.message import TeamChatCreate
from app.utils.response import success_response

router = APIRouter(prefix="/team/chat", tags=["team-chat"])
users_router = APIRouter(prefix="/team/users", tags=["team-users"])


@users_router.get("")
async def list_team_users(
    user: User = Depends(get_current_user),  # noqa: ARG001 — auth gate
    db: AsyncSession = Depends(get_db),
):
    """Minimal user list for @-mention autocomplete in team chat.

    Returns only id/name/role (no PII beyond what teammates already see in
    chat headers). Authenticated users only.
    """
    result = await db.execute(
        select(User.id, User.name, User.role).where(User.active == True)  # noqa: E712
    )
    rows = result.all()
    return success_response(data={
        "users": [
            {"id": r.id, "name": r.name, "role": r.role}
            for r in rows
        ]
    })


def chat_to_dict(msg: TeamChatMessage, replies: Optional[List[dict]] = None) -> dict:
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
        "replyToId": msg.reply_to_id,
        "isRead": msg.is_read or False,
        "readBy": msg.read_by or [],
        "mentionedRoles": msg.mentioned_roles or [],
        "mentionedUserIds": msg.mentioned_user_ids or [],
        "replyCount": len(replies) if replies is not None else 0,
        "replies": replies if replies is not None else [],
    }


@router.get("/mentions/count")
async def mentions_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Count unread messages that @ the current user (by role OR user_id)."""
    role_match = and_(
        TeamChatMessage.mentioned_roles.isnot(None),
        cast(TeamChatMessage.mentioned_roles, String).contains(f'"{user.role}"'),
    )
    user_match = and_(
        TeamChatMessage.mentioned_user_ids.isnot(None),
        cast(TeamChatMessage.mentioned_user_ids, String).contains(f'"{user.id}"'),
    )
    result = await db.execute(
        select(func.count(TeamChatMessage.id)).where(
            and_(
                TeamChatMessage.is_read == False,  # noqa: E712
                or_(role_match, user_match),
            )
        )
    )
    count = result.scalar() or 0

    return success_response(data={"count": count})


@router.get("")
async def list_team_chat(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Only count top-level messages (no reply_to_id)
    total_result = await db.execute(
        select(func.count(TeamChatMessage.id)).where(
            TeamChatMessage.reply_to_id.is_(None)
        )
    )
    total = total_result.scalar() or 0

    # Fetch top-level messages
    result = await db.execute(
        select(TeamChatMessage)
        .where(TeamChatMessage.reply_to_id.is_(None))
        .order_by(TeamChatMessage.timestamp.asc(), TeamChatMessage.id.asc())
        .limit(limit)
    )
    top_messages = result.scalars().all()
    top_ids = [m.id for m in top_messages]

    # Fetch all replies for these parents
    replies_map: dict = {mid: [] for mid in top_ids}
    if top_ids:
        reply_result = await db.execute(
            select(TeamChatMessage)
            .where(TeamChatMessage.reply_to_id.in_(top_ids))
            .order_by(TeamChatMessage.timestamp.asc())
        )
        for r in reply_result.scalars().all():
            if r.reply_to_id in replies_map:
                replies_map[r.reply_to_id].append(chat_to_dict(r))

    messages = [
        chat_to_dict(m, replies=replies_map.get(m.id, []))
        for m in top_messages
    ]

    return success_response(data={
        "messages": messages,
        "total": total,
    })


@router.post("")
async def send_team_chat(
    request: Request,
    body: TeamChatCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    reply_to_id = body.replyToId

    # Validate and flatten reply chain
    if reply_to_id:
        parent_result = await db.execute(
            select(TeamChatMessage).where(TeamChatMessage.id == reply_to_id)
        )
        parent = parent_result.scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent message not found")
        # Flatten: if parent is itself a reply, use its parent (root)
        if parent.reply_to_id:
            reply_to_id = parent.reply_to_id

    msg = TeamChatMessage(
        id=f"tchat_{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        user_name=user.name,
        user_role=user.role,
        content=body.content,
        timestamp=datetime.now(timezone.utc),
        pinned=body.pinned,
        reply_to_id=reply_to_id,
        is_read=False,
        read_by=[],
        mentioned_roles=body.mentionedRoles or [],
        mentioned_user_ids=body.mentionedUserIds or [],
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
    await db.commit()

    return success_response(data=chat_to_dict(msg), message="訊息已發送")


@router.patch("/{message_id}/read")
async def mark_read(
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

    read_by = list(msg.read_by or [])
    # Avoid duplicate entries
    if not any(entry.get("userId") == user.id for entry in read_by):
        read_by.append({
            "userId": user.id,
            "userName": user.name,
            "readAt": datetime.now(timezone.utc).isoformat(),
        })

    msg.is_read = True
    msg.read_by = read_by
    await db.commit()
    await db.refresh(msg)

    return success_response(data=chat_to_dict(msg), message="已標記已讀")


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

    await db.commit()

    action = "已置頂" if msg.pinned else "已取消置頂"
    return success_response(data=chat_to_dict(msg), message=f"訊息{action}")


@router.delete("/{message_id}")
async def delete_team_chat_message(
    message_id: str,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TeamChatMessage).where(TeamChatMessage.id == message_id)
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    await db.delete(msg)
    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="刪除團隊訊息", target=message_id, status="success",
        ip=request.client.host if request.client else None,
    )
    await db.commit()
    return success_response(message="訊息已刪除")
