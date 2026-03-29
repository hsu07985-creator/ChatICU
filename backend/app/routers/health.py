import traceback

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.utils.response import success_response

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return success_response(data={
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
    })


@router.get("/health/db-check")
async def db_migration_check(db: AsyncSession = Depends(get_db)):
    """Temporary diagnostic: check alembic version and table columns."""
    info = {}
    try:
        result = await db.execute(text("SELECT version_num FROM alembic_version"))
        rows = result.fetchall()
        info["alembic_version"] = [r[0] for r in rows]
    except Exception as e:
        info["alembic_version_error"] = str(e)
    try:
        result = await db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'users' AND table_schema = 'public' ORDER BY ordinal_position"
        ))
        info["public_users_columns"] = [r[0] for r in result.fetchall()]
    except Exception as e:
        info["public_users_columns_error"] = str(e)
    try:
        result = await db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'users' AND table_schema = 'auth' ORDER BY ordinal_position"
        ))
        info["auth_users_columns"] = [r[0] for r in result.fetchall()]
    except Exception as e:
        info["auth_users_columns_error"] = str(e)
    try:
        result = await db.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        ))
        info["tables"] = [r[0] for r in result.fetchall()]
    except Exception as e:
        info["tables_error"] = str(e)
    return success_response(data=info)


@router.get("/")
async def root():
    return success_response(data={
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    })
