"""Add discharge metadata columns to patients.

Supports soft-discharge flow: when a patient is archived, record discharge
type (一般出院/轉院/死亡/其他), discharge date, optional reason, and
archived_at timestamp. Allows the new /patients/discharged UI to filter
and display historical discharged patients while preserving all clinical
records.

Revision ID: 062
Revises: 061
"""
from alembic import op


revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE patients
            ADD COLUMN IF NOT EXISTS discharge_type VARCHAR(20),
            ADD COLUMN IF NOT EXISTS discharge_date DATE,
            ADD COLUMN IF NOT EXISTS discharge_reason TEXT,
            ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_patients_discharge_date "
        "ON patients (discharge_date) WHERE discharge_date IS NOT NULL"
    )
    # Backfill archived_at for patients already archived before this migration,
    # so the UI has a non-null timestamp to display.
    op.execute(
        "UPDATE patients SET archived_at = NOW() "
        "WHERE archived = TRUE AND archived_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_patients_discharge_date")
    op.execute(
        """
        ALTER TABLE patients
            DROP COLUMN IF EXISTS archived_at,
            DROP COLUMN IF EXISTS discharge_reason,
            DROP COLUMN IF EXISTS discharge_date,
            DROP COLUMN IF EXISTS discharge_type
        """
    )
