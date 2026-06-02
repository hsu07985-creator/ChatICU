"""routes — thin FastAPI router for the read-only drug library + the
pharmacist/admin editor + override governance endpoints.

Catalog/read logic lives in ``aggregation``; formulary lookup in
``formulary``; ATC labels in ``atc_labels``; audit-log + governance models
and helpers in ``audit``.

Endpoints:
    GET   /pharmacy/drug-library/stats
    GET   /pharmacy/drug-library/drugs
    GET   /pharmacy/drug-library/drugs/{name}
    PATCH /pharmacy/drug-library/rules/{rule_id}/note
    POST  /pharmacy/drug-library/rules/{rule_id}/verify
    POST  /pharmacy/drug-library/rules/{rule_id}/deprecate
    POST  /pharmacy/drug-library/rules/{rule_id}/restore
    GET   /pharmacy/drug-library/rules/{rule_id}/history
    POST  /pharmacy/drug-library/rules/{rule_id}/propose-override
    GET   /pharmacy/drug-library/proposals
    POST  /pharmacy/drug-library/proposals/{proposal_id}/approve
    POST  /pharmacy/drug-library/proposals/{proposal_id}/reject
    POST  /pharmacy/drug-library/proposals/{proposal_id}/withdraw
    POST  /pharmacy/drug-library/rules/{rule_id}/clear-override

Used by the 藥事工具 → 藥物資料庫 page. Pharmacist/admin only.
"""
from __future__ import annotations

import json as _json
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import require_roles
from app.models.user import User
from app.utils.response import escape_like, success_response

from .aggregation import (
    aggregate_per_drug,
    coverage_status,
    drug_name_is,
    parse_interacting_members,
    row_about_target,
)
from .atc_labels import ATC_LEVEL2, ATC_LEVEL3, ATC_TOP
from .audit import (
    _DecisionIn,
    _DeprecateIn,
    _fetch_rule_or_404,
    _NoteIn,
    _ProposeOverrideIn,
    _RejectIn,
    _RestoreIn,
    _RISK_TO_SEVERITY,
    _validate_override,
    _write_audit_log,
)
from .formulary import formulary_lookup

router = APIRouter(prefix="/drug-library", tags=["pharmacy"])

# Canonical role dependencies — preserve the exact roles each endpoint allowed.
require_pharmacist = require_roles("pharmacist", "admin")
require_admin = require_roles("admin")


# ────────────────────────────────────────────────────────────────────
# Endpoint 1: stats banner
# ────────────────────────────────────────────────────────────────────
@router.get("/stats")
async def get_stats(
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(text("""
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE risk_rating = 'X') AS x_count,
          COUNT(*) FILTER (WHERE risk_rating = 'D') AS d_count,
          COUNT(*) FILTER (WHERE risk_rating = 'C') AS c_count,
          COUNT(*) FILTER (WHERE risk_rating = 'B') AS b_count,
          COUNT(*) FILTER (WHERE risk_rating = 'A') AS a_count,
          COUNT(DISTINCT LOWER(drug1)) FILTER (WHERE drug1 IS NOT NULL) AS d1_uniq,
          COUNT(DISTINCT LOWER(drug2)) FILTER (WHERE drug2 IS NOT NULL) AS d2_uniq,
          COUNT(*) FILTER (WHERE drug1_atc IS NULL OR drug2_atc IS NULL) AS missing_atc,
          MAX(updated_at) AS last_updated
        FROM drug_interactions
        WHERE is_active = TRUE
    """))
    row = r.first()

    # Sources distribution
    r2 = await db.execute(text("""
        SELECT COALESCE("references", 'unspecified') AS src, COUNT(*) AS n
        FROM drug_interactions
        WHERE is_active = TRUE
        GROUP BY src
        ORDER BY n DESC
    """))
    sources = {row2.src: row2.n for row2 in r2}

    # Distinct drug names (drug1 ∪ drug2)
    r3 = await db.execute(text("""
        SELECT COUNT(*) AS n FROM (
          SELECT DISTINCT LOWER(drug1) AS d FROM drug_interactions
          WHERE is_active = TRUE AND drug1 IS NOT NULL
          UNION
          SELECT DISTINCT LOWER(drug2) FROM drug_interactions
          WHERE is_active = TRUE AND drug2 IS NOT NULL
        ) t
    """))
    total_drugs = r3.scalar_one()

    # Recently added (Lexicomp 2026 batch)
    recently_added = sources.get("Lexicomp 2026", 0)

    return success_response(data={
        "total_drugs": total_drugs,
        "total_ddi": row.total,
        "ddi_by_risk": {
            "X": row.x_count, "D": row.d_count, "C": row.c_count,
            "B": row.b_count, "A": row.a_count,
        },
        "missing_atc": row.missing_atc,
        "sources": sources,
        "recently_added": recently_added,
        "last_updated": row.last_updated.isoformat() if row.last_updated else None,
    })


# ────────────────────────────────────────────────────────────────────
# Endpoint 2: drug list (paginated, searchable, sortable)
# ────────────────────────────────────────────────────────────────────
@router.get("/drugs")
async def list_drugs(
    q: Optional[str] = Query(None, description="搜尋關鍵字（藥名/ATC/院內代碼）"),
    atc: Optional[str] = Query(None, description="ATC 前綴篩選"),
    sort: str = Query("name", pattern="^(name|ddi_count)$"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    in_formulary_only: bool = Query(False),
    has_x_only: bool = Query(False),
    missing_atc_only: bool = Query(False),
    recently_added_only: bool = Query(False),
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    per_drug = await aggregate_per_drug(db)

    # Enrich + filter
    items: list = []
    atc_chapter_counts: Counter = Counter()
    q_lower = (q or "").strip().lower()
    atc_lower = (atc or "").strip().upper()

    for _key, agg in per_drug.items():
        name = agg["name"]
        aliases = agg.get("aliases", [])
        atcs = sorted(agg["atc_codes"])
        primary_atc = atcs[0] if atcs else None
        atc_chapter = primary_atc[0] if primary_atc else None

        fm = formulary_lookup(name)
        in_formulary = bool(fm)
        brand_names = fm["brand_names"] if fm else []
        hospital_codes = fm["hospital_codes"] if fm else []

        recently_added = agg["recently_added_count"] > 0 and agg["ddi_counts"]["total"] == agg["recently_added_count"]
        status = coverage_status(agg["ddi_counts"]["total"], bool(primary_atc))

        # Search filter
        if q_lower:
            haystack = " ".join([
                name.lower(),
                " ".join(a.lower() for a in aliases),
                " ".join(b.lower() for b in brand_names),
                " ".join(c.lower() for c in hospital_codes),
                primary_atc.lower() if primary_atc else "",
            ])
            if q_lower not in haystack:
                continue

        if atc_lower and (not primary_atc or not primary_atc.upper().startswith(atc_lower)):
            continue
        if in_formulary_only and not in_formulary:
            continue
        if has_x_only and agg["ddi_counts"]["X"] == 0:
            continue
        if missing_atc_only and primary_atc:
            continue
        if recently_added_only and not recently_added:
            continue

        items.append({
            "name": name,
            "aliases": aliases,
            "atc": primary_atc,
            "atc_chapter": atc_chapter,
            "atc_codes": atcs,
            "brand_names": brand_names,
            "hospital_codes": hospital_codes,
            "in_formulary": in_formulary,
            "ddi_counts": agg["ddi_counts"],
            "sources": sorted(agg["sources"]),
            "recently_added": recently_added,
            "status": status,
        })
        if atc_chapter:
            atc_chapter_counts[atc_chapter] += 1

    # Sort — library default is alphabetical
    if sort == "ddi_count":
        items.sort(key=lambda x: (-x["ddi_counts"]["total"], x["name"].lower()))
    else:  # name (default)
        items.sort(key=lambda x: x["name"].lower())

    total = len(items)
    start = (page - 1) * size
    page_items = items[start:start + size]

    atc_classes = [
        {"code": code, "name": ATC_TOP.get(code, code), "count": atc_chapter_counts[code]}
        for code in sorted(ATC_TOP.keys())
        if atc_chapter_counts[code] > 0
    ]

    return success_response(data={
        "total": total,
        "page": page,
        "size": size,
        "items": page_items,
        "atc_classes": atc_classes,
    })


# ────────────────────────────────────────────────────────────────────
# Endpoint 3: drug detail
# ────────────────────────────────────────────────────────────────────
@router.get("/drugs/{name}")
async def get_drug_detail(
    name: str,
    scope: str = Query("all", pattern="^(all|icu)$"),
    risk: Optional[str] = Query(None, description="逗號分隔風險過濾，如 X,D"),
    user: User = Depends(require_pharmacist),
    db: AsyncSession = Depends(get_db),
):
    # Build risk filter
    risk_filter: Optional[set] = None
    if risk:
        risk_filter = {r.strip().upper() for r in risk.split(",") if r.strip()}

    # Fetch all DDI rows where this drug appears (drug1 / drug2 / interacting_members)
    escaped = escape_like(name)
    r = await db.execute(text(f"""
        SELECT
          id, drug1, drug2, drug1_atc, drug2_atc,
          risk_rating, severity, severity_label, reliability_rating,
          mechanism, clinical_effect, management, discussion,
          "references" AS source_ref, pubmed_ids,
          interacting_members,
          pharmacist_note, last_verified_at, verified_by, etag,
          override_risk_rating, override_severity, override_reason,
          override_citation, overridden_by, overridden_at, override_expires_at
        FROM drug_interactions
        WHERE is_active = TRUE
          AND (drug1 ILIKE :pat OR drug2 ILIKE :pat
               OR CAST(interacting_members AS TEXT) ILIKE :pat)
        ORDER BY
          CASE COALESCE(override_risk_rating, risk_rating)
              WHEN 'X' THEN 0 WHEN 'D' THEN 1 WHEN 'C' THEN 2
              WHEN 'B' THEN 3 WHEN 'A' THEN 4 ELSE 5 END
    """), {"pat": f"%{escaped}%"})

    ddi_rows = list(r)
    if not ddi_rows:
        # Drug name not found — return empty profile
        return success_response(data={
            "name": name, "exists": False, "ddi": [],
        })

    # Determine "this drug" canonical name (most common occurrence)
    name_lower = name.lower()
    primary_name = name
    for row in ddi_rows:
        if row.drug1 and row.drug1.lower() == name_lower:
            primary_name = row.drug1
            break
        if row.drug2 and row.drug2.lower() == name_lower:
            primary_name = row.drug2
            break

    # ATC for this drug — pick from any row where drug1==name → drug1_atc, etc.
    primary_atc = None
    for row in ddi_rows:
        if row.drug1 and row.drug1.lower() == name_lower and row.drug1_atc:
            primary_atc = row.drug1_atc
            break
        if row.drug2 and row.drug2.lower() == name_lower and row.drug2_atc:
            primary_atc = row.drug2_atc
            break

    # Formulary enrichment
    fm = formulary_lookup(primary_name)
    in_formulary = bool(fm)
    if not primary_atc and fm:
        primary_atc = fm.get("atc")

    # Build DDI list (the OTHER drug). Reject string-pollution rows where
    # the target drug only appears as a substring of a class name.
    ddi_out = []
    sources_seen = set()
    for row in ddi_rows:
        if not row_about_target(row, primary_name):
            continue
        d1, d2 = row.drug1 or "", row.drug2 or ""
        is_d1 = drug_name_is(primary_name, d1)
        is_d2 = drug_name_is(primary_name, d2)
        if is_d1:
            other = d2
            other_atc = row.drug2_atc
        elif is_d2:
            other = d1
            other_atc = row.drug1_atc
        else:
            # Class-member match — pick the side whose group/name does NOT
            # contain the target as a member, since target is on the other.
            raw = parse_interacting_members(row.interacting_members)
            target_in_d1_group = False
            if isinstance(raw, list):
                for grp in raw:
                    if not isinstance(grp, dict):
                        continue
                    if (grp.get("group_name") or "").lower() == d1.lower():
                        for m in grp.get("members") or []:
                            if drug_name_is(primary_name, m):
                                target_in_d1_group = True
                                break
            elif isinstance(raw, dict):
                for gn, mems in raw.items():
                    if gn.lower() == d1.lower():
                        for m in mems or []:
                            if drug_name_is(primary_name, m):
                                target_in_d1_group = True
                                break
            if target_in_d1_group:
                other = d2
                other_atc = row.drug2_atc
            else:
                other = d1
                other_atc = row.drug1_atc
        risk_str = (row.risk_rating or "").upper()
        if risk_filter and risk_str not in risk_filter:
            continue
        if row.source_ref:
            sources_seen.add(row.source_ref)
        try:
            pmids = row.pubmed_ids if isinstance(row.pubmed_ids, list) else (
                _json.loads(row.pubmed_ids) if row.pubmed_ids else []
            )
        except Exception:
            pmids = []
        # Phase 4b: effective risk = override (if set) ELSE source
        effective_risk = (row.override_risk_rating or row.risk_rating or "").upper()
        effective_severity = row.override_severity or row.severity
        ddi_out.append({
            "id": row.id,
            "other_drug": other,
            "other_drug_atc": other_atc,
            # source (vendor) values — never modified
            "source_risk_rating": risk_str,
            "source_severity": row.severity,
            # effective values — what UI should treat as the rule's current rating
            "risk_rating": effective_risk,
            "severity": effective_severity,
            "severity_label": row.severity_label,
            "reliability": row.reliability_rating,
            "mechanism": row.mechanism,
            "clinical_effect": row.clinical_effect,
            "management": row.management,
            "discussion": row.discussion,
            "source": row.source_ref,
            "pubmed_count": len(pmids) if isinstance(pmids, list) else 0,
            # Phase 4a: editor metadata
            "pharmacist_note": row.pharmacist_note,
            "last_verified_at": row.last_verified_at.isoformat() if row.last_verified_at else None,
            "verified_by": row.verified_by,
            "etag": row.etag,
            # Phase 4b: override metadata (null when no override active)
            "override_risk_rating": row.override_risk_rating,
            "override_severity": row.override_severity,
            "override_reason": row.override_reason,
            "override_citation": row.override_citation,
            "overridden_by": row.overridden_by,
            "overridden_at": row.overridden_at.isoformat() if row.overridden_at else None,
            "override_expires_at": row.override_expires_at.isoformat() if row.override_expires_at else None,
        })

    # ATC path with Chinese labels for L1/L2/L3 (L4/L5 stay code-only)
    atc_path = []
    if primary_atc:
        if len(primary_atc) >= 1:
            atc_path.append({"code": primary_atc[:1], "name": ATC_TOP.get(primary_atc[:1], "")})
        if len(primary_atc) >= 3:
            atc_path.append({"code": primary_atc[:3], "name": ATC_LEVEL2.get(primary_atc[:3], "")})
        if len(primary_atc) >= 5:
            atc_path.append({"code": primary_atc[:5], "name": ATC_LEVEL3.get(primary_atc[:5], "")})
        if len(primary_atc) >= 7:
            atc_path.append({"code": primary_atc, "name": ""})

    # Risk count
    risk_counts = {"X": 0, "D": 0, "C": 0, "B": 0, "A": 0}
    for d in ddi_out:
        if d["risk_rating"] in risk_counts:
            risk_counts[d["risk_rating"]] += 1

    # Resolve verified_by + overridden_by user IDs → display names (one batch)
    user_ids = {d["verified_by"] for d in ddi_out if d.get("verified_by")}
    user_ids |= {d["overridden_by"] for d in ddi_out if d.get("overridden_by")}
    if user_ids:
        ur = await db.execute(text(
            "SELECT id, name FROM users WHERE id = ANY(:ids)"
        ), {"ids": list(user_ids)})
        names = {row.id: row.name for row in ur}
        for d in ddi_out:
            if d.get("verified_by"):
                d["verified_by_name"] = names.get(d["verified_by"])
            if d.get("overridden_by"):
                d["overridden_by_name"] = names.get(d["overridden_by"])

    # ── IV compatibility for this drug (Trissel's Handbook etc.) ───
    iv_rows = await db.execute(text("""
        SELECT id, drug1, drug2, solution, compatible, time_stability,
               notes, "references" AS source_ref
        FROM iv_compatibilities
        WHERE drug1 ILIKE :pat OR drug2 ILIKE :pat
        ORDER BY compatible DESC, drug1, drug2
    """), {"pat": f"%{escaped}%"})
    iv_compat = []
    for row in iv_rows:
        d1 = row.drug1 or ""
        d2 = row.drug2 or ""
        if d1.lower() == name_lower:
            other = d2
        elif d2.lower() == name_lower:
            other = d1
        else:
            other = f"{d1} ↔ {d2}"
        iv_compat.append({
            "id": row.id,
            "other_drug": other,
            "solution": row.solution,
            "compatible": row.compatible,
            "time_stability": row.time_stability,
            "notes": row.notes,
            "source": row.source_ref,
        })

    return success_response(data={
        "name": primary_name,
        "exists": True,
        "atc": primary_atc,
        "atc_path": atc_path,
        "brand_names": fm["brand_names"] if fm else [],
        "hospital_codes": fm["hospital_codes"] if fm else [],
        "in_formulary": in_formulary,
        "sources": sorted(sources_seen),
        "ddi_total": len(ddi_out),
        "ddi_by_risk": risk_counts,
        "ddi": ddi_out,
        "iv_compatibility": iv_compat,
    })


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
