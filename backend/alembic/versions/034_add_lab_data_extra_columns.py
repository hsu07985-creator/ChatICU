"""Add cardiac, thyroid, hormone, lipid, other JSONB columns to lab_data.

These columns support additional lab categories that the frontend already
has UI placeholders for (cardiac markers, thyroid, etc.).

Revision ID: 034
Revises: 033
Create Date: 2026-04-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col_name in ("cardiac", "thyroid", "hormone", "lipid", "other"):
        op.add_column(
            "lab_data",
            sa.Column(col_name, JSONB, nullable=True),
        )


def downgrade() -> None:
    for col_name in ("other", "lipid", "hormone", "thyroid", "cardiac"):
        op.drop_column("lab_data", col_name)
