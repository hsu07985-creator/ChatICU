"""FastAPI dependencies shared across patient-scoped routers.

B3(architecture-audit-2026-07-19):取代 14 處手刻「normalize → fetch →
404 → verify_patient_access」段落。authz 從「handler 記得呼叫」變成
「不經過 dependency 就拿不到 Patient 物件」——結構性強制。
"""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.patient import Patient
from app.models.user import User
from app.utils.patient_access import normalize_patient_id, verify_patient_access


async def get_accessible_patient(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Patient:
    """Load the path-param patient and enforce access; 404 when absent."""
    pid = normalize_patient_id(patient_id)
    result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = result.scalar_one_or_none()
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient)
    return patient
