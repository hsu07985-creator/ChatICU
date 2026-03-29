"""Add tags column to patient_messages.

Revision ID: 014_message_tags
Revises: 013_message_replies
Create Date: 2026-03-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "014_message_tags"
down_revision = "013_message_replies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "patient_messages",
        sa.Column("tags", JSONB, nullable=True, server_default="[]"),
    )
    op.create_index(
        "ix_patient_messages_tags",
        "patient_messages",
        ["tags"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_patient_messages_tags", "patient_messages")
    op.drop_column("patient_messages", "tags")
