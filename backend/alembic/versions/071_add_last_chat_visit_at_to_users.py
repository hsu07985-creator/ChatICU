"""Add last_chat_visit_at to users.

Revision ID: 071
Revises: 070
Create Date: 2026-04-28 13:30:00.000000

Backs the per-user "team chat unread count" sidebar badge: a message counts as
unread for me when its timestamp is greater than my last_chat_visit_at. The
column is backfilled with NOW() on first run so existing users start at "all
caught up" rather than seeing every historical message flagged as new.
"""

from alembic import op


revision = "071"
down_revision = "070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS last_chat_visit_at TIMESTAMPTZ"
    )
    # Idempotent: after the first run every row has a value, so the WHERE
    # matches nothing on subsequent runs.
    op.execute(
        "UPDATE users SET last_chat_visit_at = NOW() WHERE last_chat_visit_at IS NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_chat_visit_at")
