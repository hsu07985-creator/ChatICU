"""Enforce medications.coding_source enum at DB layer.

Revision ID: 066
Revises: 065

The ``coding_source`` column was documented informally in the model comment
and drifted from the values actually written by producers (HIS converter's
formulary CSV, RxNorm fallback, seed scripts). See
``app.models.coding_source.VALID_CODING_SOURCES`` for the canonical set.

This migration:

1. Normalises any legacy/unknown value to NULL so the constraint doesn't
   reject rows created before the SSOT was introduced (notably the old
   ``"demo"`` value written by ``scripts/seed_demo_duplicates.py``).
2. Adds a CHECK constraint that restricts future writes to the canonical
   set. NULL stays allowed (the column is nullable by design).
"""
from alembic import op


revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None


_VALID_VALUES = (
    "formulary",
    "formulary+abx",
    "abx_only",
    "legacy_only",
    "manual",
    "rxnorm_cache",
    "unmapped",
)

_CONSTRAINT_NAME = "ck_medications_coding_source_valid"


def _quoted_list() -> str:
    return ", ".join(f"'{v}'" for v in _VALID_VALUES)


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE medications
           SET coding_source = NULL
         WHERE coding_source IS NOT NULL
           AND coding_source NOT IN ({_quoted_list()})
        """
    )

    op.create_check_constraint(
        _CONSTRAINT_NAME,
        "medications",
        f"coding_source IS NULL OR coding_source IN ({_quoted_list()})",
    )


def downgrade() -> None:
    op.drop_constraint(_CONSTRAINT_NAME, "medications", type_="check")
