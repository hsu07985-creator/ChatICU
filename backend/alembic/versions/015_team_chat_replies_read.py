"""Add reply threading and read tracking to team_chat_messages.

Revision ID: 015_team_chat_replies_read
Revises: 014_message_tags
Create Date: 2026-03-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "015_team_chat_replies_read"
down_revision = "014_message_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Reply threading
    op.add_column(
        "team_chat_messages",
        sa.Column("reply_to_id", sa.String(50), nullable=True),
    )
    op.add_column(
        "team_chat_messages",
        sa.Column("reply_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index(
        "ix_team_chat_messages_reply_to_id",
        "team_chat_messages",
        ["reply_to_id"],
    )
    op.create_foreign_key(
        "fk_team_chat_messages_reply_to_id",
        "team_chat_messages",
        "team_chat_messages",
        ["reply_to_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Read tracking
    op.add_column(
        "team_chat_messages",
        sa.Column("is_read", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "team_chat_messages",
        sa.Column("read_by", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("team_chat_messages", "read_by")
    op.drop_column("team_chat_messages", "is_read")
    op.drop_constraint(
        "fk_team_chat_messages_reply_to_id",
        "team_chat_messages",
        type_="foreignkey",
    )
    op.drop_index("ix_team_chat_messages_reply_to_id", "team_chat_messages")
    op.drop_column("team_chat_messages", "reply_count")
    op.drop_column("team_chat_messages", "reply_to_id")
