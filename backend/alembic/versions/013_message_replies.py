"""Add reply threading to patient_messages.

Revision ID: 013_message_replies
Revises: 012_drop_messages_patient_fk
Create Date: 2026-03-04
"""

from alembic import op
import sqlalchemy as sa

revision = "013_message_replies"
down_revision = "012_drop_messages_patient_fk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "patient_messages",
        sa.Column("reply_to_id", sa.String(50), nullable=True),
    )
    op.add_column(
        "patient_messages",
        sa.Column("reply_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index(
        "ix_patient_messages_reply_to_id",
        "patient_messages",
        ["reply_to_id"],
    )
    op.create_foreign_key(
        "fk_patient_messages_reply_to_id",
        "patient_messages",
        "patient_messages",
        ["reply_to_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_patient_messages_reply_to_id",
        "patient_messages",
        type_="foreignkey",
    )
    op.drop_index("ix_patient_messages_reply_to_id", "patient_messages")
    op.drop_column("patient_messages", "reply_count")
    op.drop_column("patient_messages", "reply_to_id")
