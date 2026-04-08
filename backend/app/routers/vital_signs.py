from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.vital_sign import VitalSign
from app.models.user import User
from app.models.patient import Patient
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/vital-signs", tags=["vital-signs"])

REFERENCE_RANGES = {
    "temperature": {"min": 36.0, "max": 37.5, "unit": "°C"},
    "heartRate": {"min": 60, "max": 100, "unit": "bpm"},
    "systolicBP": {"min": 90, "max": 140, "unit": "mmHg"},
    "diastolicBP": {"min": 60, "max": 90, "unit": "mmHg"},
    "respiratoryRate": {"min": 12, "max": 20, "unit": "breaths/min"},
    "spo2": {"min": 95, "max": 100, "unit": "%"},
    "bodyWeight": {"min": 30, "max": 150, "unit": "kg"},
}


def vital_to_dict(vs: VitalSign) -> dict:
    return {
        "id": vs.id,
        "patientId": vs.patient_id,
        "timestamp": vs.timestamp.isoformat() if vs.timestamp else None,
        "heartRate": vs.heart_rate,
        "bloodPressure": {
            "systolic": vs.systolic_bp,
            "diastolic": vs.diastolic_bp,
            "mean": vs.mean_bp,
        },
        "respiratoryRate": vs.respiratory_rate,
        "spo2": vs.spo2,
        "temperature": vs.temperature,
        "etco2": vs.etco2,
        "cvp": vs.cvp,
        "icp": vs.icp,
        "cpp": vs.cpp,
        "bodyWeight": vs.body_weight,
        "referenceRanges": REFERENCE_RANGES,
    }


@router.get("/latest")
async def get_latest_vital_signs(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    # T09: verify patient access
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = pat_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient)

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
