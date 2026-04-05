import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
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
    import logging
    logger = logging.getLogger(__name__)
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("symptom_records list error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def create_symptom_record(
    patient_id: str,
    body: dict,
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

    return success_response(data=record_to_dict(record), message="症狀記錄已儲存")
