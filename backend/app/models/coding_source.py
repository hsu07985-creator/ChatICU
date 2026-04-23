"""Single source of truth for ``Medication.coding_source`` enum values.

Any producer of ``coding_source`` (HIS converter, seed scripts, imports)
MUST use one of ``VALID_CODING_SOURCES``. The Alembic CHECK constraint
(migration 066) mirrors this set at the database layer, and the pytest
in ``tests/test_fhir/test_coding_source_ssot.py`` guards the formulary
CSV against drift. See ``docs/coordination/frontend-tasks.md`` for the
matching frontend TS literal union.
"""
from typing import Literal

CodingSource = Literal[
    "formulary",       # matched via hospital formulary CSV
    "formulary+abx",   # formulary row that is also in the antibiotic list
    "abx_only",        # only the antibiotic list matched
    "legacy_only",     # legacy/history-only mapping
    "manual",          # hand-entered (includes seed/demo rows)
    "rxnorm_cache",    # RxNorm offline cache fallback
    "unmapped",        # has an order code but nothing matched
]

VALID_CODING_SOURCES: frozenset = frozenset(CodingSource.__args__)
