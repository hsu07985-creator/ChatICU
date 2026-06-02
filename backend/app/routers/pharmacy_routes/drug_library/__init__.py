"""drug_library — Read-only catalog of every drug/class the DDI database
knows about, plus per-drug coverage stats and ATC navigation.

The original single-module ``drug_library.py`` was split into this package:

    routes.py       — thin FastAPI router (all endpoints, ``router`` object)
    atc_labels.py   — pure WHO ATC label data (L1/L2/L3 Chinese labels)
    formulary.py    — cached hospital formulary CSV lookup
    aggregation.py  — read-side catalog logic + class-membership predicates
    audit.py        — governance: audit-log writer, override validation, models

The public ``router`` symbol is re-exported here so existing consumers
(``from .drug_library import router``) keep working unchanged.

Used by the 藥事工具 → 藥物資料庫 page. Pharmacist/admin only.
"""
from .routes import router

__all__ = ["router"]
