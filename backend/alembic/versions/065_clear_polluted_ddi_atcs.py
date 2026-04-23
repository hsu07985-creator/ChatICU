"""Clear polluted DDI ATC codes left by first-word backfill collision.

Revision ID: 065
Revises: 064

The original ``backfill_drug_interactions_atc.py`` did first-word matching
against the formulary's ``ingredient`` column. When a drug name starts with an
ambiguous ion/element token (Sodium, Potassium, Calcium, Magnesium, ...), the
first sibling ingredient with that prefix wins via ``setdefault``. Every
multi-word drug starting with the same token then inherits that ATC.

Concrete example: ``Sodium Zirconium Cyclosilicate`` resolves to
``sodium → sodium chloride → B05XA03`` (saline). Any patient on saline +
Furosemide / Clopidogrel then matches the (Zirconium, Furosemide) DDI rule via
``WHERE drug1_atc = ANY(:atcs) AND drug2_atc = ANY(:atcs)`` and a false-positive
warning surfaces in the medications panel.

This migration sets ``drug1_atc`` / ``drug2_atc`` back to NULL on any DDI row
where the corresponding drug name is multi-word and starts with one of the
ambiguous prefixes. The fixed backfill script (committed alongside) will leave
them NULL on the next run, and Path 2 of the medications interaction query
naturally drops NULLs.
"""
from alembic import op


revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


_AMBIGUOUS_PREFIXES = (
    "sodium", "potassium", "calcium", "magnesium",
    "iron", "ferric", "ferrous", "aluminum", "aluminium",
    "zinc", "lithium", "insulin",
)


def _prefix_predicate(column: str) -> str:
    clauses = [
        f"LOWER({column}) LIKE '{prefix} %'"
        for prefix in _AMBIGUOUS_PREFIXES
    ]
    return "(" + " OR ".join(clauses) + ")"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE drug_interactions
           SET drug1_atc = NULL
         WHERE drug1_atc IS NOT NULL
           AND drug1 IS NOT NULL
           AND { _prefix_predicate('drug1') }
        """
    )
    op.execute(
        f"""
        UPDATE drug_interactions
           SET drug2_atc = NULL
         WHERE drug2_atc IS NOT NULL
           AND drug2 IS NOT NULL
           AND { _prefix_predicate('drug2') }
        """
    )


def downgrade() -> None:
    # No reverse — the original ATC values were wrong by construction.
    pass
