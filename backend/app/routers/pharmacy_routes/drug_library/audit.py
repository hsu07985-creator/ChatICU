"""audit — governance helpers for the drug-library editor / override workflow.

Holds the immutable audit-log writer, the rule fetch-or-404 helper, the
override validation rules, and the request/response Pydantic models shared by
the Phase 4a (editor) and Phase 4b (override / 4-eye) endpoints.
"""
from __future__ import annotations

import json as _json
from typing import Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.request import get_client_ip

# ────────────────────────────────────────────────────────────────────
# Phase 4a — editor request models
# ────────────────────────────────────────────────────────────────────


class _NoteIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=2000)


class _DeprecateIn(BaseModel):
    reason: str = Field(min_length=30, max_length=500,
                         description="軟刪除原因，至少 30 字（合規要求）")


class _RestoreIn(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


# ────────────────────────────────────────────────────────────────────
# Phase 4b — override request models + validation rules
# ────────────────────────────────────────────────────────────────────

_RISK_ORDER = {"X": 0, "D": 1, "C": 2, "B": 3, "A": 4}
_RISK_TO_SEVERITY = {
    "X": "contraindicated", "D": "major", "C": "moderate",
    "B": "minor", "A": "none",
}


def _validate_override(source_rating: str, override_rating: str) -> None:
    """Reject illegal severity changes. X→任何降級永禁."""
    src = (source_rating or "").upper()
    new = (override_rating or "").upper()
    if new not in _RISK_ORDER:
        raise HTTPException(status_code=400, detail=f"Invalid override risk_rating: {new!r}")
    # Hard rule: contraindicated (X) cannot be downgraded under any circumstance
    if src == "X" and new != "X":
        raise HTTPException(
            status_code=400,
            detail="X (Avoid combination) 永遠禁止降級。如有必要請改修內部 SOP/警示文字，但 risk_rating 必須維持 X。",
        )


class _ProposeOverrideIn(BaseModel):
    override_risk_rating: str = Field(min_length=1, max_length=2,
                                       description="X / D / C / B / A")
    reason: str = Field(min_length=30, max_length=1000,
                         description="院內共識決定的理由（≥30 字，存進稽核）")
    citation: str = Field(min_length=10, max_length=500,
                           description="證據引用（PMID / UpToDate URL / 院內 SOP 文號）")
    expires_in_days: int = Field(default=365, ge=30, le=730,
                                  description="多少天後須重新核驗（30-730）")


class _DecisionIn(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=500)


class _RejectIn(BaseModel):
    comment: str = Field(min_length=10, max_length=500,
                          description="拒絕理由（≥10 字）")


# ────────────────────────────────────────────────────────────────────
# Audit log + rule fetch helpers
# ────────────────────────────────────────────────────────────────────
async def _write_audit_log(
    db: AsyncSession,
    request: Optional[Request],
    user: User,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    reason: Optional[str] = None,
) -> None:
    """Insert an immutable audit row. Triggered by every mutating editor endpoint."""
    ip = None
    ua = None
    if request is not None:
        ip = get_client_ip(request)
        ua = request.headers.get("user-agent")
    await db.execute(text("""
        INSERT INTO drug_library_audit_log
            (action, entity_type, entity_id, before_json, after_json,
             actor_id, actor_name, actor_role, reason, ip_address, user_agent)
        VALUES (:action, :etype, :eid, CAST(:before AS JSONB), CAST(:after AS JSONB),
                :aid, :aname, :arole, :reason, :ip, :ua)
    """), {
        "action": action,
        "etype": entity_type,
        "eid": entity_id,
        "before": _json.dumps(before, ensure_ascii=False) if before is not None else None,
        "after": _json.dumps(after, ensure_ascii=False) if after is not None else None,
        "aid": user.id,
        "aname": user.name,
        "arole": user.role,
        "reason": reason,
        "ip": ip,
        "ua": ua,
    })


async def _fetch_rule_or_404(db: AsyncSession, rule_id: str) -> dict:
    r = await db.execute(text("""
        SELECT id, drug1, drug2, risk_rating, severity, is_active,
               pharmacist_note, last_verified_at, verified_by, etag
        FROM drug_interactions WHERE id = :id
    """), {"id": rule_id})
    row = r.first()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {
        "id": row.id, "drug1": row.drug1, "drug2": row.drug2,
        "risk_rating": row.risk_rating, "severity": row.severity,
        "is_active": row.is_active, "pharmacist_note": row.pharmacist_note,
        "last_verified_at": row.last_verified_at,
        "verified_by": row.verified_by, "etag": row.etag,
    }
