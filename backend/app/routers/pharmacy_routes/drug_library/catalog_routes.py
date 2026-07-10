"""catalog_routes — read-only drug-library catalog endpoints.

    GET /pharmacy/drug-library/stats
    GET /pharmacy/drug-library/drugs
    GET /pharmacy/drug-library/drugs/{name}
"""
from __future__ import annotations

import json as _json
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
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
from .deps import require_pharmacist
from .formulary import formulary_lookup

router = APIRouter()


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
    # Plain (non-f) string: no interpolated fragments — the escaped LIKE pattern
    # flows only into the :pat bind parameter below, never into the SQL text.
    ddi_query = """
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
    """
    r = await db.execute(text(ddi_query), {"pat": f"%{escaped}%"})

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
