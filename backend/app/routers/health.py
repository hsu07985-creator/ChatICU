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


@router.get("/health/db")
async def db_check(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT version_num FROM alembic_version"))
    rows = [r[0] for r in result.fetchall()]
    tables_result = await db.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    ))
    tables = [r[0] for r in tables_result.fetchall()]
    return success_response(data={
        "alembic_version": rows,
        "tables": tables,
    })


@router.get("/")
async def root():
    return success_response(data={
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    })
