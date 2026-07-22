import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.utils.request import get_client_ip
from app.middleware.audit import create_audit_log
from app.middleware.auth import get_current_user
from app.models.clinical_score import ClinicalScore
from app.models.patient import Patient
from app.models.user import User
from app.utils.patient_access import normalize_patient_id, verify_patient_access
from app.schemas.scores import ScoreCreate
from app.schemas.scores import ClinicalScoreResponse
from app.utils.response import success_response

router = APIRouter(prefix="/patients/{patient_id}/scores", tags=["scores"])


def score_to_dict(s: ClinicalScore) -> dict:
    """B2 batch 2: schema is the single source of the field mapping."""
    payload = ClinicalScoreResponse.model_validate(s).dump_camel()
    is_his = s.id.startswith("score_") or s.recorded_by == "HIS"
    payload.update(sourceType="his" if is_his else "manual", editable=not is_his)
    return payload


async def _has_his_pain_score(db: AsyncSession, patient_id: str) -> bool:
    """Whether this patient already has a structured HIS pain record."""
    result = await db.execute(
        select(ClinicalScore.id)
        .where(
            ClinicalScore.patient_id == patient_id,
            ClinicalScore.score_type == "pain",
            ClinicalScore.recorded_by == "HIS",
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


def _resolve_patient_id(patient_id: str) -> Optional[str]:
    """Resolve patient_id: check layer2 store first, then DB-style normalize."""
    pid = patient_id.strip()
    try:
        from app.services.layer2_store import layer2_store
        row = layer2_store.get_patient(pid)
        if row is not None:
            return pid
    except Exception:
        pass
    return normalize_patient_id(pid)


async def _get_patient_or_404(
    db: AsyncSession, patient_id: str, user: User
) -> str:
    """Return resolved patient_id string. Checks layer2 store and DB."""
    pid = patient_id.strip()
    # Check layer2 store (JSON-based patients)
    try:
        from app.services.layer2_store import layer2_store
        row = layer2_store.get_patient(pid)
        if row is not None:
            return pid
    except Exception:
        pass
    # Fallback: check DB
    # B3 exception:此處刻意不用 get_accessible_patient dependency ——
    # layer2(JSON mode)病人不存在於 DB,上方 shortcut 已放行;只有
    # fallback 進 DB 的分支需要 fetch+verify。
    norm_pid = normalize_patient_id(pid)
    result = await db.execute(select(Patient).where(Patient.id == norm_pid))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient)
    return patient.id


@router.get("/latest")
async def get_latest_scores(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = await _get_patient_or_404(db, patient_id, user)

    pain = None
    rass = None
    for score_type in ("pain", "rass"):
        result = await db.execute(
            select(ClinicalScore)
            .where(
                ClinicalScore.patient_id == pid,
                ClinicalScore.score_type == score_type,
            )
            .order_by(ClinicalScore.timestamp.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row:
            if score_type == "pain":
                pain = score_to_dict(row)
            else:
                rass = score_to_dict(row)

    pain_ownership = "auto" if await _has_his_pain_score(db, pid) else "orphan"
    return success_response(
        data={"pain": pain, "rass": rass, "painOwnership": pain_ownership}
    )


@router.post("")
async def record_score(
    patient_id: str,
    body: ScoreCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = await _get_patient_or_404(db, patient_id, user)
    if body.score_type == "pain" and await _has_his_pain_score(db, pid):
        raise HTTPException(
            status_code=409,
            detail="Pain score is managed by HIS and cannot be entered manually",
        )

    score = ClinicalScore(
        id=str(uuid.uuid4()),
        patient_id=pid,
        score_type=body.score_type,
        value=body.value,
        timestamp=datetime.now(timezone.utc),
        recorded_by=user.id,
        notes=body.notes,
    )
    db.add(score)
    await db.flush()

    # Audit: clinical scores drive sedation/analgesia decisions — record full
    # payload (score_type + value + notes) for incident review.
    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="記錄臨床評分", target=pid, status="success",
        ip=get_client_ip(request),
        details={
            "score_id": score.id,
            "score_type": body.score_type,
            "value": body.value,
            "notes": body.notes,
        },
    )

    await db.commit()
    await db.refresh(score)

    return success_response(data=score_to_dict(score))


@router.delete("/{score_id}")
async def delete_score(
    patient_id: str,
    score_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = await _get_patient_or_404(db, patient_id, user)

    result = await db.execute(
        select(ClinicalScore).where(
            ClinicalScore.id == score_id,
            ClinicalScore.patient_id == pid,
        )
    )
    score = result.scalar_one_or_none()
    if not score:
        raise HTTPException(status_code=404, detail="Score not found")
    if score.id.startswith("score_") or score.recorded_by == "HIS":
        raise HTTPException(
            status_code=409,
            detail="HIS score cannot be deleted manually",
        )

    # Audit: snapshot the full row before deletion so the audit log is the
    # only record of what existed (clinical scores affect sedation decisions).
    deleted_snapshot = score_to_dict(score)

    await db.delete(score)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="刪除臨床評分", target=pid, status="success",
        ip=get_client_ip(request),
        details={"score": deleted_snapshot},
    )

    await db.commit()

    return success_response(data={"deleted": score_id})


@router.get("/trends")
async def get_score_trends(
    patient_id: str,
    score_type: str = Query(..., pattern=r"^(pain|rass)$"),
    hours: int = Query(72, ge=1, le=720),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pid = await _get_patient_or_404(db, patient_id, user)

    result = await db.execute(
        select(ClinicalScore)
        .where(
            ClinicalScore.patient_id == pid,
            ClinicalScore.score_type == score_type,
        )
        .order_by(ClinicalScore.timestamp.asc())
        .limit(hours * 4)
    )
    rows = result.scalars().all()

    return success_response(data={
        "trends": [score_to_dict(s) for s in rows],
        "scoreType": score_type,
        "hours": hours,
    })
