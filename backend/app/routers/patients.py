import uuid
from datetime import datetime, timezone

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.patient import Patient
from app.models.culture_result import CultureResult
from app.models.message import PatientMessage
from app.models.user import User
from app.schemas.patient import PatientArchiveUpdate, PatientCreate, PatientUpdate
from app.utils.response import escape_like, success_response

router = APIRouter(prefix="/patients", tags=["patients"])


def patient_to_dict(patient: Patient, unread_count: int = 0) -> dict:
    return {
        "id": patient.id,
        "name": patient.name,
        "bedNumber": patient.bed_number,
        "medicalRecordNumber": patient.medical_record_number,
        "age": patient.age,
        "gender": patient.gender,
        "height": patient.height,
        "weight": patient.weight,
        "bmi": patient.bmi,
        "diagnosis": patient.diagnosis,
        "symptoms": patient.symptoms or [],
        "intubated": patient.intubated,
        "criticalStatus": patient.critical_status,
        "sedation": patient.sedation or [],
        "analgesia": patient.analgesia or [],
        "nmb": patient.nmb or [],
        "admissionDate": patient.admission_date.isoformat() if patient.admission_date else None,
        "icuAdmissionDate": patient.icu_admission_date.isoformat() if patient.icu_admission_date else None,
        "ventilatorDays": patient.ventilator_days,
        "attendingPhysician": patient.attending_physician,
        "department": patient.department,
        "unit": patient.unit,
        "alerts": patient.alerts or [],
        "consentStatus": patient.consent_status,
        "allergies": patient.allergies or [],
        "bloodType": patient.blood_type,
        "codeStatus": patient.code_status,
        "hasDNR": patient.has_dnr,
        "isIsolated": patient.is_isolated,
        "hasUnreadMessages": unread_count > 0,
        "lastUpdate": patient.last_update.isoformat() if patient.last_update else None,
    }


def normalize_patient_id(patient_id: str) -> str:
    if patient_id.startswith("pat_"):
        return patient_id
    return f"pat_{patient_id.zfill(3)}"


def verify_patient_access(user: User, patient: "Patient") -> None:
    """T09: Verify the user has access to this patient's data.

    Raises HTTPException 403 if access is denied.
    Admin and pharmacist roles have full access.
    """
    if user.role in ("admin", "pharmacist"):
        return
    has_access = False
    if user.role == "doctor":
        if (user.unit and user.unit in (patient.unit or "")) or \
           (user.name in (patient.attending_physician or "")):
            has_access = True
    else:
        if user.unit and user.unit in (patient.unit or ""):
            has_access = True
    if not has_access:
        raise HTTPException(status_code=403, detail="無權限查看此病患資料")


@router.get("")
async def list_patients(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    intubated: bool = Query(None),
    criticalStatus: str = Query(None),
    department: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Patient).where(Patient.archived == False)

    # ── T09: Data-level access control — non-admin users see their unit's patients ──
    if user.role not in ("admin", "pharmacist"):
        # Doctors: see patients they attend OR in their unit
        if user.role == "doctor":
            query = query.where(
                or_(
                    Patient.unit.ilike(f"%{escape_like(user.unit)}%") if user.unit else False,
                    Patient.attending_physician.ilike(f"%{escape_like(user.name)}%"),
                )
            )
        else:
            # Nurses and other roles: see patients in their unit only
            if user.unit:
                query = query.where(Patient.unit.ilike(f"%{escape_like(user.unit)}%"))

    if search:
        query = query.where(
            or_(
                Patient.name.ilike(f"%{escape_like(search)}%"),
                Patient.bed_number.ilike(f"%{escape_like(search)}%"),
                Patient.medical_record_number.ilike(f"%{escape_like(search)}%"),
            )
        )
    if intubated is not None:
        query = query.where(Patient.intubated == intubated)
    if criticalStatus:
        query = query.where(Patient.critical_status == criticalStatus)
    if department:
        query = query.where(Patient.department.ilike(f"%{escape_like(department)}%"))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit).order_by(Patient.bed_number)
    result = await db.execute(query)
    patients = result.scalars().all()

    # Get unread message counts
    patient_ids = [p.id for p in patients]
    unread_counts = {}
    if patient_ids:
        unread_query = (
            select(PatientMessage.patient_id, func.count(PatientMessage.id))
            .where(PatientMessage.patient_id.in_(patient_ids))
            .where(PatientMessage.is_read == False)
            .group_by(PatientMessage.patient_id)
        )
        unread_result = await db.execute(unread_query)
        for pid, count in unread_result:
            unread_counts[pid] = count

    patient_list = [
        patient_to_dict(p, unread_counts.get(p.id, 0)) for p in patients
    ]

    return success_response(data={
        "patients": patient_list,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit,
        },
    })


@router.post("")
async def create_patient(
    request: Request,
    body: PatientCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_id = f"pat_{uuid.uuid4().hex[:6]}"
    bmi = None
    if body.height and body.weight and body.height > 0:
        bmi = round(body.weight / ((body.height / 100) ** 2), 1)

    patient = Patient(
        id=patient_id,
        name=body.name,
        bed_number=body.bed_number,
        medical_record_number=body.medical_record_number,
        age=body.age,
        gender=body.gender,
        height=body.height,
        weight=body.weight,
        bmi=bmi,
        diagnosis=body.diagnosis,
        symptoms=body.symptoms,
        intubated=body.intubated,
        critical_status=body.critical_status,
        sedation=body.sedation,
        analgesia=body.analgesia,
        nmb=body.nmb,
        admission_date=body.admission_date,
        icu_admission_date=body.icu_admission_date,
        ventilator_days=body.ventilator_days,
        attending_physician=body.attending_physician,
        department=body.department,
        alerts=body.alerts,
        consent_status=body.consent_status,
        allergies=body.allergies,
        blood_type=body.blood_type,
        code_status=body.code_status,
        has_dnr=body.has_dnr,
        is_isolated=body.is_isolated,
        # Keep access-control workable for demo: default to creator's unit (or ICU-1 for admin).
        unit=(
            body.unit
            or (user.unit if (user.unit and user.unit != "系統管理") else "加護病房一")
        ),
        last_update=datetime.now(timezone.utc),
    )
    db.add(patient)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立病患", target=patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"patient_name": body.name, "bed": body.bed_number},
    )

    return success_response(data=patient_to_dict(patient), message="病患建立成功")


@router.get("/{patient_id}")
async def get_patient(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    verify_patient_access(user, patient)

    unread_query = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.patient_id == pid)
        .where(PatientMessage.is_read == False)
    )
    unread_result = await db.execute(unread_query)
    unread_count = unread_result.scalar() or 0

    return success_response(data=patient_to_dict(patient, unread_count))


@router.patch("/{patient_id}")
async def update_patient(
    patient_id: str,
    body: PatientUpdate,
    request: Request,
    user: User = Depends(require_roles("admin", "doctor", "nurse")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    update_data = body.model_dump(exclude_unset=True)
    field_mapping = {
        "bed_number": "bed_number",
        "medical_record_number": "medical_record_number",
        "critical_status": "critical_status",
        "attending_physician": "attending_physician",
        "admission_date": "admission_date",
        "icu_admission_date": "icu_admission_date",
        "ventilator_days": "ventilator_days",
        "has_dnr": "has_dnr",
        "is_isolated": "is_isolated",
        "code_status": "code_status",
    }

    for key, value in update_data.items():
        db_key = field_mapping.get(key, key)
        setattr(patient, db_key, value)

    patient.last_update = datetime.now(timezone.utc)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="更新病患資料", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"fields_changed": list(update_data.keys())},
    )

    return success_response(data=patient_to_dict(patient), message="病患資料已更新")


@router.patch("/{patient_id}/archive")
async def archive_patient(
    patient_id: str,
    request: Request,
    body: Optional[PatientArchiveUpdate] = None,
    user: User = Depends(require_roles("admin", "doctor")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if body is not None:
        patient.archived = body.archived
    else:
        patient.archived = not patient.archived
    status_text = "已歸檔" if patient.archived else "已取消歸檔"

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="病患歸檔", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"archived": patient.archived, "reason": getattr(body, "reason", None)},
    )

    return success_response(data=patient_to_dict(patient), message=f"病患{status_text}")


@router.get("/{patient_id}/cultures")
async def get_cultures(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    del user
    pid = patient_id.strip()
    result = await db.execute(
        select(CultureResult)
        .where(CultureResult.patient_id == pid)
        .order_by(CultureResult.collected_at.desc())
    )
    rows = result.scalars().all()
    cultures = [
        {
            "sheetNumber": r.sheet_number,
            "specimen": r.specimen,
            "specimenCode": r.specimen_code,
            "collectedAt": r.collected_at.isoformat() if r.collected_at else None,
            "reportedAt": r.reported_at.isoformat() if r.reported_at else None,
            "department": r.department,
            "isolates": r.isolates or [],
            "susceptibility": r.susceptibility or [],
        }
        for r in rows
    ]
    return success_response(data={
        "patientId": pid,
        "cultureCount": len(cultures),
        "cultures": cultures,
    })
