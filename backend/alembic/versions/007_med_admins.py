"""Add medication_administrations table for persisted administration records.

Revision ID: 007_med_admins
Revises: 006_pharm_compat_favs
Create Date: 2026-02-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "007_med_admins"
down_revision = "006_pharm_compat_favs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "medication_administrations",
        sa.Column("id", sa.String(60), primary_key=True),
        sa.Column("medication_id", sa.String(50), sa.ForeignKey("medications.id"), nullable=False),
        sa.Column("patient_id", sa.String(50), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("scheduled_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("administered_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("dose", sa.String(50), nullable=True),
        sa.Column("route", sa.String(20), nullable=True),
        sa.Column("administered_by", postgresql.JSONB(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_medication_administrations_medication_id",
        "medication_administrations",
        ["medication_id"],
    )
    op.create_index(
        "ix_medication_administrations_patient_id",
        "medication_administrations",
        ["patient_id"],
    )
    op.create_index(
        "ix_medication_administrations_scheduled_time",
        "medication_administrations",
        ["scheduled_time"],
    )
    op.create_index(
        "ix_medication_administrations_med_sched",
        "medication_administrations",
        ["medication_id", "scheduled_time"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_medication_administrations_med_sched",
        table_name="medication_administrations",
    )
    op.drop_index(
        "ix_medication_administrations_scheduled_time",
        table_name="medication_administrations",
    )
    op.drop_index(
        "ix_medication_administrations_patient_id",
        table_name="medication_administrations",
    )
    op.drop_index(
        "ix_medication_administrations_medication_id",
        table_name="medication_administrations",
    )
    op.drop_table("medication_administrations")
