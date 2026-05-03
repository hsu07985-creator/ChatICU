"""Patient access control for AI chat.

Lightweight gate (Wave 1 / W1-T1):
  1. role must be a clinical role
  2. patient_id must exist (return 404 if not, to avoid leaking existence)
  3. emit audit log so post-hoc review can answer "who asked AI about whom"

This is intentionally NOT a unit/care-team check. The rest of the codebase
(see backend/app/routers/patients.py GET endpoints) treats authentication as
the boundary. A unit-level ACL belongs in a separate cross-system plan
covering /patients, /ai_chat, /medical-records together.
"""

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.audit import create_audit_log
from app.models.patient import Patient
from app.models.user import User

CLINICAL_ROLES = {"admin", "doctor", "np", "nurse", "pharmacist"}


async def assert_patient_chat_access(
    db: AsyncSession,
    user: User,
    patient_id: Optional[str],
    *,
    ip: Optional[str] = None,
) -> None:
    """Gate AI chat access to a patient.

    Raises:
        403 if user.role is not clinical.
        404 if patient_id is given but does not exist (does not differentiate
             from "no permission" to avoid leaking existence).

    No-op when patient_id is None (general chat without patient context).
    """
    if user.role not in CLINICAL_ROLES:
        await create_audit_log(
            db,
            user_id=user.id,
            user_name=user.name,
            role=user.role,
            action="ai_chat_access_denied",
            target=patient_id,
            status="failed",
            ip=ip,
            details={"reason": "non_clinical_role"},
        )
        raise HTTPException(status_code=403, detail="無 AI 對話權限")

    if patient_id is None:
        return

    result = await db.execute(select(Patient.id).where(Patient.id == patient_id))
    if result.scalar_one_or_none() is None:
        await create_audit_log(
            db,
            user_id=user.id,
            user_name=user.name,
            role=user.role,
            action="ai_chat_access_denied",
            target=patient_id,
            status="failed",
            ip=ip,
            details={"reason": "patient_not_found"},
        )
        raise HTTPException(status_code=404, detail="病患不存在")

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="ai_chat_patient_access",
        target=patient_id,
        status="success",
        ip=ip,
    )
