import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.medication import Medication
from app.models.drug_interaction import DrugInteraction
from app.models.user import User
from app.routers.patients import normalize_patient_id
from app.schemas.medication import (
    MedicationAdministrationItemEnvelope,
    MedicationAdministrationListEnvelope,
    MedicationAdministrationUpdate,
    MedicationCreate,
    MedicationUpdate,
)
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/medications", tags=["medications"])


_ADMINISTRATION_OVERRIDES: dict[str, dict[str, dict[str, Any]]] = {}


def med_to_dict(med: Medication) -> dict:
    return {
        "id": med.id,
        "patientId": med.patient_id,
        "name": med.name,
        "genericName": med.generic_name,
        "category": med.category,
        "sanCategory": med.san_category,
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


def _format_dose_with_unit(med: Medication) -> str:
    if med.dose and med.unit:
        return f"{med.dose} {med.unit}"
    return med.dose or ""


def _build_default_administrations(med: Medication) -> list[dict[str, Any]]:
    base_date = med.start_date or datetime.now(timezone.utc).date()
    dose = _format_dose_with_unit(med)
    schedule_template = [
        (1, 8, "administered"),
        (2, 12, "scheduled"),
        (3, 16, "scheduled"),
    ]
    administrations: list[dict[str, Any]] = []

    for idx, hour, status in schedule_template:
        scheduled_dt = datetime.combine(base_date, time(hour=hour, tzinfo=timezone.utc))
        administered_time = (
            (scheduled_dt + timedelta(minutes=5)).isoformat()
            if status == "administered"
            else None
        )
        administrations.append(
            {
                "id": f"adm_{med.id}_{idx}",
                "medicationId": med.id,
                "patientId": med.patient_id,
                "scheduledTime": scheduled_dt.isoformat(),
                "administeredTime": administered_time,
                "status": status,
                "dose": dose,
                "route": med.route or "",
                "administeredBy": med.prescribed_by,
                "notes": None,
            }
        )

    return administrations


def _get_merged_administrations(med: Medication) -> list[dict[str, Any]]:
    defaults = _build_default_administrations(med)
    overrides = _ADMINISTRATION_OVERRIDES.get(med.id, {})
    merged: list[dict[str, Any]] = []

    for row in defaults:
        merged_row = {**row, **overrides.get(row["id"], {})}
        merged.append(merged_row)

    return merged


@router.get("")
async def list_medications(
    patient_id: str,
    status_filter: str = Query(None, alias="status"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    query = select(Medication).where(Medication.patient_id == pid)

    if status_filter and status_filter != "all":
        query = query.where(Medication.status == status_filter)

    result = await db.execute(query.order_by(Medication.name))
    medications = result.scalars().all()

    # Group by SAN category — keys match frontend MedicationsResponse interface
    _SAN_KEY_MAP = {"S": "sedation", "A": "analgesia", "N": "nmb"}
    grouped = {"sedation": [], "analgesia": [], "nmb": [], "other": []}
    for med in medications:
        cat = med.san_category or "other"
        key = _SAN_KEY_MAP.get(cat, "other")
        grouped[key].append(med_to_dict(med))

    # Find drug interactions for active medications
    active_meds = [m for m in medications if m.status == "active"]
    interactions = []
    if len(active_meds) >= 2:
        med_names = [m.name for m in active_meds]
        for i in range(len(med_names)):
            for j in range(i + 1, len(med_names)):
                int_result = await db.execute(
                    select(DrugInteraction).where(
                        ((DrugInteraction.drug1 == med_names[i]) & (DrugInteraction.drug2 == med_names[j]))
                        | ((DrugInteraction.drug1 == med_names[j]) & (DrugInteraction.drug2 == med_names[i]))
                    )
                )
                for interaction in int_result.scalars():
                    interactions.append({
                        "id": interaction.id,
                        "drug1": interaction.drug1,
                        "drug2": interaction.drug2,
                        "severity": interaction.severity,
                        "mechanism": interaction.mechanism,
                        "clinicalEffect": interaction.clinical_effect,
                        "management": interaction.management,
                    })

    return success_response(data={
        "medications": [med_to_dict(m) for m in medications],
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
    start_date: date | None = Query(None, alias="startDate"),
    end_date: date | None = Query(None, alias="endDate"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="startDate cannot be after endDate")

    pid = normalize_patient_id(patient_id)
    med = await _get_medication_or_404(db, pid, medication_id)

    administrations = _get_merged_administrations(med)
    if start_date or end_date:
        filtered: list[dict[str, Any]] = []
        for item in administrations:
            scheduled_date = datetime.fromisoformat(item["scheduledTime"]).date()
            if start_date and scheduled_date < start_date:
                continue
            if end_date and scheduled_date > end_date:
                continue
            filtered.append(item)
        administrations = filtered

    return success_response(data=administrations)


@router.post("")
async def create_medication(
    patient_id: str,
    body: MedicationCreate,
    request: Request,
    user: User = Depends(require_roles("doctor")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    med = Medication(
        id=f"med_{uuid.uuid4().hex[:6]}",
        patient_id=pid,
        name=body.name,
        generic_name=body.genericName,
        category=body.category,
        san_category=body.sanCategory,
        dose=body.dose,
        unit=body.unit,
        frequency=body.frequency,
        route=body.route,
        prn=body.prn,
        indication=body.indication,
        start_date=body.startDate,
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
    user: User = Depends(require_roles("doctor", "pharmacist")),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    med = await _get_medication_or_404(db, pid, medication_id)

    update_data = body.model_dump(exclude_unset=True)
    field_mapping = {
        "endDate": "end_date",
    }
    for key, value in update_data.items():
        db_key = field_mapping.get(key, key)
        setattr(med, db_key, value)

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

    administrations = _get_merged_administrations(med)
    existing = next((item for item in administrations if item["id"] == administration_id), None)
    if not existing:
        raise HTTPException(status_code=404, detail="Administration not found")

    updated = {
        **existing,
        "status": body.status,
        "notes": body.notes,
    }
    if body.status == "administered":
        updated["administeredTime"] = existing.get("administeredTime") or datetime.now(
            timezone.utc
        ).isoformat()
    else:
        updated["administeredTime"] = None

    _ADMINISTRATION_OVERRIDES.setdefault(med.id, {})[administration_id] = updated

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

    return success_response(data=updated, message="給藥記錄已更新")
