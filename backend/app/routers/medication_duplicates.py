"""Medication duplicate-detection endpoints.

Per docs/duplicate-medication-integration-plan.md §7:

    GET  /patients/{patient_id}/medication-duplicates?context=inpatient
    POST /pharmacy/duplicate-summary   (batched counts for N patients)

Response shape for the GET::

    {
        "success": true,
        "data": {
            "alerts": [DuplicateAlert.to_dict(), ...],
            "counts": {"critical": n, "high": n, "moderate": n, "low": n, "info": n},
            "cached": bool
        }
    }

Both endpoints now go through the cache layer
(:mod:`app.services.duplicate_cache`): read cache first, fall back to a
recompute + upsert on miss. A cache-layer failure never blocks the response.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.medication import Medication
from app.models.patient import Patient
from app.models.user import User
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.services.duplicate_cache import (
    Context,
    get_cached_duplicates,
    refresh_patient_cache,
)
from app.utils.response import success_response

router = APIRouter(
    prefix="/patients/{patient_id}/medication-duplicates",
    tags=["medications"],
)


async def _load_active_medications(
    db: AsyncSession, patient_id: str
) -> List[Medication]:
    """Return active medications for a patient (status='active')."""
    result = await db.execute(
        select(Medication).where(
            (Medication.patient_id == patient_id) & (Medication.status == "active")
        )
    )
    return list(result.scalars().all())


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

    Flow (Wave 4a):
      1. Verify patient + access.
      2. Load active medications.
      3. Try the cache — if the stored hash + context match, serve from cache.
      4. Otherwise run the detector, upsert the cache, return fresh data.
    """
    pid = normalize_patient_id(patient_id)

    # Verify patient exists + access (matches pattern in list_medications).
    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = pat_result.scalar_one_or_none()
    if not patient_obj:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    meds = await _load_active_medications(db, pid)
    ctx: Context = context  # type: ignore[assignment]

    cached = await get_cached_duplicates(db, pid, meds, ctx)
    if cached is not None:
        alerts, counts = cached
        from_cache = True
    else:
        alerts, counts = await refresh_patient_cache(db, pid, meds, ctx)
        from_cache = False

    return success_response(
        data={
            "alerts": [a.to_dict() for a in alerts],
            "counts": counts,
            "cached": from_cache,
        }
    )


# ── Batched summary for pharmacy workstation / dashboard ──────────────
# Lives in this module (rather than under pharmacy_routes/) because the
# underlying cache + detector pipeline is already imported here; the prefix
# "/pharmacy/duplicate-summary" is applied via a standalone APIRouter so it
# mounts cleanly alongside the existing `/pharmacy/*` router tree.
pharmacy_summary_router = APIRouter(tags=["pharmacy"])


class _DuplicateSummaryRequest(BaseModel):
    patient_ids: List[str] = Field(..., alias="patientIds", max_length=200)

    model_config = {"populate_by_name": True}


@pharmacy_summary_router.post("/pharmacy/duplicate-summary")
async def duplicate_summary(
    body: _DuplicateSummaryRequest,
    background_tasks: BackgroundTasks,
    context: str = Query(
        "inpatient",
        pattern="^(inpatient|outpatient|icu|discharge)$",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Batched per-patient severity counts for audit / dashboard tiles.

    Cache-first: patients whose cache is fresh return counts immediately.
    Misses return zeroed counts now **and** schedule a background recompute
    so the next call is a hit — keeps the UI responsive for large lists.
    """
    ctx: Context = context  # type: ignore[assignment]
    empty_counts = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}

    results: dict = {}
    misses: List[str] = []
    for raw_pid in body.patient_ids:
        pid = normalize_patient_id(raw_pid)
        meds = await _load_active_medications(db, pid)
        cached = await get_cached_duplicates(db, pid, meds, ctx)
        if cached is not None:
            _, counts = cached
            results[pid] = {"counts": counts, "cached": True}
        else:
            results[pid] = {"counts": dict(empty_counts), "cached": False}
            misses.append(pid)

    # Schedule background recomputes for misses — they'll populate the cache
    # for subsequent calls without blocking this response.
    if misses:
        background_tasks.add_task(_warm_cache_for_patients, misses, ctx)

    return success_response(
        data={
            "results": results,
            "pending": misses,
            "total": len(body.patient_ids),
        }
    )


async def _warm_cache_for_patients(patient_ids: List[str], context: Context) -> None:
    """Background task: recompute cache for each patient.

    Uses a short-lived session so the request-scoped session is not reused
    after the response has been sent (FastAPI closes it at request teardown).
    Each patient is processed in isolation so one failure doesn't abort the
    whole warmup batch.
    """
    import logging

    from app.database import async_session

    log = logging.getLogger(__name__)
    if async_session is None:  # pragma: no cover — defensive
        log.warning("duplicate_cache: async_session unavailable, skip warmup")
        return

    for pid in patient_ids:
        try:
            async with async_session() as session:
                await refresh_patient_cache(session, pid, None, context)
                await session.commit()
        except Exception as exc:
            log.warning(
                "duplicate_cache: warmup failed for patient=%s: %s", pid, exc
            )
