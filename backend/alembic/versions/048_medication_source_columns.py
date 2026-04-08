"""Add medication source columns + patient campus.

Revision ID: 048
Revises: 047
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- medications: 7 new columns for outpatient source tracking --
    with op.batch_alter_table("medications") as batch_op:
        batch_op.add_column(
            sa.Column("source_type", sa.String(20), nullable=False, server_default="inpatient")
        )
        batch_op.add_column(
            sa.Column("source_campus", sa.String(50), nullable=True)
        )
        batch_op.add_column(
            sa.Column("prescribing_hospital", sa.String(200), nullable=True)
        )
        batch_op.add_column(
            sa.Column("prescribing_department", sa.String(100), nullable=True)
        )
        batch_op.add_column(
            sa.Column("prescribing_doctor_name", sa.String(100), nullable=True)
        )
        batch_op.add_column(
            sa.Column("days_supply", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("is_external", sa.Boolean(), nullable=False, server_default="0")
        )
        batch_op.create_index("ix_medications_source_type", ["source_type"])

    # -- patients: campus column --
    with op.batch_alter_table("patients") as batch_op:
        batch_op.add_column(
            sa.Column("campus", sa.String(50), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("patients") as batch_op:
        batch_op.drop_column("campus")

    with op.batch_alter_table("medications") as batch_op:
        batch_op.drop_index("ix_medications_source_type")
        batch_op.drop_column("is_external")
        batch_op.drop_column("days_supply")
        batch_op.drop_column("prescribing_doctor_name")
        batch_op.drop_column("prescribing_department")
        batch_op.drop_column("prescribing_hospital")
        batch_op.drop_column("source_campus")
        batch_op.drop_column("source_type")
