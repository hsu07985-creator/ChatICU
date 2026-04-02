import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.audit import create_audit_log
from app.models.message import PatientMessage
from app.models.user import User
from app.routers.patients import normalize_patient_id
from app.schemas.message import MessageCreate, MessageTagUpdate
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/messages", tags=["messages"])

# ── Default preset tags ──
DEFAULT_PRESET_TAGS = [
    "重要", "追蹤", "待處理", "已確認", "用藥相關",
    "檢驗相關", "會診", "交班", "護理紀錄", "家屬溝通",
]


def msg_to_dict(msg: PatientMessage, replies: list = None) -> dict:
    d = {
        "id": msg.id,
        "patientId": msg.patient_id,
        "authorId": msg.author_id,
        "authorName": msg.author_name,
        "authorRole": msg.author_role,
        "messageType": msg.message_type,
        "content": msg.content,
        "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
        "isRead": msg.is_read,
        "linkedMedication": msg.linked_medication,
        "adviceCode": msg.advice_code,
        "readBy": msg.read_by or [],
        "replyToId": msg.reply_to_id,
        "replyCount": msg.reply_count or 0,
        "tags": msg.tags or [],
        "mentionedRoles": msg.mentioned_roles or [],
    }
    if replies is not None:
        d["replies"] = replies
    return d


@router.get("/preset-tags")
async def get_preset_tags(
    patient_id: str,
    user: User = Depends(get_current_user),
):
    return success_response(data=DEFAULT_PRESET_TAGS)


@router.get("")
async def list_messages(
    patient_id: str,
    unread: bool = Query(None),
    message_type: str = Query(None, alias="type"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)

    # Fetch top-level messages (no reply_to_id)
    query = select(PatientMessage).where(
        PatientMessage.patient_id == pid,
        PatientMessage.reply_to_id.is_(None),
    )

    if unread is not None:
        query = query.where(PatientMessage.is_read == (not unread))
    if message_type:
        query = query.where(PatientMessage.message_type == message_type)

    ordered = query.order_by(PatientMessage.timestamp.desc())
    offset = (page - 1) * limit
    result = await db.execute(ordered.offset(offset).limit(limit))
    top_messages = result.scalars().all()

    # Fetch replies for these messages
    top_ids = [m.id for m in top_messages]
    replies_map: dict = {}
    if top_ids:
        replies_result = await db.execute(
            select(PatientMessage)
            .where(PatientMessage.reply_to_id.in_(top_ids))
            .order_by(PatientMessage.timestamp.asc())
        )
        for reply in replies_result.scalars().all():
            replies_map.setdefault(reply.reply_to_id, []).append(msg_to_dict(reply))

    messages = [
        msg_to_dict(m, replies=replies_map.get(m.id, []))
        for m in top_messages
    ]

    return success_response(data={
        "messages": messages,
        "total": len(messages),
        "page": page,
        "limit": limit,
    })


@router.post("")
async def create_message(
    patient_id: str,
    body: MessageCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)

    if body.messageType == "medication-advice" and user.role not in ("pharmacist", "admin"):
        raise HTTPException(status_code=403, detail="Only pharmacists can send medication advice")

    # If replying, validate parent exists
    if body.replyToId:
        parent_result = await db.execute(
            select(PatientMessage).where(PatientMessage.id == body.replyToId)
        )
        parent = parent_result.scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent message not found")

    msg = PatientMessage(
        id=f"pmsg_{uuid.uuid4().hex[:8]}",
        patient_id=pid,
        author_id=user.id,
        author_name=user.name,
        author_role=user.role,
        message_type=body.messageType,
        content=body.content,
        timestamp=datetime.now(timezone.utc),
        is_read=False,
        linked_medication=body.linkedMedication,
        advice_code=body.adviceCode,
        reply_to_id=body.replyToId,
        tags=body.tags or [],
        mentioned_roles=body.mentionedRoles or [],
    )
    db.add(msg)
    await db.flush()

    # Increment parent reply_count
    if body.replyToId and parent:
        parent.reply_count = (parent.reply_count or 0) + 1

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立病患訊息", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={
            "message_id": msg.id,
            "message_type": body.messageType,
            "reply_to_id": body.replyToId,
        },
    )

    return success_response(data=msg_to_dict(msg), message="訊息已發送")


@router.patch("/{message_id}/read")
async def mark_message_read(
    patient_id: str,
    message_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PatientMessage).where(PatientMessage.id == message_id)
    )
    msg = result.scalar_one_or_none()

    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    msg.is_read = True
    read_by = msg.read_by or []
    read_by.append({
        "userId": user.id,
        "userName": user.name,
        "readAt": datetime.now(timezone.utc).isoformat(),
    })
    msg.read_by = read_by

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="標記訊息已讀", target=message_id, status="success",
        ip=request.client.host if request.client else None,
        details={"patient_id": patient_id},
    )

    return success_response(data=msg_to_dict(msg), message="訊息已標記為已讀")


@router.patch("/{message_id}/tags")
async def update_message_tags(
    patient_id: str,
    message_id: str,
    body: MessageTagUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PatientMessage).where(PatientMessage.id == message_id)
    )
    msg = result.scalar_one_or_none()

    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    current_tags = list(msg.tags or [])

    if body.add:
        for tag in body.add:
            if tag not in current_tags and len(tag) <= 30:
                current_tags.append(tag)

    if body.remove:
        current_tags = [t for t in current_tags if t not in body.remove]

    msg.tags = current_tags

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="更新訊息標籤", target=message_id, status="success",
        ip=request.client.host if request.client else None,
        details={"patient_id": patient_id, "tags": current_tags},
    )

    return success_response(data=msg_to_dict(msg), message="標籤已更新")
