from .advice_records import router as advice_records_router
from .compatibility_favorites import router as compatibility_favorites_router
from .drug_library import router as drug_library_router
from .duplicate_check import router as duplicate_check_router
from .error_reports import router as error_reports_router
from .interactions import router as interactions_router
from .pad_calculate import router as pad_calculate_router
from .soap_records import router as soap_records_router

__all__ = [
    "advice_records_router",
    "compatibility_favorites_router",
    "drug_library_router",
    "duplicate_check_router",
    "error_reports_router",
    "interactions_router",
    "pad_calculate_router",
    "soap_records_router",
]
