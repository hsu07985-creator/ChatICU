from .advice_records import router as advice_records_router
from .compatibility_favorites import router as compatibility_favorites_router
from .duplicate_check import router as duplicate_check_router
from .error_reports import router as error_reports_router
from .interactions import router as interactions_router
from .pad_calculate import router as pad_calculate_router

__all__ = [
    "advice_records_router",
    "compatibility_favorites_router",
    "duplicate_check_router",
    "error_reports_router",
    "interactions_router",
    "pad_calculate_router",
]
