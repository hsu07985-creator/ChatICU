import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.middleware.rate_limit import limiter
from app.models.chat_message import TeamChatMessage
from app.models.user import User
from app.routers.notifications import MENTION_LOOKBACK_HOURS
from app.schemas.message import TeamChatCreate
from app.utils.jsonb_compat import array_contains_user_receipt, array_contains_value, to_utc_aware
from app.utils.read_receipt import append_read_receipt
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
        "mentionsAll": bool(msg.mentions_all),
        "replyCount": len(replies) if replies is not None else 0,
        "replies": replies if replies is not None else [],
    }


@router.post("/visit")
async def mark_chat_visited(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bump the user's last visit timestamp.

    Used by the sidebar's per-user team-chat unread badge: messages with
    timestamp > user.last_chat_visit_at count as unread for this user.
    Called by the frontend when ChatPage mounts and on every successful
    message refresh while the page is open.

    We re-fetch the row through this session so the update is tracked
    regardless of whether `user` came from the request session or a
    detached/test instance.
    """
    now = datetime.now(timezone.utc)
    db_user = await db.get(User, user.id)
    if db_user is not None:
        db_user.last_chat_visit_at = now
        await db.commit()
    return success_response(data={"lastVisitAt": now.isoformat()})


@router.get("/unread-count")
async def get_chat_unread_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-user unread count for the team chat.

    A message is unread for me when timestamp > my last_chat_visit_at and
    I am not the author. First-time users (last_chat_visit_at IS NULL)
    return 0 — the badge appears once they've visited at least once.
    """
    db_user = await db.get(User, user.id)
    last_visit = db_user.last_chat_visit_at if db_user is not None else None
    if last_visit is None:
        return success_response(data={"count": 0})

    result = await db.execute(
        select(func.count(TeamChatMessage.id)).where(
            TeamChatMessage.timestamp > last_visit,
            TeamChatMessage.user_id != user.id,
        )
    )
    return success_response(data={"count": int(result.scalar() or 0)})


@router.get("/mentions/count")
async def mentions_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Count unread messages that @ the current user (by role OR user_id).

    Per-user model (TC-W3-T1):
    - "Unread for me" means I am not in the message's ``read_by`` array.
      The previous ``is_read == False`` filter was a global flag that any
      user could flip — so the first reader silently zeroed everyone
      else's mention badge. Now each recipient has their own state.
    - Visit baseline: messages older than my ``last_chat_visit_at`` are
      treated as already acknowledged. Migration 071 backfilled
      ``last_chat_visit_at = NOW()`` for every existing user, so the
      switchover does not retroactively flood old mentions into the
      badge ("舊資料視為已讀"). New users with NULL last_chat_visit_at
      see 0 mentions until their first chat visit (consistent with
      ``/unread-count`` behavior).
    - 168h hard cap retained so a user who never visits chat doesn't
      accumulate ancient mentions forever.

    Predicate uses dialect-aware JSONB ``@>`` (PG, GIN-indexable) with a
    SQLite test fallback via ``array_contains_user_receipt``.
    """
    dialect_name = db.bind.dialect.name
    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(db_user.last_chat_visit_at if db_user is not None else None)
    if last_visit is None:
        return success_response(data={"count": 0})

    cutoff = datetime.now(timezone.utc) - timedelta(hours=MENTION_LOOKBACK_HOURS)
    baseline = max(cutoff, last_visit)

    role_match = array_contains_value(TeamChatMessage.mentioned_roles, user.role, dialect_name)
    user_match = array_contains_value(TeamChatMessage.mentioned_user_ids, user.id, dialect_name)
    # @所有人 — anyone except the author. Author exclusion via user_id
    # avoids self-bell when an admin posts an "@所有人" announcement.
    all_match = and_(
        TeamChatMessage.mentions_all == True,  # noqa: E712
        TeamChatMessage.user_id != user.id,
    )
    already_read_by_me = array_contains_user_receipt(TeamChatMessage.read_by, user.id, dialect_name)
    result = await db.execute(
        select(func.count(TeamChatMessage.id)).where(
            and_(
                TeamChatMessage.timestamp > baseline,
                ~already_read_by_me,
                or_(role_match, user_match, all_match),
            )
        )
    )
    count = result.scalar() or 0

    return success_response(data={"count": count})


@router.get("")
async def list_team_chat(
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None, description="Cursor: ISO 8601 timestamp; return top-level messages strictly older than this."),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return up to ``limit`` most-recent top-level messages with their
    replies, in chronological order (oldest first within the page).

    TC-W3-T2 reversed the original ASC LIMIT 50 behavior (which showed
    the oldest 50 messages and hid every newer one once the table grew
    past 50). The page now anchors at the latest message and accepts a
    ``before`` cursor for reverse infinite scroll: pass the oldest
    timestamp from the previous page to load the next-older slice.

    The response remains chronologically ascending so the frontend can
    keep treating ``messages`` as "top to bottom in conversation order".
    """
    # Soft-deleted messages are hidden from the chat (TC-B11). The audit
    # log retains the content snapshot for moderation review.
    not_deleted = TeamChatMessage.deleted_at.is_(None)
    base_filter = and_(TeamChatMessage.reply_to_id.is_(None), not_deleted)
    where_clauses = [base_filter]

    # Cursor — strictly older than ``before``. Tie-break by id desc so a
    # repeated submit at the exact same timestamp still progresses.
    if before:
        try:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'before' cursor — must be ISO 8601 timestamp")
        if before_dt.tzinfo is None:
            before_dt = before_dt.replace(tzinfo=timezone.utc)
        where_clauses.append(TeamChatMessage.timestamp < before_dt)

    total_result = await db.execute(
        select(func.count(TeamChatMessage.id)).where(base_filter)
    )
    total = total_result.scalar() or 0

    # Fetch the latest N top-level messages (DESC), then reverse in
    # memory so the response keeps the historical ASC contract that
    # ChatPage's flat-thread renderer expects.
    result = await db.execute(
        select(TeamChatMessage)
        .where(*where_clauses)
        .order_by(TeamChatMessage.timestamp.desc(), TeamChatMessage.id.desc())
        .limit(limit)
    )
    top_messages = list(reversed(result.scalars().all()))
    top_ids = [m.id for m in top_messages]

    # Fetch all replies for these parents
    replies_map: dict = {mid: [] for mid in top_ids}
    if top_ids:
        reply_result = await db.execute(
            select(TeamChatMessage)
            .where(
                TeamChatMessage.reply_to_id.in_(top_ids),
                TeamChatMessage.deleted_at.is_(None),
            )
            .order_by(TeamChatMessage.timestamp.asc())
        )
        for r in reply_result.scalars().all():
            if r.reply_to_id in replies_map:
                replies_map[r.reply_to_id].append(chat_to_dict(r))

    messages = [
        chat_to_dict(m, replies=replies_map.get(m.id, []))
        for m in top_messages
    ]

    # ``hasMore`` is true if the page is full — the frontend uses this
    # to decide whether to keep offering "load older". ``oldestTimestamp``
    # gives the next ``before`` cursor.
    has_more = len(top_messages) >= limit and total > len(top_messages)
    oldest_timestamp = (
        top_messages[0].timestamp.isoformat()
        if top_messages and top_messages[0].timestamp
        else None
    )

    return success_response(data={
        "messages": messages,
        "total": total,
        "hasMore": has_more,
        "oldestTimestamp": oldest_timestamp,
    })


@router.post("")
@limiter.limit("20/minute")
async def send_team_chat(
    request: Request,
    body: TeamChatCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Pinned messages are admin-only — they surface in the team's "公告"
    # / pinned-tab and would otherwise be a trivial griefing vector. The
    # equivalent UI affordance ("發布公告" button) is admin-gated, but the
    # raw POST path was open before TC-B01.
    if body.pinned and user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only admins can post pinned messages",
        )

    # TC-B05: validate mentionedUserIds reference real, active users.
    # Pydantic only checks length; without this, typos / fabricated IDs
    # silently land in the JSONB column and never trigger any badge,
    # leaving the sender to wonder why "@王小明" went unanswered.
    if body.mentionedUserIds:
        existing_rows = await db.execute(
            select(User.id).where(
                User.id.in_(body.mentionedUserIds),
                User.active == True,  # noqa: E712
            )
        )
        existing_ids = {row[0] for row in existing_rows.all()}
        unknown = [uid for uid in body.mentionedUserIds if uid not in existing_ids]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Unknown or inactive user(s) in mentionedUserIds",
                    "unknown": unknown,
                },
            )

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
        mentions_all=bool(body.mentionsAll),
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
@limiter.limit("60/minute")
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

    # Recipient gate: marking a message read flips the global `is_read` flag,
    # which other users' mention/notification queries observe (per audit
    # F-02). Restrict this side-effect to people the message was actually
    # sent to. Admins are exempt for moderation/cleanup.
    mentioned_user_ids = msg.mentioned_user_ids or []
    mentioned_roles = msg.mentioned_roles or []
    is_recipient = (
        user.id == msg.user_id  # author marking own
        or user.id in mentioned_user_ids
        or user.role in mentioned_roles
        or bool(msg.mentions_all)  # @所有人 — every active user is a recipient
    )
    if not is_recipient and user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only mentioned recipients (or admins) can mark this message read",
        )

    msg.is_read = True
    msg.read_by = append_read_receipt(msg.read_by, user.id, user.name)

    # Audit because flipping is_read is a team-wide side effect on the
    # mention/notification badges. Without this trail a single user could
    # silently zero everyone's red dot with no record.
    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="標記團隊訊息已讀", target=message_id, status="success",
        ip=request.client.host if request.client else None,
    )
    await db.commit()
    await db.refresh(msg)

    return success_response(data=chat_to_dict(msg), message="已標記已讀")


@router.patch("/{message_id}/pin")
@limiter.limit("10/minute")
async def toggle_pin_message(
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
    """Soft delete (TC-B11): mark the row deleted instead of removing it.

    The list endpoint filters ``deleted_at IS NULL`` so the message
    disappears from the chat UI, but the audit trail keeps a content
    snapshot, reply quotes don't lose their parent reference, and a
    moderation review can still surface what was removed.
    """
    result = await db.execute(
        select(TeamChatMessage).where(
            TeamChatMessage.id == message_id,
            TeamChatMessage.deleted_at.is_(None),
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    now = datetime.now(timezone.utc)
    msg.deleted_at = now
    msg.deleted_by_id = user.id

    # Capture content snapshot in audit details so the full record
    # outlives the soft-deleted row. 500 chars caps DB write size while
    # still being useful for moderation review (Pydantic max content
    # length is 10000, so this is "first paragraph or so").
    content_snapshot = (msg.content or "")[:500]
    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="刪除團隊訊息", target=message_id, status="success",
        ip=request.client.host if request.client else None,
        details={
            "content": content_snapshot,
            "author_id": msg.user_id,
            "author_name": msg.user_name,
            "original_timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
        },
    )
    await db.commit()
    return success_response(message="訊息已刪除")
