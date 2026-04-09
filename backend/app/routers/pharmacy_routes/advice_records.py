import uuid
from datetime import datetime, timezone
from typing import Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
import sqlalchemy as sa
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.audit import create_audit_log
from app.middleware.auth import require_roles
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.pharmacy_advice import PharmacyAdvice
from app.models.user import User
from app.routers.messages import CATEGORY_TAG_MAP, format_subcode_tag
from app.schemas.admin import AdviceRecordCreate
from app.utils.response import success_response

router = APIRouter(tags=["pharmacy"])


def advice_to_dict(a: PharmacyAdvice) -> dict:
    return {
        "id": a.id,
        "patientId": a.patient_id,
        "patientName": a.patient_name,
        "bedNumber": a.bed_number,
        "adviceCode": a.advice_code,
        "adviceLabel": a.advice_label,
        "category": a.category,
        "content": a.content,
        "pharmacistName": a.pharmacist_name,
        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
        "linkedMedications": a.linked_medications or [],
        "accepted": a.accepted,
        "respondedById": a.responded_by_id,
        "respondedByName": a.responded_by_name,
        "respondedAt": a.responded_at.isoformat() if a.responded_at else None,
    }


def _parse_month_range(month: str) -> Tuple[datetime, datetime]:
    year, mon = month.split("-")
    year_int, mon_int = int(year), int(mon)
    if not (1 <= mon_int <= 12):
        raise ValueError(f"month out of range: {mon_int}")

    start = datetime(year_int, mon_int, 1, tzinfo=timezone.utc)
    if mon_int == 12:
        end = datetime(year_int + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year_int, mon_int + 1, 1, tzinfo=timezone.utc)
    return start, end


@router.get("/advice-records")
async def list_advice_records(
    month: str = Query(None, description="YYYY-MM format filter"),
    category: str = Query(None, description="Category filter"),
    accepted: str = Query(None, description="Filter: true/false/pending"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(PharmacyAdvice)

    if accepted is not None:
        if accepted == "true":
            query = query.where(PharmacyAdvice.accepted.is_(True))
        elif accepted == "false":
            query = query.where(PharmacyAdvice.accepted.is_(False))
        elif accepted == "pending":
            query = query.where(PharmacyAdvice.accepted.is_(None))

    if month:
        try:
            start, end = _parse_month_range(month)
            query = query.where(
                PharmacyAdvice.timestamp >= start,
                PharmacyAdvice.timestamp < end,
            )
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid month format: '{month}'. Expected YYYY-MM (e.g. 2026-01).",
            )

    if category:
        query = query.where(PharmacyAdvice.category == category)

    query = query.order_by(PharmacyAdvice.timestamp.desc())

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    records = result.scalars().all()

    return success_response(data={
        "records": [advice_to_dict(a) for a in records],
        "total": total,
    })


@router.get("/advice-records/stats")
async def get_advice_record_stats(
    month: str = Query(None, description="YYYY-MM format filter"),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if month:
        try:
            start, end = _parse_month_range(month)
            filters.extend([PharmacyAdvice.timestamp >= start, PharmacyAdvice.timestamp < end])
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid month format: '{month}'. Expected YYYY-MM (e.g. 2026-01).",
            )

    base = select(PharmacyAdvice)
    if filters:
        for flt in filters:
            base = base.where(flt)

    total_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_result.scalar() or 0

    by_cat_query = select(PharmacyAdvice.category, func.count(PharmacyAdvice.id))
    by_code_query = select(
        PharmacyAdvice.advice_code,
        PharmacyAdvice.advice_label,
        PharmacyAdvice.category,
        func.count(PharmacyAdvice.id),
    )
    by_pharm_query = select(PharmacyAdvice.pharmacist_name, func.count(PharmacyAdvice.id))

    if filters:
        for flt in filters:
            by_cat_query = by_cat_query.where(flt)
            by_code_query = by_code_query.where(flt)
            by_pharm_query = by_pharm_query.where(flt)

    by_cat_result = await db.execute(by_cat_query.group_by(PharmacyAdvice.category))
    by_cat = [
        {"category": str(cat), "count": int(cnt)}
        for cat, cnt in by_cat_result.all()
        if cat
    ]

    by_code_result = await db.execute(
        by_code_query.group_by(
            PharmacyAdvice.advice_code, PharmacyAdvice.advice_label, PharmacyAdvice.category
        )
    )
    by_code = [
        {"code": str(code), "label": str(label), "category": str(cat), "count": int(cnt)}
        for code, label, cat, cnt in by_code_result.all()
        if code
    ]
    by_code.sort(key=lambda x: (x["category"], x["code"]))

    by_pharm_result = await db.execute(by_pharm_query.group_by(PharmacyAdvice.pharmacist_name))
    by_pharm = [
        {"pharmacistName": str(name), "count": int(cnt)}
        for name, cnt in by_pharm_result.all()
        if name
    ]
    by_pharm.sort(key=lambda x: x["count"], reverse=True)

    # acceptance stats
    accept_query = select(PharmacyAdvice.accepted, func.count(PharmacyAdvice.id))
    if filters:
        for flt in filters:
            accept_query = accept_query.where(flt)
    accept_result = await db.execute(accept_query.group_by(PharmacyAdvice.accepted))
    accept_map: dict = {}
    for val, cnt in accept_result.all():
        if val is True:
            accept_map["accepted"] = int(cnt)
        elif val is False:
            accept_map["rejected"] = int(cnt)
        else:
            accept_map["pending"] = int(cnt)

    return success_response(data={
        "total": total,
        "byCategory": by_cat,
        "byCode": by_code,
        "byPharmacist": by_pharm,
        "byAcceptance": {
            "accepted": accept_map.get("accepted", 0),
            "rejected": accept_map.get("rejected", 0),
            "pending": accept_map.get("pending", 0),
        },
    })


@router.get("/advice-records/tag-stats")
async def get_advice_tag_stats(
    month: str = Query(None, description="YYYY-MM format filter"),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """Tag usage stats from bulletin board medication-advice messages."""
    filters = "WHERE pm.message_type = 'medication-advice' AND pm.tags IS NOT NULL AND pm.reply_to_id IS NULL"
    params = {}

    if month:
        try:
            start, end = _parse_month_range(month)
            filters += " AND pm.timestamp >= :start AND pm.timestamp < :end"
            params["start"] = start
            params["end"] = end
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid month format: '{month}'. Expected YYYY-MM (e.g. 2026-01).",
            )

    result = await db.execute(sa.text(
        f"SELECT tag, COUNT(*) as cnt "
        f"FROM patient_messages pm, jsonb_array_elements_text(pm.tags) AS tag "
        f"{filters} "
        f"GROUP BY tag ORDER BY cnt DESC"
    ), params)

    tag_stats = [{"tag": row.tag, "count": int(row.cnt)} for row in result.all()]

    return success_response(data={"tagStats": tag_stats})


@router.post("/advice-records")
async def create_advice_record(
    request: Request,
    body: AdviceRecordCreate,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    pat_result = await db.execute(select(Patient).where(Patient.id == body.patientId))
    patient = pat_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="病患不存在")

    advice = PharmacyAdvice(
        id=f"adv_{uuid.uuid4().hex[:8]}",
        patient_id=patient.id,
        patient_name=patient.name,
        bed_number=patient.bed_number,
        pharmacist_id=user.id,
        pharmacist_name=user.name,
        advice_code=body.adviceCode,
        advice_label=body.adviceLabel,
        category=body.category,
        content=body.content,
        linked_medications=body.linkedMedications,
        accepted=body.accepted,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(advice)
    await db.flush()

    linked_med = None
    if body.linkedMedications:
        joined = ", ".join([m for m in body.linkedMedications if m])
        if joined:
            linked_med = joined[:200]

    # Auto-tag with category + subcode
    auto_tags = []
    category_tag = CATEGORY_TAG_MAP.get(body.category)
    if category_tag:
        auto_tags.append(category_tag)
    if body.adviceCode:
        auto_tags.append(format_subcode_tag(body.adviceCode))

    msg = PatientMessage(
        id=f"pmsg_{uuid.uuid4().hex[:8]}",
        patient_id=patient.id,
        author_id=user.id,
        author_name=user.name,
        author_role=user.role,
        message_type="medication-advice",
        content=f"【藥事建議】{body.adviceCode} {body.adviceLabel}\n\n{body.content}",
        timestamp=datetime.now(timezone.utc),
        is_read=False,
        linked_medication=linked_med,
        advice_code=body.adviceCode,
        advice_record_id=advice.id,
        tags=auto_tags,
    )
    db.add(msg)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立用藥建議", target=advice.id, status="success",
        ip=request.client.host if request.client else None,
        details={"advice_code": body.adviceCode, "category": body.category},
    )
    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="同步用藥建議至留言板", target=msg.id, status="success",
        ip=request.client.host if request.client else None,
        details={"patient_id": patient.id, "advice_id": advice.id},
    )

    return success_response(data=advice_to_dict(advice), message="用藥建議已建立")


@router.patch("/advice-records/{advice_id}/response")
async def respond_to_advice(
    advice_id: str,
    request: Request,
    user: User = Depends(require_roles("doctor", "np", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """Doctor/admin accepts or rejects a pharmacy advice record."""
    import json as _json
    raw = await request.body()
    body = _json.loads(raw) if raw else {}
    accepted = body.get("accepted")
    if accepted is None or not isinstance(accepted, bool):
        raise HTTPException(status_code=422, detail="accepted (bool) is required")
    note = body.get("note", "")

    result = await db.execute(
        select(PharmacyAdvice).where(PharmacyAdvice.id == advice_id)
    )
    advice = result.scalar_one_or_none()
    if not advice:
        raise HTTPException(status_code=404, detail="Advice record not found")

    if advice.accepted is not None:
        raise HTTPException(status_code=409, detail="此建議已有回覆，無法重複操作")

    advice.accepted = accepted
    advice.responded_by_id = user.id
    advice.responded_by_name = user.name
    advice.responded_at = datetime.now(timezone.utc)

    # Create auto-reply on the linked patient message
    linked_msg_result = await db.execute(
        select(PatientMessage).where(PatientMessage.advice_record_id == advice_id)
    )
    linked_msg = linked_msg_result.scalar_one_or_none()
    if linked_msg:
        status_text = "已接受" if accepted else "已拒絕"
        reply_content = f"醫師 {user.name} {status_text}此藥事建議"
        if note:
            reply_content += f"\n備註：{note}"
        reply = PatientMessage(
            id=f"pmsg_{uuid.uuid4().hex[:8]}",
            patient_id=linked_msg.patient_id,
            author_id=user.id,
            author_name=user.name,
            author_role=user.role,
            message_type="medication-advice",
            content=reply_content,
            timestamp=datetime.now(timezone.utc),
            is_read=False,
            reply_to_id=linked_msg.id,
        )
        db.add(reply)
        linked_msg.reply_count = (linked_msg.reply_count or 0) + 1

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="回覆藥事建議" if accepted else "拒絕藥事建議",
        target=advice_id, status="success",
        ip=request.client.host if request.client else None,
        details={"accepted": accepted, "note": note},
    )

    return success_response(
        data=advice_to_dict(advice),
        message="已接受藥事建議" if accepted else "已拒絕藥事建議",
    )
