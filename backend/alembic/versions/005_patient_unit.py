"""Add unit column to patients for data-level access control.

Revision ID: 005_patient_unit
Revises: 004_ai_session_summary
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa

revision = "005_patient_unit"
down_revision = "004_ai_session_summary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("patients", sa.Column("unit", sa.String(length=50), nullable=True))
    op.create_index(op.f("ix_patients_unit"), "patients", ["unit"], unique=False)

    # Seed existing rows with a sensible default for the demo dataset.
    op.execute("UPDATE patients SET unit = '加護病房一' WHERE unit IS NULL")


def downgrade() -> None:
    op.drop_index(op.f("ix_patients_unit"), table_name="patients")
    op.drop_column("patients", "unit")

