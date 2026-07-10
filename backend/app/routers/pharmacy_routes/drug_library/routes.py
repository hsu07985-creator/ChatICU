"""routes — aggregator for the drug-library sub-routers.

Endpoint implementations live in:

    catalog_routes.py   — read-only catalog (stats / drugs / drug detail)
    rule_routes.py      — Phase 4a rule-editor lifecycle (note / verify /
                          deprecate / restore / history / clear-override)
    proposal_routes.py  — Phase 4b override proposals + 4-eye approval

The public ``router`` (prefix ``/drug-library``) is unchanged, so
``__init__.py``'s ``from .routes import router`` keeps working.

Used by the 藥事工具 → 藥物資料庫 page. Pharmacist/admin only.
"""
from fastapi import APIRouter

from .catalog_routes import router as catalog_router
from .proposal_routes import router as proposal_router
from .rule_routes import router as rule_router

router = APIRouter(prefix="/drug-library", tags=["pharmacy"])
router.include_router(catalog_router)
router.include_router(rule_router)
router.include_router(proposal_router)
