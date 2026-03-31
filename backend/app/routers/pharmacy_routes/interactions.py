from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.drug_interaction import DrugInteraction, IVCompatibility
from app.models.user import User
from app.utils.response import escape_like, success_response

router = APIRouter(tags=["pharmacy"])


@router.get("/drug-interactions")
async def search_drug_interactions(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(DrugInteraction).where(
        or_(
            DrugInteraction.drug1.ilike(f"%{escape_like(drugA)}%"),
            DrugInteraction.drug2.ilike(f"%{escape_like(drugA)}%"),
        )
    )
    if drugB:
        query = query.where(
            or_(
                DrugInteraction.drug1.ilike(f"%{escape_like(drugB)}%"),
                DrugInteraction.drug2.ilike(f"%{escape_like(drugB)}%"),
            )
        )

    offset = (page - 1) * limit
    result = await db.execute(query.offset(offset).limit(limit))
    interactions = result.scalars().all()

    import json as _json

    def _parse_json_field(val: str) -> list:
        if not val:
            return []
        try:
            return _json.loads(val)
        except Exception:
            return []

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
            for i in interactions
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
