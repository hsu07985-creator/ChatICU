"""Pharmacist SOAP records — TC-FU-T2.

POST /pharmacy/soap-records       — create one (pharmacist / admin only)
GET  /pharmacy/soap-records        — list mine (per-user scoped)

Per-user scope mirrors ``advice_records.py``: each pharmacist (and admin)
sees only the SOAPs they themselves authored. This is the same isolation
expectation as ``PharmacyAdvice`` — admins are not granted a global view
because the SOAP free-text may contain patient-identifying detail.
"""
from datetime import datetime, timezone
from typing import Optional, Tuple
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.audit import create_audit_log
from app.middleware.auth import require_roles
from app.models.patient import Patient
from app.models.pharmacy_soap_record import PharmacySoapRecord
from app.models.user import User
from app.schemas.pharmacy_soap import PharmacySoapRecordCreate
from app.utils.response import success_response

router = APIRouter(tags=["pharmacy"])


def _soap_to_dict(record: PharmacySoapRecord, patient_name: Optional[str] = None) -> dict:
    return {
        "id": record.id,
        "patientId": record.patient_id,
        "patientName": patient_name,
        "bedNumber": record.bed_number,
        "pharmacistId": record.pharmacist_id,
        "pharmacistName": record.pharmacist_name,
        "subjective": record.subjective or "",
        "objective": record.objective or "",
        "assessment": record.assessment or "",
        "plan": record.plan or "",
        "polishedContent": record.polished_content or "",
        "createdAt": record.created_at.isoformat() if record.created_at else None,
        "updatedAt": record.updated_at.isoformat() if record.updated_at else None,
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


@router.post("/soap-records")
async def create_soap_record(
    request: Request,
    body: PharmacySoapRecordCreate,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    pat_result = await db.execute(select(Patient).where(Patient.id == body.patientId))
    patient = pat_result.scalar_one_or_none()
    if not patient:
        # Per task: orphan SOAP rows are not allowed → 422 not 404 so the
        # frontend treats it as a validation error and surfaces the message
        # in the existing toast path.
        raise HTTPException(status_code=422, detail="病患不存在或 patient_id 無效")

    record = PharmacySoapRecord(
        id=f"psoap_{uuid.uuid4().hex[:8]}",
        patient_id=patient.id,
        pharmacist_id=user.id,
        pharmacist_name=user.name,
        subjective=(body.subjective or None),
        objective=(body.objective or None),
        assessment=(body.assessment or None),
        plan=(body.plan or None),
        polished_content=(body.polished or None),
        bed_number=patient.bed_number,
    )
    db.add(record)
    await db.flush()

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="建立 SOAP 紀錄",
        target=record.id,
        status="success",
        ip=request.client.host if request.client else None,
        details={"patient_id": patient.id},
    )

    return success_response(
        data=_soap_to_dict(record, patient_name=patient.name),
        message="SOAP 紀錄已建立",
    )


@router.get("/soap-records")
async def list_soap_records(
    patient_id: Optional[str] = Query(None, alias="patient_id"),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """List the calling user's own SOAP records.

    Per-user scope: ``pharmacist_id == user.id`` for both pharmacists and
    admins (matches ``PharmacyAdvice`` policy). ``search`` matches against
    assessment + plan free text (the two AI-touched sections most likely to
    contain a clinical search term).
    """
    query = select(PharmacySoapRecord).where(
        PharmacySoapRecord.pharmacist_id == user.id
    )

    if patient_id:
        query = query.where(PharmacySoapRecord.patient_id == patient_id)

    if month:
        try:
            start, end = _parse_month_range(month)
            query = query.where(
                PharmacySoapRecord.created_at >= start,
                PharmacySoapRecord.created_at < end,
            )
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid month format: '{month}'. Expected YYYY-MM (e.g. 2026-05).",
            )

    if search:
        like = f"%{search.strip()}%"
        query = query.where(
            or_(
                PharmacySoapRecord.assessment.ilike(like),
                PharmacySoapRecord.plan.ilike(like),
            )
        )

    query = query.order_by(PharmacySoapRecord.created_at.desc())

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)
    rows = (await db.execute(query)).scalars().all()

    # Fetch patient names in one batch so the list page can show 床號 + 姓名.
    patient_ids = {r.patient_id for r in rows}
    patient_map: dict = {}
    if patient_ids:
        pat_result = await db.execute(
            select(Patient.id, Patient.name).where(Patient.id.in_(patient_ids))
        )
        patient_map = {pid: name for pid, name in pat_result.all()}

    return success_response(data={
        "records": [
            _soap_to_dict(r, patient_name=patient_map.get(r.patient_id))
            for r in rows
        ],
        "total": int(total),
    })
