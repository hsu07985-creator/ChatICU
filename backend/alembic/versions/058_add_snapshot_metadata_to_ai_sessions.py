"""Add snapshot_metadata JSONB to ai_sessions for delta tracking

Revision ID: 058
Revises: 057
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE ai_sessions
        ADD COLUMN IF NOT EXISTS snapshot_metadata JSONB
    """)


def downgrade() -> None:
    op.drop_column("ai_sessions", "snapshot_metadata")
