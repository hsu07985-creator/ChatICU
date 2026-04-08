import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.audit import create_audit_log
from app.middleware.auth import get_current_user, require_roles
from app.models.error_report import ErrorReport
from app.models.user import User
from app.schemas.admin import ErrorReportCreate, ErrorReportUpdate
from app.utils.response import escape_like, success_response

router = APIRouter(tags=["pharmacy"])
logger = logging.getLogger(__name__)


def report_to_dict(r: ErrorReport) -> dict:
    return {
        "id": r.id,
        "patientId": r.patient_id,
        "reporterId": r.reporter_id,
        "reporterName": r.reporter_name,
        "reporterRole": r.reporter_role,
        "errorType": r.error_type,
        "severity": r.severity,
        "medicationName": r.medication_name,
        "description": r.description,
        "actionTaken": r.action_taken,
        "status": r.status,
        "reviewedBy": r.reviewed_by,
        "resolution": r.resolution,
        "timestamp": r.timestamp.isoformat() if r.timestamp else None,
    }


@router.get("/error-reports")
async def list_error_reports(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str = Query(None, alias="status"),
    severity: str = Query(None),
    error_type_filter: str = Query(None, alias="type"),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(ErrorReport)

    if status_filter:
        query = query.where(ErrorReport.status == status_filter)
    if severity:
        query = query.where(ErrorReport.severity == severity)
    if error_type_filter:
        query = query.where(ErrorReport.error_type.ilike(f"%{escape_like(error_type_filter)}%"))

    logger.info(
        "[INTG][API][DB] list_error_reports filters page=%s limit=%s status=%s severity=%s type=%s",
        page,
        limit,
        status_filter,
        severity,
        error_type_filter,
    )

    total_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(total_q)).scalar() or 0

    result = await db.execute(
        query.order_by(ErrorReport.timestamp.desc()).offset((page - 1) * limit).limit(limit)
    )
    reports = result.scalars().all()

    filtered = query.subquery()
    status_rows = (
        await db.execute(
            select(filtered.c.status, func.count()).group_by(filtered.c.status)
        )
    ).all()
    type_rows = (
        await db.execute(
            select(filtered.c.error_type, func.count()).group_by(filtered.c.error_type)
        )
    ).all()
    severity_rows = (
        await db.execute(
            select(filtered.c.severity, func.count()).group_by(filtered.c.severity)
        )
    ).all()

    status_counts = {k: int(v) for k, v in status_rows}
    by_type = {k: int(v) for k, v in type_rows}
    by_severity = {k: int(v) for k, v in severity_rows}

    return success_response(data={
        "reports": [report_to_dict(r) for r in reports],
        "total": total,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit,
        },
        "stats": {
            "total": total,
            "pending": status_counts.get("pending", 0),
            "resolved": status_counts.get("resolved", 0),
            "byType": by_type,
            "bySeverity": by_severity,
        },
    })


@router.post("/error-reports")
async def create_error_report(
    request: Request,
    body: ErrorReportCreate,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    report = ErrorReport(
        id=f"err_{uuid.uuid4().hex[:8]}",
        patient_id=body.patientId,
        reporter_id=user.id,
        reporter_name=user.name,
        reporter_role=user.role,
        error_type=body.errorType,
        severity=body.severity,
        medication_name=body.medicationName,
        description=body.description,
        action_taken=body.actionTaken,
        status="pending",
        timestamp=datetime.now(timezone.utc),
    )
    db.add(report)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="提交用藥異常通報", target=report.id, status="success",
        ip=request.client.host if request.client else None,
        details={"error_type": body.errorType, "severity": body.severity},
    )

    return success_response(data=report_to_dict(report), message="用藥異常通報已提交")


@router.get("/error-reports/{report_id}")
async def get_error_report(
    report_id: str,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ErrorReport).where(ErrorReport.id == report_id))
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Error report not found")

    return success_response(data=report_to_dict(report))


@router.patch("/error-reports/{report_id}")
async def update_error_report(
    report_id: str,
    body: ErrorReportUpdate,
    request: Request,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ErrorReport).where(ErrorReport.id == report_id))
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Error report not found")

    if body.status:
        report.status = body.status
    if body.resolution:
        report.resolution = body.resolution
        report.reviewed_by = {"id": user.id, "name": user.name}

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="更新用藥異常通報", target=report_id, status="success",
        ip=request.client.host if request.client else None,
        details={"new_status": body.status, "has_resolution": bool(body.resolution)},
    )

    return success_response(data=report_to_dict(report), message="通報已更新")


# NOTE: Despite the path name, this endpoint aggregates ErrorReport (用藥錯誤通報),
# not PharmacyAdvice. Kept for backwards compatibility.
@router.get("/advice-statistics")
async def get_advice_statistics(
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    total_result = await db.execute(select(func.count()).select_from(ErrorReport))
    total = total_result.scalar() or 0

    resolved_result = await db.execute(
        select(func.count()).select_from(
            select(ErrorReport).where(ErrorReport.status == "resolved").subquery()
        )
    )
    resolved = resolved_result.scalar() or 0

    severity_result = await db.execute(
        select(ErrorReport.severity, func.count(ErrorReport.id))
        .group_by(ErrorReport.severity)
    )
    severity_counts = {row[0]: row[1] for row in severity_result if row[0]}

    return success_response(data={
        "totalReports": total,
        "resolvedRate": round(resolved / total, 2) if total > 0 else 0,
        "severityCounts": severity_counts,
    })
