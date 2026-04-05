"""Create symptom_records table for tracking symptom history over time.

Revision ID: 039
Revises: 038
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "symptom_records",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column(
            "patient_id",
            sa.String(50),
            sa.ForeignKey("patients.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("symptoms", JSONB, nullable=True),
        sa.Column("recorded_by", JSONB, nullable=True),
        sa.Column("notes", sa.String(1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("symptom_records")
