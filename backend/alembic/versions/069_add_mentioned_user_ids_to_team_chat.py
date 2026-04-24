"""Add mentioned_user_ids to team_chat_messages.

Revision ID: 069
Revises: 068
Create Date: 2026-04-24 18:30:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "069"
down_revision = "068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("team_chat_messages")}
    if "mentioned_user_ids" not in cols:
        op.add_column(
            "team_chat_messages",
            sa.Column(
                "mentioned_user_ids",
                JSONB,
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )


def downgrade() -> None:
    op.drop_column("team_chat_messages", "mentioned_user_ids")
