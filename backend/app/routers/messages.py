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
from app.models.custom_tag import CustomTag
from app.schemas.message import MessageCreate, MessageTagUpdate, CustomTagCreate
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/messages", tags=["messages"])

_UNSET = object()  # sentinel for optional advice_accepted

# ── Default preset tags ──
DEFAULT_PRESET_TAGS = []

# Pharmacist category tags (match 4 major categories in pharmacy-master-data)
PHARMACIST_CATEGORY_TAGS = ["建議處方", "主動建議", "建議監測", "用藥連貫性"]

# Map full category label → short tag name (used for auto-tagging)
CATEGORY_TAG_MAP = {
    "1. 建議處方": "建議處方",
    "2. 主動建議": "主動建議",
    "3. 建議監測": "建議監測",
    "4. 用藥連貫性": "用藥連貫性",
    "4. 用藥適從性": "用藥連貫性",  # legacy alias
}

# Map advice_code → short label (parenthetical content stripped)
# Used for readable subcode tags: "1-1 給藥問題" instead of bare "1-1"
CODE_TO_SHORT_LABEL = {
    # VPN letter format (current)
    "1-A": "給藥問題",
    "1-B": "適應症問題",
    "1-C": "用藥禁忌問題",
    "1-D": "藥品併用問題",
    "1-E": "藥品交互作用",
    "1-F": "疑似藥品不良反應",
    "1-G": "藥品相容性問題",
    "1-H": "其他",
    "1-I": "不符健保給付規定",
    "1-J": "用藥劑量/頻次問題",
    "1-K": "用藥期間/數量問題",
    "1-L": "用藥途徑或劑型問題",
    "1-M": "建議更適當用藥/配方組成",
    "2-J": "用藥劑量/頻次問題",
    "2-K": "用藥期間/數量問題",
    "2-L": "用藥途徑或劑型問題",
    "2-M": "建議更適當用藥/配方組成",
    "2-N": "藥品不良反應評估",
    "2-O": "建議用藥/建議增加用藥",
    "2-P": "建議藥物治療療程",
    "2-Q": "建議靜脈營養配方",
    "3-R": "建議藥品療效監測",
    "3-S": "建議藥品不良反應監測",
    "3-T": "建議藥品血中濃度監測",
    "4-U": "藥歷審核與整合",
    "4-V": "藥品辨識/自備藥辨識",
    "4-W": "病人用藥遵從性問題",
    # Legacy numeric format (for backward compatibility with existing DB records)
    "1-1": "給藥問題",
    "1-2": "適應症問題",
    "1-3": "用藥禁忌問題",
    "1-4": "藥品併用問題",
    "1-5": "藥品交互作用",
    "1-6": "疑似藥品不良反應",
    "1-7": "藥品相容性問題",
    "1-8": "其他",
    "1-9": "不符健保給付規定",
    "1-10": "用藥劑量/頻次問題",
    "1-11": "用藥期間/數量問題",
    "1-12": "用藥途徑或劑型問題",
    "1-13": "建議更適當用藥/配方組成",
    "2-1": "用藥劑量/頻次問題",
    "2-2": "用藥期間/數量問題",
    "2-3": "用藥途徑或劑型問題",
    "2-4": "建議更適當用藥/配方組成",
    "2-5": "藥品不良反應評估",
    "2-6": "建議用藥/建議增加用藥",
    "2-7": "建議藥物治療療程",
    "2-8": "建議靜脈營養配方",
    "3-1": "建議藥品療效監測",
    "3-2": "建議藥品不良反應監測",
    "3-3": "建議藥品血中濃度監測",
    "4-1": "藥歷審核與整合",
    "4-2": "藥品辨識/自備藥辨識",
    "4-3": "病人用藥遵從性問題",
}


_VPN_LETTER_RE = __import__("re").compile(r"^\d+-[A-Z]$")


def _is_vpn_letter_code(code: str) -> bool:
    return bool(_VPN_LETTER_RE.match(code))


def format_subcode_tag(code: str) -> str:
    """Format advice code as readable tag: '1-A' → '1-A 給藥問題'."""
    label = CODE_TO_SHORT_LABEL.get(code)
    if label:
        return f"{code} {label}"
    return code


def msg_to_dict(
    msg: PatientMessage,
    replies: list = None,
    advice_accepted: object = _UNSET,
    advice_responded_by: object = _UNSET,
) -> dict:
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
        "adviceRecordId": msg.advice_record_id,
        "readBy": msg.read_by or [],
        "replyToId": msg.reply_to_id,
        "replyCount": msg.reply_count or 0,
        "tags": msg.tags or [],
        "mentionedRoles": msg.mentioned_roles or [],
    }
    if advice_accepted is not _UNSET:
        d["adviceAccepted"] = advice_accepted
    if advice_responded_by is not _UNSET:
        d["adviceRespondedBy"] = advice_responded_by
    if replies is not None:
        d["replies"] = replies
    return d


@router.get("/preset-tags")
async def get_preset_tags(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return flat preset tag list (backward compatible: data is string[])."""
    tags = list(DEFAULT_PRESET_TAGS)
    if user.role in ("pharmacist", "admin"):
        tags.extend(PHARMACIST_CATEGORY_TAGS)

    # Merge shared custom tags (cap at 500 to bound memory)
    result = await db.execute(
        select(CustomTag.name).order_by(CustomTag.created_at.asc()).limit(500)
    )
    seen = set(tags)
    for (name,) in result.all():
        if name not in seen:
            tags.append(name)
            seen.add(name)

    return success_response(data=tags)


@router.get("/pharmacy-tags")
async def get_pharmacy_tags(
    patient_id: str,
    user: User = Depends(get_current_user),
):
    """Return grouped pharmacy subcode tags for dedicated pharmacy tag picker."""
    if user.role not in ("pharmacist", "admin"):
        return success_response(data=[])

    # Only include VPN letter-format codes (exclude legacy numeric codes)
    categories = [
        {
            "category": "建議處方",
            "tags": [format_subcode_tag(c) for c in CODE_TO_SHORT_LABEL if c.startswith("1-") and _is_vpn_letter_code(c)],
        },
        {
            "category": "主動建議",
            "tags": [format_subcode_tag(c) for c in CODE_TO_SHORT_LABEL if c.startswith("2-") and _is_vpn_letter_code(c)],
        },
        {
            "category": "建議監測",
            "tags": [format_subcode_tag(c) for c in CODE_TO_SHORT_LABEL if c.startswith("3-") and _is_vpn_letter_code(c)],
        },
        {
            "category": "用藥連貫性",
            "tags": [format_subcode_tag(c) for c in CODE_TO_SHORT_LABEL if c.startswith("4-") and _is_vpn_letter_code(c)],
        },
    ]
    return success_response(data=categories)


def custom_tag_to_dict(tag: CustomTag) -> dict:
    return {
        "id": tag.id,
        "name": tag.name,
        "createdById": tag.created_by_id,
        "createdByName": tag.created_by_name,
        "createdAt": tag.created_at.isoformat() if tag.created_at else None,
    }


@router.get("/custom-tags")
async def list_custom_tags(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all shared custom tags."""
    result = await db.execute(
        select(CustomTag).order_by(CustomTag.created_at.asc()).limit(500)
    )
    tags = [custom_tag_to_dict(t) for t in result.scalars().all()]
    return success_response(data=tags)


@router.post("/custom-tags")
async def create_custom_tag(
    patient_id: str,
    body: CustomTagCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new shared custom tag visible to the whole team."""
    name = body.name.strip()

    # Reject if it conflicts with system preset tags
    all_preset = set(DEFAULT_PRESET_TAGS) | set(PHARMACIST_CATEGORY_TAGS)
    if name in all_preset:
        raise HTTPException(status_code=409, detail="此為系統預設標籤，無法重複建立")

    # Check for existing custom tag with same name
    existing = await db.execute(
        select(CustomTag).where(CustomTag.name == name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="此自訂標籤已存在")

    tag = CustomTag(
        id=f"ctag_{uuid.uuid4().hex[:8]}",
        name=name,
        created_by_id=user.id,
        created_by_name=user.name,
    )
    db.add(tag)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立共用標籤", target=tag.id, status="success",
        ip=request.client.host if request.client else None,
        details={"tag_name": name},
    )

    return success_response(data=custom_tag_to_dict(tag), message="標籤已建立")


@router.delete("/custom-tags/{tag_id}")
async def delete_custom_tag(
    patient_id: str,
    tag_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a shared custom tag. Existing messages keep their tags unchanged."""
    result = await db.execute(
        select(CustomTag).where(CustomTag.id == tag_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="自訂標籤不存在")

    tag_name = tag.name
    await db.delete(tag)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="刪除共用標籤", target=tag_id, status="success",
        ip=request.client.host if request.client else None,
        details={"tag_name": tag_name},
    )

    return success_response(message="標籤已刪除")


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
            .limit(50 * len(top_ids))
        )
        for reply in replies_result.scalars().all():
            replies_map.setdefault(reply.reply_to_id, []).append(msg_to_dict(reply))

    # Batch-lookup adviceAccepted + respondedBy for messages linked to pharmacy advices
    advice_ids = [m.advice_record_id for m in top_messages if m.advice_record_id]
    accepted_map: dict = {}
    responded_by_map: dict = {}
    if advice_ids:
        from app.models.pharmacy_advice import PharmacyAdvice
        adv_result = await db.execute(
            select(PharmacyAdvice.id, PharmacyAdvice.accepted, PharmacyAdvice.responded_by_name)
            .where(PharmacyAdvice.id.in_(advice_ids))
        )
        for adv_id, adv_accepted, adv_responded_by in adv_result.all():
            accepted_map[adv_id] = adv_accepted
            responded_by_map[adv_id] = adv_responded_by

    messages = [
        msg_to_dict(
            m,
            replies=replies_map.get(m.id, []),
            advice_accepted=accepted_map.get(m.advice_record_id, _UNSET),
            advice_responded_by=responded_by_map.get(m.advice_record_id, _UNSET),
        )
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

    # Phase 3: adviceAction — doctor accept/reject via bulletin board reply
    advice_synced = False
    if body.adviceAction and body.replyToId and parent:
        if user.role not in ("doctor", "admin"):
            raise HTTPException(status_code=403, detail="只有醫師可以接受或拒絕藥事建議")
        if parent.message_type != "medication-advice":
            raise HTTPException(status_code=422, detail="只能對藥事建議訊息進行接受/拒絕操作")
        if not parent.advice_record_id:
            raise HTTPException(status_code=422, detail="此訊息未連結藥事建議紀錄")

        from app.models.pharmacy_advice import PharmacyAdvice
        adv_result = await db.execute(
            select(PharmacyAdvice).where(PharmacyAdvice.id == parent.advice_record_id)
        )
        advice = adv_result.scalar_one_or_none()
        if not advice:
            raise HTTPException(status_code=404, detail="藥事建議紀錄不存在")
        if advice.accepted is not None:
            raise HTTPException(status_code=409, detail="此建議已有回覆，無法重複操作")

        accepted = body.adviceAction == "accept"
        advice.accepted = accepted
        advice.responded_by_id = user.id
        advice.responded_by_name = user.name
        advice.responded_at = datetime.now(timezone.utc)
        advice_synced = True

        await create_audit_log(
            db, user_id=user.id, user_name=user.name, role=user.role,
            action="回覆藥事建議" if accepted else "拒絕藥事建議",
            target=parent.advice_record_id, status="success",
            ip=request.client.host if request.client else None,
            details={"accepted": accepted, "via": "bulletin-reply", "message_id": msg.id},
        )

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立病患訊息", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={
            "message_id": msg.id,
            "message_type": body.messageType,
            "reply_to_id": body.replyToId,
            "advice_action": body.adviceAction,
        },
    )

    result_msg = "訊息已發送"
    if advice_synced:
        action_label = "已接受" if body.adviceAction == "accept" else "已拒絕"
        result_msg = f"訊息已發送，藥事建議{action_label}"

    return success_response(data=msg_to_dict(msg), message=result_msg)


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
