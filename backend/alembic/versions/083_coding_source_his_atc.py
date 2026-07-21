"""Extend medications.coding_source CHECK with 'his_atc'.

The HIS converter now gap-fills atc_code from the HIS-supplied ATC_CODE when the
local formulary misses, stamping coding_source='his_atc'. Widen the DB CHECK to
admit it. Schema-only (no data-seed), idempotent, safe on a fresh DB. Mirrors
app.models.coding_source.VALID_CODING_SOURCES — the SSOT test points here now.

Revision ID: 083
Revises: 082
"""
from alembic import op


revision = "083"
down_revision = "082"
branch_labels = None
depends_on = None


# Full canonical set = migration 066's values + 'his_atc'. Must equal
# app.models.coding_source.VALID_CODING_SOURCES (guarded by test_coding_source_ssot).
_VALID_VALUES = (
    "formulary",
    "formulary+abx",
    "abx_only",
    "legacy_only",
    "manual",
    "rxnorm_cache",
    "his_atc",
    "unmapped",
)

_CONSTRAINT_NAME = "ck_medications_coding_source_valid"


def _quoted_list() -> str:
    return ", ".join(f"'{v}'" for v in _VALID_VALUES)


def upgrade() -> None:
    # Drop the 066 constraint (IF EXISTS → idempotent / fresh-DB safe) and
    # recreate with the widened value set. One SQL statement each.
    op.execute(f"ALTER TABLE medications DROP CONSTRAINT IF EXISTS {_CONSTRAINT_NAME}")
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        "medications",
        f"coding_source IS NULL OR coding_source IN ({_quoted_list()})",
    )


def downgrade() -> None:
    # Revert to the 066 value set (without 'his_atc'). Rows written as 'his_atc'
    # would violate it, so normalise them to NULL first.
    op.execute(
        "UPDATE medications SET coding_source = NULL WHERE coding_source = 'his_atc'"
    )
    op.execute(f"ALTER TABLE medications DROP CONSTRAINT IF EXISTS {_CONSTRAINT_NAME}")
    prev = ", ".join(f"'{v}'" for v in _VALID_VALUES if v != "his_atc")
    op.create_check_constraint(
        _CONSTRAINT_NAME,
        "medications",
        f"coding_source IS NULL OR coding_source IN ({prev})",
    )
