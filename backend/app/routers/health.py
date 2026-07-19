import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.utils.response import success_response

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Readiness:實際 ping DB。DB 不通回 503,部署驗證 curl 才驗得到東西。"""
    try:
        await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=5)
        db_ok = True
    except Exception:
        db_ok = False

    payload = {
        "status": "healthy" if db_ok else "degraded",
        "database": "ok" if db_ok else "unreachable",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
    if db_ok:
        return success_response(data=payload)
    return JSONResponse(status_code=503, content={"success": False, "data": payload})


@router.get("/health/live")
async def liveness_check():
    """Liveness:純 process 存活,給容器 HEALTHCHECK 用(不因 DB 抖動重啟容器)。"""
    return success_response(data={"status": "alive"})


@router.get("/")
async def root():
    return success_response(data={
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    })
