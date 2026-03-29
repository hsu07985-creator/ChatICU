"""Add mentioned_roles to team_chat_messages and patient_messages.

Revision ID: 016_mentioned_roles
Revises: 015_team_chat_replies_read
Create Date: 2026-03-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "016_mentioned_roles"
down_revision = "015_team_chat_replies_read"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "team_chat_messages",
        sa.Column("mentioned_roles", JSONB, nullable=True),
    )
    op.add_column(
        "patient_messages",
        sa.Column("mentioned_roles", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("patient_messages", "mentioned_roles")
    op.drop_column("team_chat_messages", "mentioned_roles")
