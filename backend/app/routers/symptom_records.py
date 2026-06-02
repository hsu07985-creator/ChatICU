import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.utils.request import get_client_ip
from app.middleware.audit import create_audit_log
from app.middleware.auth import get_current_user
from app.models.patient import Patient
from app.models.symptom_record import SymptomRecord
from app.models.user import User
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.utils.response import success_response

router = APIRouter(
    prefix="/patients/{patient_id}/symptom-records",
    tags=["symptom-records"],
)


def record_to_dict(rec: SymptomRecord) -> dict:
    return {
        "id": rec.id,
        "patientId": rec.patient_id,
        "recordedAt": rec.recorded_at.isoformat() if rec.recorded_at else None,
        "symptoms": rec.symptoms or [],
        "recordedBy": rec.recorded_by,
        "notes": rec.notes,
        "createdAt": rec.created_at.isoformat() if rec.created_at else None,
    }


@router.get("")
async def list_symptom_records(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = pat_result.scalar_one_or_none()
    if not patient_obj:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    result = await db.execute(
        select(SymptomRecord)
        .where(SymptomRecord.patient_id == pid)
        .order_by(SymptomRecord.recorded_at.desc())
    )
    records = [record_to_dict(r) for r in result.scalars().all()]
    return success_response(data=records)


@router.post("")
async def create_symptom_record(
    patient_id: str,
    body: dict,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = pat_result.scalar_one_or_none()
    if not patient_obj:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    symptoms = body.get("symptoms", [])
    if not isinstance(symptoms, list):
        raise HTTPException(status_code=400, detail="symptoms must be a list")

    # Snapshot previous symptoms so the audit log captures the full transition.
    prev_symptoms = list(patient_obj.symptoms or [])

    record = SymptomRecord(
        id=f"sym_{uuid.uuid4().hex[:8]}",
        patient_id=pid,
        recorded_at=datetime.now(timezone.utc),
        symptoms=symptoms,
        recorded_by={"id": user.id, "name": user.name},
        notes=body.get("notes"),
    )
    db.add(record)

    # Also update the patient's current symptoms snapshot
    patient_obj.symptoms = symptoms
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="新增病人症狀記錄", target=pid, status="success",
        ip=get_client_ip(request),
        details={
            "record_id": record.id,
            "symptoms": symptoms,
            "previous_symptoms": prev_symptoms,
            "notes": body.get("notes"),
        },
    )

    return success_response(data=record_to_dict(record), message="症狀記錄已儲存")
