"""proposal_routes — Phase 4b override proposal / 4-eye approval workflow.

    POST /pharmacy/drug-library/rules/{rule_id}/propose-override
    GET  /pharmacy/drug-library/proposals
    POST /pharmacy/drug-library/proposals/{proposal_id}/approve
    POST /pharmacy/drug-library/proposals/{proposal_id}/reject
    POST /pharmacy/drug-library/proposals/{proposal_id}/withdraw
"""
from __future__ import annotations

import json as _json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.utils.response import success_response

from .audit import (
    _DecisionIn,
    _fetch_rule_or_404,
    _ProposeOverrideIn,
    _RejectIn,
    _RISK_TO_SEVERITY,
    _validate_override,
    _write_audit_log,
)
from .deps import require_admin, require_pharmacist

router = APIRouter()


# ────────────────────────────────────────────────────────────────────
# Phase 4b — hospital override + 4-eye proposal/approval workflow
# ────────────────────────────────────────────────────────────────────
@router.post("/rules/{rule_id}/propose-override")
async def propose_override(
    rule_id: str,
    body: _ProposeOverrideIn,
    request: Request,
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    """Any pharmacist can propose a hospital-side severity override.
    Validates X→ downgrade hard rule, then writes a pending proposal.
    Admin must approve (different person) for the override to take effect."""
    rule = await _fetch_rule_or_404(db, rule_id)
    _validate_override(rule["risk_rating"], body.override_risk_rating)

    # Reject if same proposer already has a pending proposal on this rule
    r = await db.execute(text("""
        SELECT COUNT(*) FROM drug_rule_proposals
        WHERE rule_id = :rid AND proposer_id = :uid AND status = 'pending'
    """), {"rid": rule_id, "uid": user.id})
    if r.scalar_one() > 0:
        raise HTTPException(status_code=409, detail="您對此規則已有一筆待批准的提議")

    new_risk = body.override_risk_rating.upper()
    proposed_changes = {
        "override_risk_rating": new_risk,
        "override_severity": _RISK_TO_SEVERITY.get(new_risk, "moderate"),
        "expires_in_days": body.expires_in_days,
    }
    pid_row = await db.execute(text("""
        INSERT INTO drug_rule_proposals
            (rule_id, kind, proposed_changes, proposer_id, proposer_name,
             proposer_role, reason, citation)
        VALUES (:rid, 'override', CAST(:changes AS JSONB), :uid, :uname,
                :urole, :reason, :citation)
        RETURNING id
    """), {
        "rid": rule_id,
        "changes": _json.dumps(proposed_changes, ensure_ascii=False),
        "uid": user.id, "uname": user.name, "urole": user.role,
        "reason": body.reason, "citation": body.citation,
    })
    pid = pid_row.scalar_one()

    await _write_audit_log(
        db, request, user,
        action="propose_override", entity_type="rule", entity_id=rule_id,
        before={"source_risk": rule["risk_rating"]},
        after={"proposed_override_risk": new_risk, "proposal_id": pid},
        reason=body.reason,
    )
    await db.commit()
    return success_response(data={
        "proposal_id": pid, "rule_id": rule_id, "status": "pending",
    })


@router.get("/proposals")
async def list_proposals(
    status: str = Query("pending", pattern="^(pending|approved|rejected|withdrawn|all)$"),
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin queue. Lists proposals with embedded source rule info."""
    if status == "all":
        sql = """
            SELECT p.id, p.rule_id, p.kind, p.proposed_changes, p.status,
                   p.proposer_id, p.proposer_name, p.proposer_role,
                   p.reason, p.citation, p.created_at,
                   p.approver_id, p.approver_name, p.decided_at, p.decision_comment,
                   r.drug1, r.drug2, r.risk_rating AS source_risk_rating,
                   r.severity AS source_severity, r."references" AS source_ref
            FROM drug_rule_proposals p
            LEFT JOIN drug_interactions r ON r.id = p.rule_id
            ORDER BY p.created_at DESC
            LIMIT 200
        """
        params = {}
    else:
        sql = """
            SELECT p.id, p.rule_id, p.kind, p.proposed_changes, p.status,
                   p.proposer_id, p.proposer_name, p.proposer_role,
                   p.reason, p.citation, p.created_at,
                   p.approver_id, p.approver_name, p.decided_at, p.decision_comment,
                   r.drug1, r.drug2, r.risk_rating AS source_risk_rating,
                   r.severity AS source_severity, r."references" AS source_ref
            FROM drug_rule_proposals p
            LEFT JOIN drug_interactions r ON r.id = p.rule_id
            WHERE p.status = :status
            ORDER BY p.created_at DESC
            LIMIT 200
        """
        params = {"status": status}

    r = await db.execute(text(sql), params)
    out = []
    for row in r:
        out.append({
            "id": row.id,
            "rule_id": row.rule_id,
            "kind": row.kind,
            "proposed_changes": row.proposed_changes,
            "status": row.status,
            "proposer_id": row.proposer_id,
            "proposer_name": row.proposer_name,
            "proposer_role": row.proposer_role,
            "reason": row.reason,
            "citation": row.citation,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "approver_id": row.approver_id,
            "approver_name": row.approver_name,
            "decided_at": row.decided_at.isoformat() if row.decided_at else None,
            "decision_comment": row.decision_comment,
            "source_drug1": row.drug1,
            "source_drug2": row.drug2,
            "source_risk_rating": row.source_risk_rating,
            "source_severity": row.source_severity,
            "source_ref": row.source_ref,
        })
    return success_response(data={"items": out, "total": len(out), "status_filter": status})


@router.post("/proposals/{proposal_id}/approve")
async def approve_proposal(
    proposal_id: int,
    body: _DecisionIn,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin approves a pending override proposal. Cannot self-approve.
    Applies override + records audit."""
    p = await db.execute(text("""
        SELECT id, rule_id, status, proposer_id, proposer_name, reason, citation,
               proposed_changes
        FROM drug_rule_proposals WHERE id = :id
    """), {"id": proposal_id})
    prow = p.first()
    if not prow:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if prow.status != "pending":
        raise HTTPException(status_code=409, detail=f"Proposal already {prow.status}")
    if prow.proposer_id == user.id:
        raise HTTPException(status_code=400, detail="不可核准自己的提議（4-eye 簽核）")

    rule = await _fetch_rule_or_404(db, prow.rule_id)
    changes = prow.proposed_changes or {}
    new_risk = (changes.get("override_risk_rating") or "").upper()
    new_sev = changes.get("override_severity") or _RISK_TO_SEVERITY.get(new_risk)
    expires_days = int(changes.get("expires_in_days") or 365)
    # Re-validate at approve time (rule could have changed since proposal)
    _validate_override(rule["risk_rating"], new_risk)

    # 1. Mark proposal approved
    await db.execute(text("""
        UPDATE drug_rule_proposals
        SET status = 'approved', approver_id = :uid, approver_name = :uname,
            decided_at = NOW(), decision_comment = :comment
        WHERE id = :id
    """), {"uid": user.id, "uname": user.name,
            "comment": body.comment, "id": proposal_id})

    # 2. Apply override to drug_interactions
    await db.execute(text("""
        UPDATE drug_interactions
        SET override_risk_rating = :rr,
            override_severity    = :sev,
            override_reason      = :reason,
            override_citation    = :cit,
            overridden_by        = :uid,
            overridden_at        = NOW(),
            override_expires_at  = NOW() + (:days || ' days')::INTERVAL,
            etag = etag + 1,
            updated_at = NOW()
        WHERE id = :rid
    """), {
        "rr": new_risk, "sev": new_sev,
        "reason": prow.reason, "cit": prow.citation,
        "uid": user.id, "days": str(expires_days),
        "rid": prow.rule_id,
    })

    await _write_audit_log(
        db, request, user,
        action="approve_override", entity_type="rule", entity_id=prow.rule_id,
        before={
            "source_risk": rule["risk_rating"],
            "previous_override": rule.get("override_risk_rating"),
            "proposer_id": prow.proposer_id,
            "proposer_name": prow.proposer_name,
        },
        after={
            "override_risk": new_risk,
            "expires_in_days": expires_days,
            "proposal_id": proposal_id,
        },
        reason=body.comment,
    )
    await db.commit()
    return success_response(data={
        "proposal_id": proposal_id, "rule_id": prow.rule_id,
        "status": "approved", "applied_risk": new_risk,
    })


@router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(
    proposal_id: int,
    body: _RejectIn,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    p = await db.execute(text("""
        SELECT id, rule_id, status, proposer_id FROM drug_rule_proposals WHERE id = :id
    """), {"id": proposal_id})
    prow = p.first()
    if not prow:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if prow.status != "pending":
        raise HTTPException(status_code=409, detail=f"Proposal already {prow.status}")

    await db.execute(text("""
        UPDATE drug_rule_proposals
        SET status = 'rejected', approver_id = :uid, approver_name = :uname,
            decided_at = NOW(), decision_comment = :comment
        WHERE id = :id
    """), {"uid": user.id, "uname": user.name,
            "comment": body.comment, "id": proposal_id})

    await _write_audit_log(
        db, request, user,
        action="reject_override", entity_type="rule", entity_id=prow.rule_id,
        before={"proposal_status": "pending"},
        after={"proposal_status": "rejected", "proposal_id": proposal_id},
        reason=body.comment,
    )
    await db.commit()
    return success_response(data={
        "proposal_id": proposal_id, "status": "rejected",
    })


@router.post("/proposals/{proposal_id}/withdraw")
async def withdraw_proposal(
    proposal_id: int,
    request: Request,
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    p = await db.execute(text("""
        SELECT id, rule_id, status, proposer_id FROM drug_rule_proposals WHERE id = :id
    """), {"id": proposal_id})
    prow = p.first()
    if not prow:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if prow.status != "pending":
        raise HTTPException(status_code=409, detail=f"Proposal already {prow.status}")
    # Only proposer or admin can withdraw
    if prow.proposer_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the proposer or admin can withdraw")

    await db.execute(text("""
        UPDATE drug_rule_proposals
        SET status = 'withdrawn', decided_at = NOW()
        WHERE id = :id
    """), {"id": proposal_id})

    await _write_audit_log(
        db, request, user,
        action="withdraw_proposal", entity_type="rule", entity_id=prow.rule_id,
        after={"proposal_id": proposal_id, "proposal_status": "withdrawn"},
    )
    await db.commit()
    return success_response(data={
        "proposal_id": proposal_id, "status": "withdrawn",
    })
