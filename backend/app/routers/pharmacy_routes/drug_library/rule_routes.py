"""rule_routes — Phase 4a rule-editor lifecycle endpoints.

    PATCH /pharmacy/drug-library/rules/{rule_id}/note
    POST  /pharmacy/drug-library/rules/{rule_id}/verify
    POST  /pharmacy/drug-library/rules/{rule_id}/deprecate
    POST  /pharmacy/drug-library/rules/{rule_id}/restore
    GET   /pharmacy/drug-library/rules/{rule_id}/history
    POST  /pharmacy/drug-library/rules/{rule_id}/clear-override
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.utils.response import success_response

from .audit import (
    _DeprecateIn,
    _fetch_rule_or_404,
    _NoteIn,
    _RejectIn,
    _RestoreIn,
    _write_audit_log,
)
from .deps import require_admin, require_pharmacist

router = APIRouter()


# ────────────────────────────────────────────────────────────────────
# Phase 4a — editor endpoints (note / verify / deprecate / restore / history)
# ────────────────────────────────────────────────────────────────────
@router.patch("/rules/{rule_id}/note")
async def update_note(
    rule_id: str,
    body: _NoteIn,
    request: Request,
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    """Set or clear the pharmacist note on a rule. Single-pharmacist OK."""
    before = await _fetch_rule_or_404(db, rule_id)
    new_note = (body.note or "").strip() or None

    await db.execute(text("""
        UPDATE drug_interactions
        SET pharmacist_note = :note, etag = etag + 1, updated_at = NOW()
        WHERE id = :id
    """), {"note": new_note, "id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="note", entity_type="rule", entity_id=rule_id,
        before={"pharmacist_note": before["pharmacist_note"]},
        after={"pharmacist_note": new_note},
    )
    await db.commit()
    after = await _fetch_rule_or_404(db, rule_id)
    return success_response(data={
        "id": rule_id,
        "pharmacist_note": after["pharmacist_note"],
        "etag": after["etag"],
    })


@router.post("/rules/{rule_id}/verify")
async def mark_verified(
    rule_id: str,
    request: Request,
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    """Stamp 'last_verified_at = now, verified_by = me' on a rule."""
    before = await _fetch_rule_or_404(db, rule_id)

    await db.execute(text("""
        UPDATE drug_interactions
        SET last_verified_at = NOW(), verified_by = :uid,
            etag = etag + 1, updated_at = NOW()
        WHERE id = :id
    """), {"uid": user.id, "id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="verify", entity_type="rule", entity_id=rule_id,
        before={"last_verified_at": before["last_verified_at"].isoformat()
                                     if before["last_verified_at"] else None,
                "verified_by": before["verified_by"]},
        after={"verified_by": user.id, "verified_by_name": user.name},
    )
    await db.commit()
    after = await _fetch_rule_or_404(db, rule_id)
    return success_response(data={
        "id": rule_id,
        "last_verified_at": after["last_verified_at"].isoformat()
                             if after["last_verified_at"] else None,
        "verified_by": after["verified_by"],
        "verified_by_name": user.name,
        "etag": after["etag"],
    })


@router.post("/rules/{rule_id}/deprecate")
async def deprecate_rule(
    rule_id: str,
    body: _DeprecateIn,
    request: Request,
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a rule. Marks is_active=FALSE; reason ≥30 chars required."""
    before = await _fetch_rule_or_404(db, rule_id)
    if not before["is_active"]:
        raise HTTPException(status_code=409, detail="Rule already deprecated")

    await db.execute(text("""
        UPDATE drug_interactions
        SET is_active = FALSE,
            deprecated_at = NOW(),
            deprecated_by = :uid,
            deprecated_reason = :reason,
            etag = etag + 1,
            updated_at = NOW()
        WHERE id = :id
    """), {"uid": user.id, "reason": body.reason, "id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="deprecate", entity_type="rule", entity_id=rule_id,
        before={"is_active": True},
        after={"is_active": False, "deprecated_by": user.id},
        reason=body.reason,
    )
    await db.commit()
    return success_response(data={
        "id": rule_id, "is_active": False, "deprecated_at_utc": "now",
    })


@router.post("/rules/{rule_id}/restore")
async def restore_rule(
    rule_id: str,
    body: _RestoreIn,
    request: Request,
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    """Undo a soft-delete. Reason required for audit trail."""
    before = await _fetch_rule_or_404(db, rule_id)
    if before["is_active"]:
        raise HTTPException(status_code=409, detail="Rule is already active")

    await db.execute(text("""
        UPDATE drug_interactions
        SET is_active = TRUE,
            deprecated_at = NULL,
            deprecated_by = NULL,
            deprecated_reason = NULL,
            etag = etag + 1,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="restore", entity_type="rule", entity_id=rule_id,
        before={"is_active": False},
        after={"is_active": True},
        reason=body.reason,
    )
    await db.commit()
    return success_response(data={"id": rule_id, "is_active": True})


@router.get("/rules/{rule_id}/history")
async def rule_history(
    rule_id: str,
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    """Audit log for one rule, newest first. Pharmacist/admin only."""
    r = await db.execute(text("""
        SELECT action, actor_id, actor_name, actor_role,
               before_json, after_json, reason, created_at
        FROM drug_library_audit_log
        WHERE entity_type = 'rule' AND entity_id = :id
        ORDER BY created_at DESC
        LIMIT 200
    """), {"id": rule_id})
    out = [{
        "action": row.action,
        "actor_id": row.actor_id,
        "actor_name": row.actor_name,
        "actor_role": row.actor_role,
        "before": row.before_json,
        "after": row.after_json,
        "reason": row.reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    } for row in r]
    return success_response(data={"rule_id": rule_id, "history": out})


@router.post("/rules/{rule_id}/clear-override")
async def clear_override(
    rule_id: str,
    body: _RejectIn,  # reuse — needs comment ≥10 chars
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin can clear an active override (e.g. consensus changed back).
    Reason ≥10 chars logged for audit."""
    rule = await _fetch_rule_or_404(db, rule_id)
    if not rule.get("override_risk_rating"):
        # _fetch_rule_or_404 doesn't return override fields; query specifically
        rr = await db.execute(text("""
            SELECT override_risk_rating FROM drug_interactions WHERE id = :id
        """), {"id": rule_id})
        if not (rr.scalar() or None):
            raise HTTPException(status_code=409, detail="此規則目前無 override")

    await db.execute(text("""
        UPDATE drug_interactions
        SET override_risk_rating = NULL,
            override_severity    = NULL,
            override_reason      = NULL,
            override_citation    = NULL,
            overridden_by        = NULL,
            overridden_at        = NULL,
            override_expires_at  = NULL,
            etag = etag + 1,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="clear_override", entity_type="rule", entity_id=rule_id,
        before={"had_override": True},
        after={"had_override": False},
        reason=body.comment,
    )
    await db.commit()
    return success_response(data={"id": rule_id, "override_cleared": True})
