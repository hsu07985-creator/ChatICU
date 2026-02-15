from fastapi import APIRouter

from app.config import settings
from app.utils.response import success_response

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return success_response(data={
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
    })


@router.get("/")
async def root():
    return success_response(data={
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    })
