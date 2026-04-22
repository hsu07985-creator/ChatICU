"""Add ATC/antibiotic/kidney-relevant columns to medications.

Revision ID: 060
Revises: 059

PR-1: enrich medications with hospital-formulary-derived ATC code and flags
so DDI matching, analytics, and FHIR export can use WHO ATC classification.

Populated by app.fhir.his_converter using
backend/app/fhir/code_maps/drug_formulary.csv (1,670 codes, 97% of DB rows).
"""
from alembic import op


revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE medications
            ADD COLUMN IF NOT EXISTS atc_code VARCHAR(10),
            ADD COLUMN IF NOT EXISTS is_antibiotic BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS kidney_relevant BOOLEAN,
            ADD COLUMN IF NOT EXISTS coding_source VARCHAR(20)
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_medications_atc_code "
        "ON medications (atc_code) WHERE atc_code IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_medications_is_antibiotic "
        "ON medications (is_antibiotic) WHERE is_antibiotic = TRUE"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_medications_is_antibiotic")
    op.execute("DROP INDEX IF EXISTS ix_medications_atc_code")
    op.execute(
        """
        ALTER TABLE medications
            DROP COLUMN IF EXISTS coding_source,
            DROP COLUMN IF EXISTS kidney_relevant,
            DROP COLUMN IF EXISTS is_antibiotic,
            DROP COLUMN IF EXISTS atc_code
        """
    )
