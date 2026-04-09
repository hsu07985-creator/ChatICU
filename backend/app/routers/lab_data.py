import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.lab_data import LabData
from app.models.user import User
from app.models.patient import Patient
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.schemas.lab_data import LabCorrectionRequest
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/lab-data", tags=["lab-data"])


def lab_to_dict(lab: LabData) -> dict:
    return {
        "id": lab.id,
        "patientId": lab.patient_id,
        "timestamp": lab.timestamp.isoformat() if lab.timestamp else None,
        "biochemistry": lab.biochemistry,
        "hematology": lab.hematology,
        "bloodGas": lab.blood_gas,
        "venousBloodGas": lab.venous_blood_gas or {},
        "inflammatory": lab.inflammatory,
        "coagulation": lab.coagulation,
        "cardiac": lab.cardiac,
        "thyroid": lab.thyroid,
        "hormone": lab.hormone,
        "lipid": lab.lipid,
        "other": lab.other,
        "corrections": lab.corrections,
    }


_CATEGORY_COLS = [
    "biochemistry", "hematology", "blood_gas", "venous_blood_gas",
    "inflammatory", "coagulation", "cardiac", "thyroid", "hormone",
    "lipid", "other",
]
_COL_TO_CAMEL = {
    "blood_gas": "bloodGas",
    "venous_blood_gas": "venousBloodGas",
}


def _merge_latest_categories(labs: list) -> dict:
    """Merge the most recent non-null value for each category across records.

    HIS data produces one record per blood draw, each with only a few
    categories filled.  The frontend expects a single composite object.
    """
    merged: dict = {}
    latest_ts = None
    for lab in labs:  # already ordered desc by timestamp
        if latest_ts is None and lab.timestamp:
            latest_ts = lab.timestamp
        for col in _CATEGORY_COLS:
            camel = _COL_TO_CAMEL.get(col, col)
            if camel in merged:
                continue
            data = getattr(lab, col, None)
            if data:
                merged[camel] = data
    return merged, latest_ts


@router.get("/latest")
async def get_latest_lab_data(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    # T09: verify patient access
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient = pat_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient)

    result = await db.execute(
        select(LabData)
        .where(LabData.patient_id == pid)
        .order_by(LabData.timestamp.desc())
        .limit(50)  # enough to cover all categories across recent draws
    )
    labs = result.scalars().all()

    if not labs:
        return success_response(data=None, message="No lab data found")

    # If only 1 record (seed data), return as-is for backward compat
    if len(labs) == 1:
        return success_response(data=lab_to_dict(labs[0]))

    # Merge latest non-null category from each record
    merged, latest_ts = _merge_latest_categories(labs)
    data = {
        "id": labs[0].id,
        "patientId": pid,
        "timestamp": latest_ts.isoformat() if latest_ts else None,
        **{_COL_TO_CAMEL.get(c, c): merged.get(_COL_TO_CAMEL.get(c, c)) for c in _CATEGORY_COLS},
        "corrections": labs[0].corrections,
    }
    return success_response(data=data)


@router.get("/trends")
async def get_lab_trends(
    patient_id: str,
    days: int = Query(7, ge=1, le=90),
    items: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    result = await db.execute(
        select(LabData)
        .where(LabData.patient_id == pid)
        .order_by(LabData.timestamp.desc())
        .limit(days * 4)  # Multiple readings per day
    )
    labs = result.scalars().all()

    trends = [lab_to_dict(lab) for lab in reversed(labs)]

    return success_response(data={"trends": trends, "days": days})


@router.patch("/{lab_data_id}/correct")
async def correct_lab_data(
    patient_id: str,
    lab_data_id: str,
    body: LabCorrectionRequest,
    request: Request,
    user: User = Depends(require_roles("admin", "doctor", "np")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(LabData).where(LabData.id == lab_data_id))
    lab = result.scalar_one_or_none()

    if not lab:
        raise HTTPException(status_code=404, detail="Lab data not found")

    correction = {
        "id": f"corr_{uuid.uuid4().hex[:8]}",
        "category": body.category,
        "item": body.item,
        "correctedValue": body.correctedValue,
        "reason": body.reason,
        "correctedBy": {"id": user.id, "name": user.name},
        "correctedAt": datetime.now(timezone.utc).isoformat(),
    }

    corrections = lab.corrections or []
    corrections.append(correction)
    lab.corrections = corrections

    # Update the actual value in the category
    _col_name = body.category.replace("venousBloodGas", "venous_blood_gas").replace("bloodGas", "blood_gas")
    category_data = getattr(lab, _col_name, None)
    if category_data and body.item in category_data:
        category_data[body.item]["value"] = body.correctedValue
        category_data[body.item]["corrected"] = True

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="校正檢驗數據", target=lab_data_id, status="success",
        ip=request.client.host if request.client else None,
        details={"patient_id": patient_id, "category": body.category, "item": body.item},
    )

    return success_response(data=lab_to_dict(lab), message="檢驗數據已校正")
