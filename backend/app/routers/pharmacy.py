import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.drug_interaction import DrugInteraction, IVCompatibility
from app.models.error_report import ErrorReport
from app.models.pharmacy_advice import PharmacyAdvice
from app.models.patient import Patient
from app.models.user import User
from app.schemas.admin import AdviceRecordCreate, ErrorReportCreate, ErrorReportUpdate
from app.utils.response import success_response

router = APIRouter(prefix="/pharmacy", tags=["pharmacy"])


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
    status_filter: str = Query(None, alias="status"),
    severity: str = Query(None),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(ErrorReport)

    if status_filter:
        query = query.where(ErrorReport.status == status_filter)
    if severity:
        query = query.where(ErrorReport.severity == severity)

    result = await db.execute(query.order_by(ErrorReport.timestamp.desc()))
    reports = result.scalars().all()

    return success_response(data={
        "reports": [report_to_dict(r) for r in reports],
        "total": len(reports),
    })


@router.post("/error-reports")
async def create_error_report(
    request: Request,
    body: ErrorReportCreate,
    user: User = Depends(get_current_user),
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


@router.get("/advice-statistics")
async def get_advice_statistics(
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    # Real statistics computed from error_reports table
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


# ============ PHARMACY ADVICE RECORDS ============


def advice_to_dict(a: PharmacyAdvice) -> dict:
    return {
        "id": a.id,
        "patientId": a.patient_id,
        "patientName": a.patient_name,
        "bedNumber": a.bed_number,
        "adviceCode": a.advice_code,
        "adviceLabel": a.advice_label,
        "category": a.category,
        "content": a.content,
        "pharmacistName": a.pharmacist_name,
        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
        "linkedMedications": a.linked_medications or [],
    }


@router.get("/advice-records")
async def list_advice_records(
    month: str = Query(None, description="YYYY-MM format filter"),
    category: str = Query(None, description="Category filter"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(PharmacyAdvice)

    if month:
        # Filter by year-month (YYYY-MM)
        try:
            year, mon = month.split("-")
            year_int, mon_int = int(year), int(mon)
            from datetime import datetime as dt
            start = dt(year_int, mon_int, 1, tzinfo=timezone.utc)
            if mon_int == 12:
                end = dt(year_int + 1, 1, 1, tzinfo=timezone.utc)
            else:
                end = dt(year_int, mon_int + 1, 1, tzinfo=timezone.utc)
            query = query.where(
                PharmacyAdvice.timestamp >= start,
                PharmacyAdvice.timestamp < end,
            )
        except (ValueError, AttributeError):
            pass  # Skip invalid month format

    if category:
        query = query.where(PharmacyAdvice.category == category)

    query = query.order_by(PharmacyAdvice.timestamp.desc())

    # Count total before pagination
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    records = result.scalars().all()

    return success_response(data={
        "records": [advice_to_dict(a) for a in records],
        "total": total,
    })


@router.post("/advice-records")
async def create_advice_record(
    request: Request,
    body: AdviceRecordCreate,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    # Look up patient for denormalized fields
    pat_result = await db.execute(select(Patient).where(Patient.id == body.patientId))
    patient = pat_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="病患不存在")

    advice = PharmacyAdvice(
        id=f"adv_{uuid.uuid4().hex[:8]}",
        patient_id=patient.id,
        patient_name=patient.name,
        bed_number=patient.bed_number,
        pharmacist_id=user.id,
        pharmacist_name=user.name,
        advice_code=body.adviceCode,
        advice_label=body.adviceLabel,
        category=body.category,
        content=body.content,
        linked_medications=body.linkedMedications,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(advice)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立用藥建議", target=advice.id, status="success",
        ip=request.client.host if request.client else None,
        details={"advice_code": body.adviceCode, "category": body.category},
    )

    return success_response(data=advice_to_dict(advice), message="用藥建議已建立")


# ============ DRUG INTERACTIONS ============

@router.get("/drug-interactions")
async def search_drug_interactions(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import or_

    query = select(DrugInteraction).where(
        or_(
            DrugInteraction.drug1.ilike(f"%{drugA}%"),
            DrugInteraction.drug2.ilike(f"%{drugA}%"),
        )
    )
    if drugB:
        query = query.where(
            or_(
                DrugInteraction.drug1.ilike(f"%{drugB}%"),
                DrugInteraction.drug2.ilike(f"%{drugB}%"),
            )
        )

    result = await db.execute(query)
    interactions = result.scalars().all()

    return success_response(data={
        "interactions": [
            {
                "id": i.id,
                "drug1": i.drug1,
                "drug2": i.drug2,
                "severity": i.severity,
                "mechanism": i.mechanism,
                "clinicalEffect": i.clinical_effect,
                "management": i.management,
                "references": i.references,
            }
            for i in interactions
        ],
        "total": len(interactions),
    })


# ============ IV COMPATIBILITY ============

@router.get("/iv-compatibility")
async def search_iv_compatibility(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(..., min_length=1),
    solution: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import or_

    query = select(IVCompatibility).where(
        or_(
            IVCompatibility.drug1.ilike(f"%{drugA}%") & IVCompatibility.drug2.ilike(f"%{drugB}%"),
            IVCompatibility.drug1.ilike(f"%{drugB}%") & IVCompatibility.drug2.ilike(f"%{drugA}%"),
        )
    )
    if solution and solution != "none":
        query = query.where(IVCompatibility.solution == solution)

    result = await db.execute(query)
    compatibilities = result.scalars().all()

    return success_response(data={
        "compatibilities": [
            {
                "id": c.id,
                "drug1": c.drug1,
                "drug2": c.drug2,
                "solution": c.solution,
                "compatible": c.compatible,
                "timeStability": c.time_stability,
                "notes": c.notes,
                "references": c.references,
            }
            for c in compatibilities
        ],
        "total": len(compatibilities),
    })
