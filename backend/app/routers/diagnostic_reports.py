from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.diagnostic_report import DiagnosticReport
from app.models.patient import Patient
from app.models.user import User
from app.schemas.diagnostic_report import DiagnosticReportResponse
from app.utils.patient_access import normalize_patient_id, verify_patient_access
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/diagnostic-reports", tags=["diagnostic-reports"])


def report_to_dict(r: DiagnosticReport) -> dict:
    """B2 batch 2: schema is the single source of the field mapping."""
    return DiagnosticReportResponse.model_validate(r).dump_camel()


@router.get("")
async def list_diagnostic_reports(
    patient_id: str,
    report_type: Optional[str] = Query(None, alias="type"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List diagnostic reports (imaging, procedures, etc.) for a patient."""
    patient_id = normalize_patient_id(patient_id)
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient)

    query = select(DiagnosticReport).where(
        DiagnosticReport.patient_id == patient_id
    ).order_by(DiagnosticReport.exam_date.desc())

    if report_type:
        query = query.where(DiagnosticReport.report_type == report_type)

    result = await db.execute(query)
    reports = result.scalars().all()

    return success_response(data=[report_to_dict(r) for r in reports])
