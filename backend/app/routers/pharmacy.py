from fastapi import APIRouter

from app.routers.pharmacy_routes import (
    advice_records_router,
    compatibility_favorites_router,
    duplicate_check_router,
    error_reports_router,
    interactions_router,
    pad_calculate_router,
)

router = APIRouter(prefix="/pharmacy", tags=["pharmacy"])

router.include_router(error_reports_router)
router.include_router(compatibility_favorites_router)
router.include_router(advice_records_router)
router.include_router(interactions_router)
router.include_router(pad_calculate_router)
router.include_router(duplicate_check_router)
