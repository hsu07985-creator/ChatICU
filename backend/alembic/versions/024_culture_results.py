"""create culture_results table

Revision ID: 024
Revises: 023
Create Date: 2026-03-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "culture_results",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column(
            "patient_id",
            sa.String(50),
            sa.ForeignKey("patients.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("sheet_number", sa.String(50), nullable=False),
        sa.Column("specimen", sa.String(100), nullable=False),
        sa.Column("specimen_code", sa.String(20), nullable=False),
        sa.Column("department", sa.String(100), nullable=False, server_default=""),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("isolates", postgresql.JSONB(), nullable=True),
        sa.Column("susceptibility", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("culture_results")
