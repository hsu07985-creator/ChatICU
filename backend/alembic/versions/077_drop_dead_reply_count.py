"""Drop the unused ``team_chat_messages.reply_count`` column.

Migration 015 added ``reply_count INT NOT NULL DEFAULT 0`` to support a
denormalised reply counter, but the SQLAlchemy model never declared the
field and no router updates it. The list endpoint computes
``replyCount`` on the fly via ``len(replies)`` (team_chat.py:59), so the
column has been dead schema since 2024. TC-B12 removes it.

Idempotent: ``DROP COLUMN IF EXISTS`` guards re-runs.
"""

from alembic import op
import sqlalchemy as sa


revision = "077"
down_revision = "076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE team_chat_messages DROP COLUMN IF EXISTS reply_count"
    )


def downgrade() -> None:
    # Restore as a default-0 NOT NULL column to match migration 015's shape.
    # Existing rows will get 0; that matches the value the original code
    # left in there since the column was never maintained.
    op.execute(
        """
        ALTER TABLE team_chat_messages
        ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0
        """
    )
