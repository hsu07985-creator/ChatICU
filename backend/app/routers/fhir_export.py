"""FHIR Bundle export endpoints (PR-5).

GET /patients/{patient_id}/fhir-bundle  → FHIR R5 Bundle for one patient.

Restricted to doctor / pharmacist / admin. Every export is audit-logged so
the origin of any external data hand-off is traceable.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.fhir.bundle_builder import build_bundle_for_patient
from app.middleware.audit import create_audit_log
from app.middleware.auth import require_roles
from app.models.patient import Patient
from app.models.user import User
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.utils.response import success_response


router = APIRouter(prefix="/patients", tags=["fhir"])


@router.get("/{patient_id}/fhir-bundle")
async def export_patient_fhir_bundle(
    patient_id: str,
    request: Request,
    user: User = Depends(require_roles("doctor", "np", "pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """Return a FHIR R5 collection Bundle for the patient.

    Resources included: Patient, MedicationRequest[], Observation[] (from lab_data).
    Medications carry ATC codes where populated (see PR-1, PR-2, PR-3.5).
    """
    pid = normalize_patient_id(patient_id)
    r = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = r.scalar_one_or_none()
    if not patient_obj:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    try:
        bundle, report = await build_bundle_for_patient(db, pid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="匯出 FHIR Bundle",
        target=pid,
        status="success",
        ip=request.client.host if request.client else None,
        details={
            "resource_counts": report["resource_counts"],
            "total_resources": report["total_resources"],
        },
    )

    return success_response(data={"bundle": bundle, "report": report})
