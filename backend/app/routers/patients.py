import logging
import uuid
from datetime import datetime, timezone

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

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


def patient_to_dict(patient: Patient, unread_count: int = 0, intubation_date=None) -> dict:
    # Auto-calculate ventilator_days from intubation_date when available
    vent_days = patient.ventilator_days
    if intubation_date and patient.intubated:
        today = datetime.now(timezone.utc).date()
        if isinstance(intubation_date, str):
            from datetime import date as _date
            intubation_date = _date.fromisoformat(intubation_date)
        vent_days = max((today - intubation_date).days, 0)

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
        "intubationDate": intubation_date.isoformat() if intubation_date and hasattr(intubation_date, 'isoformat') else intubation_date,
        "criticalStatus": patient.critical_status,
        "sedation": patient.sedation or [],
        "analgesia": patient.analgesia or [],
        "nmb": patient.nmb or [],
        "admissionDate": patient.admission_date.isoformat() if patient.admission_date else None,
        "icuAdmissionDate": patient.icu_admission_date.isoformat() if patient.icu_admission_date else None,
        "ventilatorDays": vent_days,
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
        "lastUpdate": (patient.last_update or patient.updated_at).isoformat() if (patient.last_update or patient.updated_at) else None,
    }


async def _fetch_intubation_dates(db: AsyncSession, patient_ids: list) -> dict:
    """Fetch intubation_date via raw SQL (column not in ORM to avoid async issues)."""
    if not patient_ids:
        return {}
    try:
        nested = await db.begin_nested()
        try:
            result = await db.execute(
                text("SELECT id, intubation_date FROM patients WHERE id = ANY(:ids)"),
                {"ids": patient_ids},
            )
            data = {row[0]: row[1] for row in result if row[1] is not None}
            await nested.commit()
            return data
        except Exception:
            await nested.rollback()
            return {}
    except Exception as exc:
        logger.warning("_fetch_intubation_dates failed: %s", exc)
        return {}


def normalize_patient_id(patient_id: str) -> str:
    if patient_id.startswith("pat_"):
        return patient_id
    return f"pat_{patient_id.zfill(3)}"


def verify_patient_access(user: User, patient: "Patient") -> None:
    """Verify the user has access to this patient's data.

    All authenticated users can access all patients (shared ICU).
    """
    return


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

    # Fetch intubation_dates via raw SQL (not in ORM model)
    intub_dates = await _fetch_intubation_dates(db, patient_ids)

    patient_list = [
        patient_to_dict(p, unread_counts.get(p.id, 0), intubation_date=intub_dates.get(p.id))
        for p in patients
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

    # Set intubation_date via raw SQL if provided (savepoint to avoid aborting transaction)
    if body.intubation_date:
        try:
            nested = await db.begin_nested()
            try:
                await db.execute(
                    text("UPDATE patients SET intubation_date = :val WHERE id = :pid"),
                    {"val": body.intubation_date, "pid": patient_id},
                )
                await nested.commit()
            except Exception as exc:
                logger.warning("create_patient intubation_date failed: %s", exc)
                await nested.rollback()
        except Exception as exc:
            logger.warning("create_patient savepoint setup failed: %s", exc)

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

    intub_dates = await _fetch_intubation_dates(db, [pid])
    return success_response(data=patient_to_dict(patient, unread_count, intubation_date=intub_dates.get(pid)))


@router.patch("/{patient_id}")
async def update_patient(
    patient_id: str,
    body: PatientUpdate,
    request: Request,
    user: User = Depends(require_roles("admin", "doctor", "np", "nurse")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    update_data = body.model_dump(exclude_unset=True)
    logger.info("update_patient %s fields=%s", pid, list(update_data.keys()))

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
        "height": "height",
        "weight": "weight",
    }

    # Extract intubation_date before ORM loop (not in ORM model)
    intub_date_val = update_data.pop("intubation_date", None)

    for key, value in update_data.items():
        db_key = field_mapping.get(key, key)
        setattr(patient, db_key, value)

    # Auto-recalculate BMI when height or weight changes
    h = patient.height
    w = patient.weight
    if h and w and h > 0:
        patient.bmi = round(w / ((h / 100) ** 2), 1)
    elif not h or not w:
        patient.bmi = None

    # Handle intubation_date via raw SQL (use savepoint to avoid aborting transaction)
    if intub_date_val is not None or "intubation_date" in body.model_fields_set:
        try:
            nested = await db.begin_nested()
            try:
                await db.execute(
                    text("UPDATE patients SET intubation_date = :val WHERE id = :pid"),
                    {"val": intub_date_val, "pid": pid},
                )
                await nested.commit()
            except Exception as exc:
                logger.warning("intubation_date UPDATE failed (savepoint rollback): %s", exc)
                await nested.rollback()
        except Exception as exc:
            logger.warning("intubation_date savepoint setup failed: %s", exc)

    # Auto-calculate ventilator_days from intubation_date
    intub_dates = await _fetch_intubation_dates(db, [pid])
    intub_date = intub_dates.get(pid)
    if intub_date and patient.intubated:
        today = datetime.now(timezone.utc).date()
        patient.ventilator_days = max((today - intub_date).days, 0)

    patient.last_update = datetime.now(timezone.utc)

    # Flush ORM changes before audit log to catch DB errors early
    try:
        await db.flush()
    except Exception as exc:
        logger.error("update_patient flush failed for %s: %s", pid, exc, exc_info=True)
        raise

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="更新病患資料", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"fields_changed": list(update_data.keys())},
    )

    return success_response(data=patient_to_dict(patient, intubation_date=intub_date), message="病患資料已更新")


@router.patch("/{patient_id}/archive")
async def archive_patient(
    patient_id: str,
    request: Request,
    body: Optional[PatientArchiveUpdate] = None,
    user: User = Depends(require_roles("admin", "doctor", "np")),
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


@router.delete("/{patient_id}")
async def discharge_patient(
    patient_id: str,
    request: Request,
    user: User = Depends(require_roles("admin", "doctor", "np", "pharmacist")),
    db: AsyncSession = Depends(get_db),
):
    """出院：永久刪除病人及所有關聯資料。"""
    pid = normalize_patient_id(patient_id)
    result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = result.scalar_one_or_none()

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient_name = patient.name

    # Delete all related records (FK RESTRICT requires manual deletion)
    from app.models.medication import Medication, MedicationAdministration
    from app.models.lab_data import LabData
    from app.models.vital_sign import VitalSign
    from app.models.ventilator import VentilatorSetting, WeaningAssessment
    from app.models.symptom_record import SymptomRecord
    from app.models.diagnostic_report import DiagnosticReport
    from app.models.clinical_score import ClinicalScore
    from app.models.pharmacy_advice import PharmacyAdvice

    # medication_administrations first (has FK to both medications AND patients)
    await db.execute(
        delete(MedicationAdministration).where(MedicationAdministration.patient_id == pid)
    )

    for model in (
        Medication, LabData, VitalSign, VentilatorSetting, WeaningAssessment,
        CultureResult, PatientMessage, SymptomRecord, DiagnosticReport,
        ClinicalScore, PharmacyAdvice,
    ):
        await db.execute(delete(model).where(model.patient_id == pid))

    await db.delete(patient)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="病患出院刪除", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"patient_name": patient_name},
    )

    return success_response(data={"id": pid}, message=f"病患 {patient_name} 已出院刪除")


@router.get("/{patient_id}/cultures")
async def get_cultures(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    del user
    pid = patient_id.strip()

    # Single query — fetch all columns including q_score/result (safe fallback if missing)
    from sqlalchemy import text
    try:
        raw = await db.execute(
            text(
                "SELECT id, sheet_number, specimen, specimen_code, collected_at, "
                "reported_at, department, isolates, susceptibility, q_score, result "
                "FROM culture_results WHERE patient_id = :pid "
                "ORDER BY collected_at DESC"
            ),
            {"pid": pid},
        )
        rows = raw.fetchall()
    except Exception:
        # q_score/result columns may not exist — fall back to ORM without them
        result = await db.execute(
            select(CultureResult)
            .where(CultureResult.patient_id == pid)
            .order_by(CultureResult.collected_at.desc())
        )
        orm_rows = result.scalars().all()
        rows = None

    if rows is not None:
        cultures = [
            {
                "sheetNumber": r[1],
                "specimen": r[2],
                "specimenCode": r[3],
                "collectedAt": r[4].isoformat() if r[4] else None,
                "reportedAt": r[5].isoformat() if r[5] else None,
                "department": r[6],
                "isolates": r[7] or [],
                "susceptibility": r[8] or [],
                "qScore": r[9],
                "result": r[10],
            }
            for r in rows
        ]
    else:
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
                "qScore": getattr(r, "q_score", None),
                "result": getattr(r, "result", None),
            }
            for r in orm_rows
        ]
    return success_response(data={
        "patientId": pid,
        "cultureCount": len(cultures),
        "cultures": cultures,
    })
