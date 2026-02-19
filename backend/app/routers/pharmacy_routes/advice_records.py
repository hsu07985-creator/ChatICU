import uuid
from datetime import datetime, timezone
from typing import Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.audit import create_audit_log
from app.middleware.auth import require_roles
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.pharmacy_advice import PharmacyAdvice
from app.models.user import User
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
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(PharmacyAdvice)

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

    return success_response(data={
        "total": total,
        "byCategory": by_cat,
        "byCode": by_code,
        "byPharmacist": by_pharm,
    })


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
        timestamp=datetime.now(timezone.utc),
    )
    db.add(advice)
    await db.flush()

    linked_med = None
    if body.linkedMedications:
        joined = ", ".join([m for m in body.linkedMedications if m])
        if joined:
            linked_med = joined[:200]

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
