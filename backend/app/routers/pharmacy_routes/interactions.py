import json as _json
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.drug_interaction import DrugInteraction, IVCompatibility
from app.models.user import User
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


def _parse_json_field(val: str) -> list:
    if not val:
        return []
    try:
        return _json.loads(val)
    except Exception:
        return []


def _relevance_score(interaction, drug_a: str, drug_b: str) -> tuple:
    """Return a sort key: (direct_match_priority, risk_rank, severity_rank).

    Direct matches (drug name in drug1/drug2) rank higher than
    indirect matches (drug name only in interacting_members).
    """
    d1 = (interaction.drug1 or "").lower()
    d2 = (interaction.drug2 or "").lower()
    a_lower = drug_a.lower()
    b_lower = drug_b.lower() if drug_b else ""

    # Count how many search terms appear directly in drug1/drug2
    direct = 0
    if a_lower in d1 or a_lower in d2:
        direct += 1
    if b_lower and (b_lower in d1 or b_lower in d2):
        direct += 1

    # 0 = both direct, 1 = one direct, 2 = neither direct (both via members)
    direct_priority = 2 - direct

    risk = _RISK_RANK.get(interaction.risk_rating or "", 5)
    sev = _SEVERITY_RANK.get((interaction.severity or "").lower(), 5)
    return (direct_priority, risk, sev)


@router.get("/drug-interactions")
async def search_drug_interactions(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(DrugInteraction).where(_drug_match(drugA))
    if drugB:
        query = query.where(_drug_match(drugB))

    # Fetch more rows than needed so we can sort by relevance in Python
    result = await db.execute(query.limit(500))
    interactions: List[DrugInteraction] = list(result.scalars().all())

    # Sort: direct name matches first, then by risk rating, then severity
    interactions.sort(key=lambda i: _relevance_score(i, drugA, drugB))

    # Paginate after sorting
    offset = (page - 1) * limit
    page_items = interactions[offset:offset + limit]

    return success_response(data={
        "interactions": [
            {
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
            for i in page_items
        ],
        "total": len(interactions),
        "page": page,
        "limit": limit,
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
    })
