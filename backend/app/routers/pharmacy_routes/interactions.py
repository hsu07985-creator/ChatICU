from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.drug_interaction import DrugInteraction, IVCompatibility
from app.models.user import User
from app.utils.response import success_response

router = APIRouter(tags=["pharmacy"])


@router.get("/drug-interactions")
async def search_drug_interactions(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(DrugInteraction).where(
        or_(
            DrugInteraction.drug1.ilike(f"%{drugA}%"),
            DrugInteraction.drug2.ilike(f"%{drugA}%"),
        )
    )
    if drugB:
        query = query.where(
            or_(
                DrugInteraction.drug1.ilike(f"%{drugB}%"),
                DrugInteraction.drug2.ilike(f"%{drugB}%"),
            )
        )

    result = await db.execute(query)
    interactions = result.scalars().all()

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
            }
            for i in interactions
        ],
        "total": len(interactions),
    })


@router.get("/iv-compatibility")
async def search_iv_compatibility(
    drugA: str = Query(..., min_length=1),
    drugB: str = Query(..., min_length=1),
    solution: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(IVCompatibility).where(
        or_(
            IVCompatibility.drug1.ilike(f"%{drugA}%") & IVCompatibility.drug2.ilike(f"%{drugB}%"),
            IVCompatibility.drug1.ilike(f"%{drugB}%") & IVCompatibility.drug2.ilike(f"%{drugA}%"),
        )
    )
    if solution and solution != "none":
        query = query.where(IVCompatibility.solution == solution)

    result = await db.execute(query)
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
    })
