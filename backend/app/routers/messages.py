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
from app.schemas.message import MessageCreate
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/messages", tags=["messages"])


def msg_to_dict(msg: PatientMessage) -> dict:
    return {
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
    }


@router.get("")
async def list_messages(
    patient_id: str,
    unread: bool = Query(None),
    message_type: str = Query(None, alias="type"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    query = select(PatientMessage).where(PatientMessage.patient_id == pid)

    if unread is not None:
        query = query.where(PatientMessage.is_read == (not unread))
    if message_type:
        query = query.where(PatientMessage.message_type == message_type)

    result = await db.execute(query.order_by(PatientMessage.timestamp.desc()))
    messages = result.scalars().all()

    return success_response(data={
        "messages": [msg_to_dict(m) for m in messages],
        "total": len(messages),
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
    )
    db.add(msg)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立病患訊息", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"message_id": msg.id, "message_type": body.messageType},
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
