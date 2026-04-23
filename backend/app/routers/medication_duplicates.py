"""Medication duplicate-detection endpoint.

Per docs/duplicate-medication-integration-plan.md §7, exposes a single sister
endpoint to the medications router:

    GET /patients/{patient_id}/medication-duplicates?context=inpatient

Returns the Wave 1 contract:

    {
        "success": true,
        "data": {
            "alerts": [DuplicateAlert.to_dict(), ...],
            "counts": {"critical": n, "high": n, "moderate": n, "low": n, "info": n}
        }
    }

Kept in its own router (rather than stapling onto /patients/{id}/medications)
so the final URL stays pretty — matching the integration-plan contract.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.medication import Medication
from app.models.patient import Patient
from app.models.user import User
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.services.duplicate_detector import DuplicateAlert, DuplicateDetector
from app.utils.response import success_response

router = APIRouter(
    prefix="/patients/{patient_id}/medication-duplicates",
    tags=["medications"],
)


def _tally_counts(alerts: List[DuplicateAlert]) -> dict:
    counts = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}
    for a in alerts:
        counts[a.level] = counts.get(a.level, 0) + 1
    return counts


@router.get("")
async def list_medication_duplicates(
    patient_id: str,
    context: str = Query(
        "inpatient",
        pattern="^(inpatient|outpatient|icu|discharge)$",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all duplicate-medication alerts for a patient's active medications.

    Pulls active medications from the DB, runs the shared DuplicateDetector
    (Wave 1: L1+L2 + overrides + auto-downgrade), and returns alerts plus a
    severity tally. L3/L4 are stubbed inside the detector until their seed
    tables are populated.
    """
    pid = normalize_patient_id(patient_id)

    # Verify patient exists + access (matches pattern in list_medications).
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = pat_result.scalar_one_or_none()
    if not patient_obj:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    # Load active medications only — detector itself will further filter
    # out entries whose last_admin_at is > 48h old.
    result = await db.execute(
        select(Medication).where(
            (Medication.patient_id == pid) & (Medication.status == "active")
        )
    )
    meds = list(result.scalars().all())

    detector = DuplicateDetector(db)
    alerts = await detector.analyze(meds, context=context)  # type: ignore[arg-type]

    return success_response(
        data={
            "alerts": [a.to_dict() for a in alerts],
            "counts": _tally_counts(alerts),
        }
    )
