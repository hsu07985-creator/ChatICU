"""Add mentioned_user_ids to patient_messages.

Revision ID: 070
Revises: 069
Create Date: 2026-04-27 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "070"
down_revision = "069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("patient_messages")}
    if "mentioned_user_ids" not in cols:
        op.add_column(
            "patient_messages",
            sa.Column(
                "mentioned_user_ids",
                JSONB,
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )


def downgrade() -> None:
    op.drop_column("patient_messages", "mentioned_user_ids")
