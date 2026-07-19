import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_accessible_patient
from app.utils.request import get_client_ip
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.vital_sign import VitalSign
from app.models.user import User
from app.models.patient import Patient
from app.schemas.vital_sign import VitalSignResponse
from app.utils.patient_access import normalize_patient_id, verify_patient_access
from app.utils.response import success_response


class VitalSignInput(BaseModel):
    heart_rate: Optional[int] = None
    systolic_bp: Optional[int] = None
    diastolic_bp: Optional[int] = None
    mean_bp: Optional[float] = None
    respiratory_rate: Optional[int] = None
    spo2: Optional[int] = None
    temperature: Optional[float] = None
    etco2: Optional[float] = None
    cvp: Optional[float] = None
    icp: Optional[float] = None
    cpp: Optional[float] = None
    body_weight: Optional[float] = None

router = APIRouter(prefix="/patients/{patient_id}/vital-signs", tags=["vital-signs"])


def vital_to_dict(vs: VitalSign) -> dict:
    """B2 pattern: schema is the single source of the field mapping."""
    return VitalSignResponse.from_model(vs).dump_camel()


@router.get("/latest")
async def get_latest_vital_signs(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    patient: Patient = Depends(get_accessible_patient),
):
    pid = patient.id

    result = await db.execute(
        select(VitalSign)
        .where(VitalSign.patient_id == pid)
        .order_by(VitalSign.timestamp.desc())
        .limit(1)
    )
    vs = result.scalar_one_or_none()

    if not vs:
        return success_response(data=None, message="No vital signs found")

    return success_response(data=vital_to_dict(vs))


@router.get("/trends")
async def get_vital_sign_trends(
    patient_id: str,
    hours: int = Query(24, ge=1, le=168),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(
        select(VitalSign)
        .where(VitalSign.patient_id == pid)
        .order_by(VitalSign.timestamp.desc())
        .limit(hours * 2)
    )
    signs = result.scalars().all()

    trends = [vital_to_dict(vs) for vs in reversed(signs)]

    return success_response(data={"trends": trends, "hours": hours})


@router.get("/history")
async def get_vital_sign_history(
    patient_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    start_date: Optional[date] = Query(None, alias="startDate"),
    end_date: Optional[date] = Query(None, alias="endDate"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="startDate cannot be after endDate")

    pid = normalize_patient_id(patient_id)
    filters = [VitalSign.patient_id == pid]
    if start_date:
        filters.append(func.date(VitalSign.timestamp) >= start_date)
    if end_date:
        filters.append(func.date(VitalSign.timestamp) <= end_date)

    # Total count for pagination
    count_q = select(func.count()).where(*filters)
    total = (await db.execute(count_q)).scalar() or 0

    offset = (page - 1) * limit
    result = await db.execute(
        select(VitalSign)
        .where(*filters)
        .order_by(VitalSign.timestamp.desc())
        .offset(offset)
        .limit(limit)
    )
    signs = result.scalars().all()

    return success_response(data={
        "history": [vital_to_dict(vs) for vs in signs],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit if total > 0 else 0,
        },
    })


@router.post("")
async def create_vital_signs(
    patient_id: str,
    body: VitalSignInput,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = pat_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    vs = VitalSign(
        id=f"vs_{uuid.uuid4().hex[:12]}",
        patient_id=pid,
        timestamp=datetime.now(timezone.utc),
        heart_rate=body.heart_rate,
        systolic_bp=body.systolic_bp,
        diastolic_bp=body.diastolic_bp,
        mean_bp=body.mean_bp,
        respiratory_rate=body.respiratory_rate,
        spo2=body.spo2,
        temperature=body.temperature,
        etco2=body.etco2,
        cvp=body.cvp,
        icp=body.icp,
        cpp=body.cpp,
        body_weight=body.body_weight,
    )
    db.add(vs)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="手動輸入生命徵象", target=pid, status="success",
        ip=get_client_ip(request),
        details={"vital_sign_id": vs.id},
    )
    await db.flush()

    return success_response(data=vital_to_dict(vs), message="生命徵象已新增")
