"""Rule engine endpoints (Phase 3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.clinical import CKDStageRequest
from app.services.rule_engine.ckd_rules import classify_ckd_stage
from app.utils.response import success_response

router = APIRouter(prefix="/api/v1/rules", tags=["Rules"])


@router.post("/ckd-stage")
async def ckd_staging(
    req: CKDStageRequest,
    user: User = Depends(get_current_user),
):
    result = classify_ckd_stage(egfr=req.egfr, has_proteinuria=req.has_proteinuria)
    return success_response(data=result)
