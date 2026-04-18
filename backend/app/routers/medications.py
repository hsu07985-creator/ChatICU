import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.medication import Medication
from app.models.medication_administration import MedicationAdministration
from app.models.user import User
from app.models.patient import Patient
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.schemas.medication import (
    MedicationAdministrationItemEnvelope,
    MedicationAdministrationListEnvelope,
    MedicationAdministrationUpdate,
    MedicationCreate,
    MedicationUpdate,
    OutpatientImportRequest,
)
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/medications", tags=["medications"])


def normalize_san_category(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    normalized = raw.strip().upper()
    if normalized in {"S", "A", "N"}:
        return normalized
    return None


def med_to_dict(med: Medication) -> dict:
    return {
        "id": med.id,
        "patientId": med.patient_id,
        "name": med.name,
        "genericName": med.generic_name,
        "orderCode": getattr(med, "order_code", None),
        "category": med.category,
        "sanCategory": normalize_san_category(med.san_category),
        "dose": med.dose,
        "unit": med.unit,
        "frequency": med.frequency,
        "route": med.route,
        "prn": med.prn,
        "indication": med.indication,
        "startDate": med.start_date.isoformat() if med.start_date else None,
        "endDate": med.end_date.isoformat() if med.end_date else None,
        "status": med.status,
        "prescribedBy": med.prescribed_by,
        "warnings": med.warnings or [],
        "notes": med.notes,
        "concentration": med.concentration,
        "concentrationUnit": med.concentration_unit,
        "sourceType": getattr(med, "source_type", None) or "inpatient",
        "sourceCampus": getattr(med, "source_campus", None),
        "prescribingHospital": getattr(med, "prescribing_hospital", None),
        "prescribingDepartment": getattr(med, "prescribing_department", None),
        "prescribingDoctorName": getattr(med, "prescribing_doctor_name", None),
        "daysSupply": getattr(med, "days_supply", None),
        "isExternal": getattr(med, "is_external", False) or False,
    }


async def _get_medication_or_404(
    db: AsyncSession,
    patient_id: str,
    medication_id: str,
) -> Medication:
    result = await db.execute(
        select(Medication).where(
            (Medication.id == medication_id) & (Medication.patient_id == patient_id)
        )
    )
    med = result.scalar_one_or_none()
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")
    return med


def administration_to_dict(administration: MedicationAdministration) -> dict:
    return {
        "id": administration.id,
        "medicationId": administration.medication_id,
        "patientId": administration.patient_id,
        "scheduledTime": administration.scheduled_time,
        "administeredTime": administration.administered_time,
        "status": administration.status,
        "dose": administration.dose or "",
        "route": administration.route or "",
        "administeredBy": administration.administered_by,
        "notes": administration.notes,
    }


@router.get("")
async def list_medications(
    patient_id: str,
    status_filter: str = Query(None, alias="status"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    # T09: verify patient access
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = pat_result.scalar_one_or_none()
    if not patient_obj:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    query = select(Medication).where(Medication.patient_id == pid)

    if status_filter and status_filter != "all":
        query = query.where(Medication.status == status_filter)

    result = await db.execute(query.order_by(Medication.name))
    medications = result.scalars().all()

    # Dynamic self-supplied detection (cross-reference at query time)
    inpatient_order_codes = set()
    for med in medications:
        if (getattr(med, "source_type", None) or "inpatient") == "inpatient":
            code = getattr(med, "order_code", None)
            if code:
                inpatient_order_codes.add(code)

    # Group by SAN category — keys match frontend MedicationsResponse interface
    _SAN_KEY_MAP = {"S": "sedation", "A": "analgesia", "N": "nmb"}
    grouped = {"sedation": [], "analgesia": [], "nmb": [], "other": [], "outpatient": []}
    all_meds: list = []
    for med in medications:
        d = med_to_dict(med)
        src = (getattr(med, "source_type", None) or "inpatient")
        # Cross-reference: outpatient + oral + same drug in inpatient → self-supplied
        if src == "outpatient":
            order_code = getattr(med, "order_code", None)
            route = getattr(med, "route", None) or ""
            notes = getattr(med, "notes", None) or ""
            if (route == "PO" and order_code in inpatient_order_codes) or "自備" in notes:
                d["sourceType"] = "self-supplied"
                d["isExternal"] = True
        elif src == "self-supplied":
            # Already marked by converter
            pass

        if d["sourceType"] in ("outpatient", "self-supplied"):
            grouped["outpatient"].append(d)
        else:
            cat = normalize_san_category(med.san_category) or "other"
            key = _SAN_KEY_MAP.get(cat, "other")
            grouped[key].append(d)
        all_meds.append(d)

    # Find drug interactions for active medications (safe — columns may be missing)
    active_meds = [m for m in medications if m.status == "active"]
    interactions = []
    try:
        if len(active_meds) >= 2:
            from sqlalchemy import text
            # Prefer generic_name (already normalised via ODR_CODE alias map at HIS import).
            # Combination drugs store multiple names joined by " / " (e.g. "Ampicillin / Sulbactam")
            # — expand them so each component is matched independently.
            seen: set = set()
            med_names: list = []
            for m in active_meds:
                raw = (m.generic_name or m.name or "").strip()
                for part in raw.split(" / "):
                    part = part.strip()
                    if part and part.lower() not in seen:
                        seen.add(part.lower())
                        med_names.append(part)
            int_result = await db.execute(
                text(
                    "SELECT id, drug1, drug2, severity, mechanism, "
                    "clinical_effect, management, risk_rating "
                    "FROM drug_interactions "
                    "WHERE drug1 = ANY(:names) AND drug2 = ANY(:names)"
                ),
                {"names": med_names},
            )
            for row in int_result:
                interactions.append({
                    "id": row[0],
                    "drug1": row[1],
                    "drug2": row[2],
                    "severity": row[3],
                    "mechanism": row[4],
                    "clinicalEffect": row[5],
                    "management": row[6],
                    "riskRating": row[7],
                })
    except Exception:
        interactions = []

    return success_response(data={
        "medications": all_meds,
        "grouped": grouped,
        "interactions": interactions,
    })


@router.get("/{medication_id}")
async def get_medication(
    patient_id: str,
    medication_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    med = await _get_medication_or_404(db, pid, medication_id)
    return success_response(data=med_to_dict(med))


@router.get(
    "/{medication_id}/administrations",
    response_model=MedicationAdministrationListEnvelope,
)
async def list_medication_administrations(
    patient_id: str,
    medication_id: str,
    start_date: Optional[date] = Query(None, alias="startDate"),
    end_date: Optional[date] = Query(None, alias="endDate"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="startDate cannot be after endDate")

    pid = normalize_patient_id(patient_id)
    med = await _get_medication_or_404(db, pid, medication_id)

    query = select(MedicationAdministration).where(
        (MedicationAdministration.medication_id == med.id)
        & (MedicationAdministration.patient_id == pid)
    )
    if start_date:
        start_at = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        query = query.where(MedicationAdministration.scheduled_time >= start_at)
    if end_date:
        end_exclusive = datetime.combine(
            end_date + timedelta(days=1),
            time.min,
            tzinfo=timezone.utc,
        )
        query = query.where(MedicationAdministration.scheduled_time < end_exclusive)

    result = await db.execute(query.order_by(MedicationAdministration.scheduled_time))
    administrations = [administration_to_dict(row) for row in result.scalars().all()]

    return success_response(data=administrations)


@router.post("")
async def create_medication(
    patient_id: str,
    body: MedicationCreate,
    request: Request,
    user: User = Depends(require_roles("doctor", "np", "admin")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    med = Medication(
        id=f"med_{uuid.uuid4().hex[:6]}",
        patient_id=pid,
        name=body.name,
        generic_name=body.genericName,
        category=body.category,
        san_category=normalize_san_category(body.sanCategory),
        dose=body.dose,
        unit=body.unit,
        frequency=body.frequency,
        route=body.route,
        prn=body.prn,
        indication=body.indication,
        start_date=body.startDate,
        concentration=body.concentration,
        concentration_unit=body.concentrationUnit,
        status="active",
        prescribed_by={"id": user.id, "name": user.name},
    )
    db.add(med)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="開立藥物處方", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"medication_id": med.id, "medication_name": body.name, "dose": body.dose},
    )

    return success_response(data=med_to_dict(med), message="藥物處方已建立")


@router.patch("/{medication_id}")
async def update_medication(
    patient_id: str,
    medication_id: str,
    body: MedicationUpdate,
    request: Request,
    user: User = Depends(require_roles("doctor", "np", "pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    med = await _get_medication_or_404(db, pid, medication_id)

    update_data = body.model_dump(exclude_unset=True)
    field_map = {
        "endDate": "end_date",
        "sanCategory": "san_category",
        "concentrationUnit": "concentration_unit",
    }
    for field_name, value in update_data.items():
        mapped_field = field_map.get(field_name, field_name)
        if mapped_field == "san_category":
            value = normalize_san_category(value)
        setattr(med, mapped_field, value)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="更新藥物", target=medication_id, status="success",
        ip=request.client.host if request.client else None,
        details={"fields_changed": list(update_data.keys())},
    )

    return success_response(data=med_to_dict(med), message="藥物已更新")


@router.patch(
    "/{medication_id}/administrations/{administration_id}",
    response_model=MedicationAdministrationItemEnvelope,
)
async def record_medication_administration(
    patient_id: str,
    medication_id: str,
    administration_id: str,
    body: MedicationAdministrationUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    med = await _get_medication_or_404(db, pid, medication_id)

    result = await db.execute(
        select(MedicationAdministration).where(
            (MedicationAdministration.id == administration_id)
            & (MedicationAdministration.medication_id == med.id)
            & (MedicationAdministration.patient_id == pid)
        )
    )
    administration = result.scalar_one_or_none()
    if not administration:
        raise HTTPException(status_code=404, detail="Administration not found")

    administration.status = body.status
    administration.notes = body.notes
    if body.status == "administered":
        administration.administered_time = administration.administered_time or datetime.now(
            timezone.utc
        )
        administration.administered_by = {"id": user.id, "name": user.name}
    else:
        administration.administered_time = None
        administration.administered_by = None

    await create_audit_log(
        db,
        user_id=user.id,
        user_name=user.name,
        role=user.role,
        action="記錄給藥",
        target=administration_id,
        status="success",
        ip=request.client.host if request.client else None,
        details={
            "medication_id": med.id,
            "administration_id": administration_id,
            "status": body.status,
        },
    )

    return success_response(
        data=administration_to_dict(administration),
        message="給藥記錄已更新",
    )


@router.post("/import-outpatient")
async def import_outpatient_medications(
    patient_id: str,
    body: OutpatientImportRequest,
    request: Request,
    user: User = Depends(require_roles("doctor", "np", "pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """Import outpatient medications (門診用藥) for a patient."""
    pid = normalize_patient_id(patient_id)
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = pat_result.scalar_one_or_none()
    if not patient_obj:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    created = []
    for item in body.medications:
        med = Medication(
            id=f"med_opd_{uuid.uuid4().hex[:6]}",
            patient_id=pid,
            name=item.name,
            generic_name=item.genericName,
            dose=item.dose,
            unit=item.unit,
            frequency=item.frequency,
            route=item.route,
            indication=item.indication,
            start_date=item.startDate,
            end_date=item.endDate,
            status="active",
            source_type="outpatient",
            source_campus=item.sourceCampus,
            prescribing_hospital=item.prescribingHospital,
            prescribing_department=item.prescribingDepartment,
            prescribing_doctor_name=item.prescribingDoctorName,
            days_supply=item.daysSupply,
            is_external=item.isExternal,
        )
        db.add(med)
        created.append(med)

    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="匯入門診用藥", target=pid, status="success",
        ip=request.client.host if request.client else None,
        details={"count": len(created), "names": [m.name for m in created]},
    )

    return success_response(
        data=[med_to_dict(m) for m in created],
        message=f"已匯入 {len(created)} 筆門診用藥",
    )
