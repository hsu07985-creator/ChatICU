"""Add summary + summary_up_to columns to ai_sessions for conversation compression.

Revision ID: 004
Revises: 003
Create Date: 2026-02-15
"""
from alembic import op
import sqlalchemy as sa

revision = "004_ai_session_summary"
down_revision = "003_pharmacy_advices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_sessions", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("ai_sessions", sa.Column("summary_up_to", sa.Integer(), nullable=True, server_default="0"))


def downgrade() -> None:
    op.drop_column("ai_sessions", "summary_up_to")
    op.drop_column("ai_sessions", "summary")
