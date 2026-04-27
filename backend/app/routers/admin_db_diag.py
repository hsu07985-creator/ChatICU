"""TEMPORARY diagnostic endpoint to inspect alembic version + schema state.

Used to debug why a recent migration silently failed on Railway. Gated by the
same ``ADMIN_SYNC_TOKEN`` shared secret as the HIS sync endpoints. Remove
after the investigation closes.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.utils.response import success_response

router = APIRouter(prefix="/admin", tags=["admin-diag"])


def _check_token(x_admin_token: Optional[str]) -> None:
    if not settings.ADMIN_SYNC_TOKEN or x_admin_token != settings.ADMIN_SYNC_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")


@router.get("/db-diag")
async def db_diag(
    table: str = Query("patient_messages", max_length=64, pattern=r"^[a-z_][a-z0-9_]*$"),
    x_admin_token: Optional[str] = Header(None, alias="x-admin-token"),
    db: AsyncSession = Depends(get_db),
):
    _check_token(x_admin_token)

    rev_row = (await db.execute(text("SELECT version_num FROM alembic_version"))).first()
    cols_rows = (
        await db.execute(
            text(
                "SELECT column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_name = :table "
                "ORDER BY ordinal_position"
            ),
            {"table": table},
        )
    ).all()

    return success_response(data={
        "alembic_version": rev_row[0] if rev_row else None,
        "table": table,
        "columns": [{"name": r[0], "type": r[1]} for r in cols_rows],
    })
