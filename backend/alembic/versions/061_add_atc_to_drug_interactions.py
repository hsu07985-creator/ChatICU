"""Add ATC columns to drug_interactions for class-level DDI matching.

Revision ID: 061
Revises: 060

PR-3.5: fixes Q4 (0% DDI hit rate in production). The existing name-string
matching misses because medications.generic_name is HIS-cleaned (e.g. "Vanco",
"Meropem") while drug_interactions.drug1 uses Lexicomp-style names (e.g.
"Vancomycin", "Meropenem"). Name normalization (case, suffix-strip, DDI alias
map) did not help either — many specific drug pair combinations simply aren't
in drug_interactions.

Adding ATC to drug_interactions lets us match on class membership: a medication
with atc_code='N01AH01' (fentanyl) pairs with a DDI rule whose drug1_atc
matches. Populated by scripts/backfill_drug_interactions_atc.py which joins
against drug_formulary.csv + auto_rxnorm_cache.json.
"""
from alembic import op


revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE drug_interactions
            ADD COLUMN IF NOT EXISTS drug1_atc VARCHAR(10),
            ADD COLUMN IF NOT EXISTS drug2_atc VARCHAR(10)
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_drug_interactions_drug1_atc "
        "ON drug_interactions (drug1_atc) WHERE drug1_atc IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_drug_interactions_drug2_atc "
        "ON drug_interactions (drug2_atc) WHERE drug2_atc IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_drug_interactions_drug2_atc")
    op.execute("DROP INDEX IF EXISTS ix_drug_interactions_drug1_atc")
    op.execute(
        """
        ALTER TABLE drug_interactions
            DROP COLUMN IF EXISTS drug2_atc,
            DROP COLUMN IF EXISTS drug1_atc
        """
    )
