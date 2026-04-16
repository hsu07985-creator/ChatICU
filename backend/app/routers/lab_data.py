import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

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

logger = logging.getLogger(__name__)

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
    """Merge the most recent non-null value for each *item* across records.

    HIS data produces one record per blood draw.  Even within a single
    category (e.g. biochemistry), different items may appear in different
    draws.  We merge at the item level so nothing is lost.

    Each item dict gets a ``_ts`` field with its source record's timestamp
    so the frontend can display per-item draw times.
    """
    merged: dict = {}
    latest_ts = None
    for lab in labs:  # already ordered desc by timestamp
        ts_iso = lab.timestamp.isoformat() if lab.timestamp else None
        if latest_ts is None and lab.timestamp:
            latest_ts = lab.timestamp
        for col in _CATEGORY_COLS:
            camel = _COL_TO_CAMEL.get(col, col)
            data = getattr(lab, col, None)
            if not data or not isinstance(data, dict):
                continue
            if camel not in merged:
                merged[camel] = {}
                for key, val in data.items():
                    item = dict(val) if isinstance(val, dict) else val
                    if isinstance(item, dict):
                        item["_ts"] = ts_iso
                    merged[camel][key] = item
            else:
                # Add items not yet present (most-recent-first wins)
                for key, val in data.items():
                    if key not in merged[camel]:
                        item = dict(val) if isinstance(val, dict) else val
                        if isinstance(item, dict):
                            item["_ts"] = ts_iso
                        merged[camel][key] = item
    return merged, latest_ts


def _compute_clcr(patient: Patient, biochem: dict) -> None:
    """Inject computed Clcr (Cockcroft-Gault) into biochemistry dict in-place.

    Formula: ((140 - age) × weight) / (72 × Scr)  ×  0.85 if female
    """
    scr_item = biochem.get("Scr")
    if not scr_item:
        return
    scr_val = scr_item.get("value") if isinstance(scr_item, dict) else scr_item
    if not isinstance(scr_val, (int, float)) or scr_val <= 0:
        return
    if not patient.weight or patient.weight <= 0:
        return
    if not patient.age or patient.age <= 0:
        return

    clcr = ((140 - patient.age) * patient.weight) / (72 * float(scr_val))
    if patient.gender in ("F", "女"):
        clcr *= 0.85
    clcr = round(clcr, 1)

    biochem["Clcr"] = {
        "value": clcr,
        "unit": "mL/min",
        "referenceRange": ">60",
        "isAbnormal": clcr < 60,
        "computed": True,
        "_ts": scr_item.get("_ts") if isinstance(scr_item, dict) else None,
    }


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
        data = lab_to_dict(labs[0])
        biochem = data.get("biochemistry")
        if biochem and isinstance(biochem, dict):
            _compute_clcr(patient, biochem)
        return success_response(data=data)

    # Merge latest non-null category from each record
    merged, latest_ts = _merge_latest_categories(labs)

    # Compute Clcr from merged Scr + patient demographics
    biochem = merged.get("biochemistry")
    if biochem and isinstance(biochem, dict):
        _compute_clcr(patient, biochem)

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
    days: Optional[int] = Query(None, ge=1, le=3650, description="Optional day window; omit to return all available history"),
    category: Optional[str] = Query(None, description="Filter by category (e.g. biochemistry, hematology)"),
    item: Optional[str] = Query(None, description="Filter by item name within the category"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = normalize_patient_id(patient_id)
    stmt = (
        select(LabData)
        .where(LabData.patient_id == pid)
        .order_by(LabData.timestamp.desc())
        .limit(2000)
    )
    if days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        stmt = stmt.where(LabData.timestamp >= cutoff)
    result = await db.execute(stmt)
    labs = result.scalars().all()

    if category:
        # Return only the requested category (optionally a single item)
        _camel_to_col = {v: k for k, v in _COL_TO_CAMEL.items()}
        col_name = _camel_to_col.get(category, category)
        camel_name = _COL_TO_CAMEL.get(col_name, col_name)
        slim_trends = []
        for lab in reversed(labs):
            cat_data = getattr(lab, col_name, None)
            if not cat_data or not isinstance(cat_data, dict):
                continue
            if item:
                item_val = cat_data.get(item)
                if item_val is None:
                    continue
                slim_trends.append({
                    "timestamp": lab.timestamp.isoformat() if lab.timestamp else None,
                    camel_name: {item: item_val},
                })
            else:
                slim_trends.append({
                    "timestamp": lab.timestamp.isoformat() if lab.timestamp else None,
                    camel_name: cat_data,
                })
        return success_response(data={"trends": slim_trends, "days": days})

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
