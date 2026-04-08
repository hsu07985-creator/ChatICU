import json as _json
import logging
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.drug_interaction import DrugInteraction, IVCompatibility
from app.models.user import User
from app.services.drug_graph_bridge import drug_graph_bridge
from app.services.drug_rag_client import drug_rag_client
from app.utils.response import escape_like, success_response

router = APIRouter(tags=["pharmacy"])

# Severity order for sorting: higher risk first
_SEVERITY_RANK = {
    "contraindicated": 0, "major": 1, "moderate": 2, "minor": 3,
}
_RISK_RANK = {"X": 0, "D": 1, "C": 2, "B": 3, "A": 4}


def _drug_match(drug_name: str):
    """Match drug name against drug1, drug2, AND interacting_members JSON."""
    escaped = escape_like(drug_name)
    return or_(
        DrugInteraction.drug1.ilike(f"%{escaped}%"),
        DrugInteraction.drug2.ilike(f"%{escaped}%"),
        DrugInteraction.interacting_members.ilike(f"%{escaped}%"),
    )


def _parse_json_field(val) -> list:
    """Parse a field that may be JSONB (already list) or legacy Text (JSON string)."""
    if not val:
        return []
    if isinstance(val, list):
        return val
    try:
        return _json.loads(val)
    except Exception:
        return []


def _relevance_score(interaction, drug_a: str, drug_b: str) -> tuple:
    """Return a sort key: (direct_match_priority, risk_rank, severity_rank)."""
    d1 = (interaction.drug1 or "").lower()
    d2 = (interaction.drug2 or "").lower()
    a_lower = drug_a.lower()
    b_lower = drug_b.lower() if drug_b else ""

    direct = 0
    if a_lower in d1 or a_lower in d2:
        direct += 1
    if b_lower and (b_lower in d1 or b_lower in d2):
        direct += 1

    direct_priority = 2 - direct
    risk = _RISK_RANK.get(interaction.risk_rating or "", 5)
    sev = _SEVERITY_RANK.get((interaction.severity or "").lower(), 5)
    return (direct_priority, risk, sev)


def _pair_on_different_sides(interaction, drug_a: str, drug_b: str) -> bool:
    """Ensure drug_a and drug_b match different sides of the interaction."""
    members = _parse_json_field(interaction.interacting_members)
    d1_l = (interaction.drug1 or "").lower()
    d2_l = (interaction.drug2 or "").lower()
    side1 = {d1_l}
    side2 = {d2_l}
    for g in members:
        gn = (g.get("group_name") or "").lower()
        member_set = {m.lower() for m in g.get("members", [])}
        if gn == d1_l:
            side1.update(member_set)
        elif gn == d2_l:
            side2.update(member_set)
    a_l, b_l = drug_a.lower(), drug_b.lower() if drug_b else ""
    a_s1 = any(a_l in n or n in a_l for n in side1)
    a_s2 = any(a_l in n or n in a_l for n in side2)
    b_s1 = any(b_l in n or n in b_l for n in side1) if b_l else True
    b_s2 = any(b_l in n or n in b_l for n in side2) if b_l else True
    return (a_s1 and b_s2) or (a_s2 and b_s1)


def _interaction_to_dict(i: DrugInteraction) -> dict:
    return {
        "id": i.id,
        "drug1": i.drug1,
        "drug2": i.drug2,
        "severity": i.severity,
        "mechanism": i.mechanism,
        "clinicalEffect": i.clinical_effect,
        "management": i.management,
        "references": i.references,
        "riskRating": i.risk_rating,
        "riskRatingDescription": i.risk_rating_description,
        "severityLabel": i.severity_label,
        "reliabilityRating": i.reliability_rating,
        "routeDependency": i.route_dependency,
        "discussion": i.discussion,
        "footnotes": i.footnotes,
        "dependencies": _parse_json_field(i.dependencies),
        "dependencyTypes": _parse_json_field(i.dependency_types),
        "interactingMembers": _parse_json_field(i.interacting_members),
        "pubmedIds": _parse_json_field(i.pubmed_ids),
    }


@router.get("/drug-interactions")
async def search_drug_interactions(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(None),
    allowRag: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1) Try drug graph first
    try:
        resolved_a = drug_graph_bridge.resolve_drug(drugA)
        resolved_b = drug_graph_bridge.resolve_drug(drugB) if drugB else None

        if resolved_a:
            graph_results = drug_graph_bridge.search_interactions(
                drugA=resolved_a, drugB=resolved_b,
            )
            if graph_results:
                return success_response(data={
                    "interactions": graph_results,
                    "total": len(graph_results),
                    "page": 1,
                    "limit": limit,
                    "source": "drug_graph",
                })
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("drug_graph_bridge error (falling back to DB): %s", e)

    # 2) Fallback to database
    query = select(DrugInteraction).where(_drug_match(drugA))
    if drugB:
        query = query.where(_drug_match(drugB))

    result = await db.execute(query.limit(500))
    interactions: List[DrugInteraction] = list(result.scalars().all())

    if drugB:
        interactions = [i for i in interactions if _pair_on_different_sides(i, drugA, drugB)]

    interactions.sort(key=lambda i: _relevance_score(i, drugA, drugB))

    offset = (page - 1) * limit
    page_items = interactions[offset:offset + limit]

    return success_response(data={
        "interactions": [_interaction_to_dict(i) for i in page_items],
        "total": len(interactions),
        "page": page,
        "limit": limit,
        "source": "database",
    })


@router.get("/iv-compatibility")
async def search_iv_compatibility(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(..., min_length=1),
    solution: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1) Try drug graph first
    resolved_a = drug_graph_bridge.resolve_drug(drugA)
    resolved_b = drug_graph_bridge.resolve_drug(drugB)

    if resolved_a and resolved_b:
        graph_result = drug_graph_bridge.check_compatibility(
            drugA=resolved_a, drugB=resolved_b, solution=solution,
        )
        if graph_result:
            return success_response(data={
                "compatibilities": [graph_result],
                "total": 1,
                "page": 1,
                "limit": limit,
                "source": "drug_graph",
            })

    # 2) Fallback to database
    try:
        query = select(IVCompatibility).where(
            or_(
                IVCompatibility.drug1.ilike(f"%{escape_like(drugA)}%") & IVCompatibility.drug2.ilike(f"%{escape_like(drugB)}%"),
                IVCompatibility.drug1.ilike(f"%{escape_like(drugB)}%") & IVCompatibility.drug2.ilike(f"%{escape_like(drugA)}%"),
            )
        )
        if solution and solution != "none":
            query = query.where(IVCompatibility.solution == solution)

        offset = (page - 1) * limit
        result = await db.execute(query.offset(offset).limit(limit))
        compatibilities = result.scalars().all()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("iv-compatibility query failed for %s / %s", drugA, drugB)
        return success_response(data={
            "compatibilities": [],
            "total": 0,
            "page": page,
            "limit": limit,
            "source": "database",
        })

    return success_response(data={
        "compatibilities": [
            {
                "id": c.id,
                "drug1": c.drug1,
                "drug2": c.drug2,
                "solution": c.solution,
                "compatible": c.compatible,
                "timeStability": c.time_stability,
                "notes": c.notes,
                "references": c.references,
            }
            for c in compatibilities
        ],
        "total": len(compatibilities),
        "page": page,
        "limit": limit,
        "source": "database",
    })


# ── Batch IV compatibility (single round-trip for N pairs) ──────────

class _PairItem(BaseModel):
    drugA: str = Field(..., min_length=1)
    drugB: str = Field(..., min_length=1)
    solution: Optional[str] = None


class _BatchRequest(BaseModel):
    pairs: List[_PairItem] = Field(..., max_length=30)


def _compat_to_dict(c: IVCompatibility) -> dict:
    return {
        "id": c.id,
        "drug1": c.drug1,
        "drug2": c.drug2,
        "solution": c.solution,
        "compatible": c.compatible,
        "timeStability": c.time_stability,
        "notes": c.notes,
        "references": c.references,
    }


@router.post("/iv-compatibility/batch")
async def batch_iv_compatibility(
    body: _BatchRequest = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check IV compatibility for multiple drug pairs in one request."""
    log = logging.getLogger(__name__)
    results: List[dict] = []

    for pair in body.pairs:
        drug_a, drug_b, sol = pair.drugA, pair.drugB, pair.solution

        # 1) Try graph
        try:
            ra = drug_graph_bridge.resolve_drug(drug_a)
            rb = drug_graph_bridge.resolve_drug(drug_b)
            if ra and rb:
                gr = drug_graph_bridge.check_compatibility(drugA=ra, drugB=rb, solution=sol)
                if gr:
                    results.append({
                        "drugA": drug_a, "drugB": drug_b,
                        "compatibilities": [gr], "source": "drug_graph",
                    })
                    continue
        except Exception as e:
            log.warning("drug_graph_bridge error for %s/%s: %s", drug_a, drug_b, e)

        # 2) Fallback DB
        try:
            q = select(IVCompatibility).where(
                or_(
                    and_(IVCompatibility.drug1.ilike(f"%{escape_like(drug_a)}%"),
                         IVCompatibility.drug2.ilike(f"%{escape_like(drug_b)}%")),
                    and_(IVCompatibility.drug1.ilike(f"%{escape_like(drug_b)}%"),
                         IVCompatibility.drug2.ilike(f"%{escape_like(drug_a)}%")),
                )
            )
            if sol and sol != "none":
                q = q.where(IVCompatibility.solution == sol)
            rows = (await db.execute(q.limit(100))).scalars().all()
            results.append({
                "drugA": drug_a, "drugB": drug_b,
                "compatibilities": [_compat_to_dict(c) for c in rows],
                "source": "database",
            })
        except Exception:
            log.exception("batch iv-compat query failed for %s/%s", drug_a, drug_b)
            results.append({
                "drugA": drug_a, "drugB": drug_b,
                "compatibilities": [], "source": "error",
            })

    return success_response(data={"results": results, "total": len(results)})
