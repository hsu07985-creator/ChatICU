import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.ventilator import VentilatorSetting, WeaningAssessment
from app.models.user import User
from app.models.patient import Patient
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/ventilator", tags=["ventilator"])


def vent_to_dict(v: VentilatorSetting) -> dict:
    return {
        "id": v.id,
        "patientId": v.patient_id,
        "timestamp": v.timestamp.isoformat() if v.timestamp else None,
        "mode": v.mode,
        "fio2": v.fio2,
        "peep": v.peep,
        "tidalVolume": v.tidal_volume,
        "respiratoryRate": v.respiratory_rate,
        "inspiratoryPressure": v.inspiratory_pressure,
        "pressureSupport": v.pressure_support,
        "ieRatio": v.ie_ratio,
        "pip": v.pip,
        "plateau": v.plateau,
        "compliance": v.compliance,
        "resistance": v.resistance,
    }


def weaning_to_dict(w: WeaningAssessment) -> dict:
    return {
        "id": w.id,
        "patientId": w.patient_id,
        "timestamp": w.timestamp.isoformat() if w.timestamp else None,
        "rsbi": w.rsbi,
        "nif": w.nif,
        "vt": w.vt,
        "rr": w.rr,
        "spo2": w.spo2,
        "fio2": w.fio2,
        "peep": w.peep,
        "gcs": w.gcs,
        "coughStrength": w.cough_strength,
        "secretions": w.secretions,
        "hemodynamicStability": w.hemodynamic_stability,
        "recommendation": w.recommendation,
        "readinessScore": w.readiness_score,
        "assessedBy": w.assessed_by,
    }


@router.get("/latest")
async def get_latest_ventilator(
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
        select(VentilatorSetting)
        .where(VentilatorSetting.patient_id == pid)
        .order_by(VentilatorSetting.timestamp.desc())
        .limit(1)
    )
    v = result.scalar_one_or_none()

    if not v:
        return success_response(data=None, message="No ventilator data found")

    return success_response(data=vent_to_dict(v))


@router.get("/trends")
async def get_ventilator_trends(
    patient_id: str,
    hours: int = Query(24, ge=1, le=168),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(
        select(VentilatorSetting)
        .where(VentilatorSetting.patient_id == pid)
        .order_by(VentilatorSetting.timestamp.desc())
        .limit(hours * 2)
    )
    vents = result.scalars().all()

    return success_response(data={
        "trends": [vent_to_dict(v) for v in reversed(vents)],
        "hours": hours,
    })


@router.get("/weaning-assessment")
async def get_weaning_assessment(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(
        select(WeaningAssessment)
        .where(WeaningAssessment.patient_id == pid)
        .order_by(WeaningAssessment.timestamp.desc())
        .limit(1)
    )
    w = result.scalar_one_or_none()

    if not w:
        return success_response(data=None, message="No weaning assessment found")

    return success_response(data=weaning_to_dict(w))


@router.post("/weaning-assessment")
async def create_weaning_assessment(
    patient_id: str,
    request: Request,
    user: User = Depends(require_roles("doctor", "np", "admin")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    assessment = WeaningAssessment(
        id=f"weaning_{uuid.uuid4().hex[:8]}",
        patient_id=pid,
        timestamp=datetime.now(timezone.utc),
        assessed_by={"id": user.id, "name": user.name, "role": user.role},
    )
    db.add(assessment)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立脫機評估", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"assessment_id": assessment.id},
    )
    await db.flush()

    return success_response(data=weaning_to_dict(assessment), message="脫機評估已建立")
