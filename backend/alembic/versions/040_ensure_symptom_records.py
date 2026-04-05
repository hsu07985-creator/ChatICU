"""Ensure symptom_records table exists (idempotent re-run of 039).

Revision ID: 040
Revises: 039
"""

from alembic import op

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS symptom_records (
            id VARCHAR(50) PRIMARY KEY,
            patient_id VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
            recorded_at TIMESTAMPTZ NOT NULL,
            symptoms JSONB,
            recorded_by JSONB,
            notes VARCHAR(1000),
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_symptom_records_patient_id
        ON symptom_records (patient_id)
    """)


def downgrade() -> None:
    pass
