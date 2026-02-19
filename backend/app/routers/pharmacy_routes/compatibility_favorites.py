import uuid
from typing import Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.audit import create_audit_log
from app.middleware.auth import require_roles
from app.models.pharmacy_favorite import PharmacyCompatibilityFavorite
from app.models.user import User
from app.schemas.pharmacy import CompatibilityFavoriteCreate
from app.utils.response import success_response

router = APIRouter(tags=["pharmacy"])


def _make_pair_key(drug_a: str, drug_b: str, solution: str) -> Tuple[str, str, str, str, str]:
    """Return (pair_key, drug_a_disp, drug_b_disp, a_norm, b_norm) for a pair.

    pair_key is order-insensitive (sorted by normalized name).
    """
    a_in = (drug_a or "").strip()
    b_in = (drug_b or "").strip()
    sol = (solution or "").strip() or "none"

    pairs = sorted(
        [(a_in, a_in.lower()), (b_in, b_in.lower())],
        key=lambda t: t[1],
    )
    a_disp, a_norm = pairs[0]
    b_disp, b_norm = pairs[1]
    return f"{a_norm}|{b_norm}|{sol}", a_disp, b_disp, a_norm, b_norm


def favorite_to_dict(f: PharmacyCompatibilityFavorite) -> dict:
    return {
        "id": f.id,
        "drugA": f.drug_a,
        "drugB": f.drug_b,
        "solution": f.solution,
        "createdAt": f.created_at.isoformat() if f.created_at else None,
    }


@router.get("/compatibility-favorites")
async def list_compatibility_favorites(
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PharmacyCompatibilityFavorite)
        .where(PharmacyCompatibilityFavorite.user_id == user.id)
        .order_by(PharmacyCompatibilityFavorite.created_at.desc())
    )
    favorites = result.scalars().all()
    return success_response(data={
        "favorites": [favorite_to_dict(f) for f in favorites],
        "total": len(favorites),
    })


@router.post("/compatibility-favorites")
async def create_compatibility_favorite(
    request: Request,
    body: CompatibilityFavoriteCreate,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    pair_key, a_disp, b_disp, _, _ = _make_pair_key(body.drugA, body.drugB, body.solution)

    existing_result = await db.execute(
        select(PharmacyCompatibilityFavorite)
        .where(
            PharmacyCompatibilityFavorite.user_id == user.id,
            PharmacyCompatibilityFavorite.pair_key == pair_key,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return success_response(data=favorite_to_dict(existing), message="此組合已在常用清單")

    fav = PharmacyCompatibilityFavorite(
        id=f"fav_{uuid.uuid4().hex[:10]}",
        user_id=user.id,
        pair_key=pair_key,
        drug_a=a_disp,
        drug_b=b_disp,
        solution=(body.solution or "none").strip() or "none",
    )
    db.add(fav)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="新增常用相容性組合", target=fav.id, status="success",
        ip=request.client.host if request.client else None,
        details={"drugA": fav.drug_a, "drugB": fav.drug_b, "solution": fav.solution},
    )

    return success_response(data=favorite_to_dict(fav), message="已加入常用組合")


@router.delete("/compatibility-favorites/{favorite_id}")
async def delete_compatibility_favorite(
    favorite_id: str,
    request: Request,
    user: User = Depends(require_roles("pharmacist", "admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PharmacyCompatibilityFavorite).where(PharmacyCompatibilityFavorite.id == favorite_id)
    )
    fav = result.scalar_one_or_none()
    if not fav:
        raise HTTPException(status_code=404, detail="Favorite not found")
    if fav.user_id != user.id:
        raise HTTPException(status_code=403, detail="無權限刪除此常用組合")

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="刪除常用相容性組合", target=favorite_id, status="success",
        ip=request.client.host if request.client else None,
        details={"drugA": fav.drug_a, "drugB": fav.drug_b, "solution": fav.solution},
    )

    await db.delete(fav)
    return success_response(message="已刪除常用組合")
