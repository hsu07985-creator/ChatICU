"""Add GIN indexes on team_chat_messages.mentioned_user_ids / mentioned_roles.

Mention/notification queries (``mentions/count``, ``notifications/summary``)
previously used ``cast(JSONB as text) LIKE`` to find rows where the caller
was @-mentioned. That pattern:

1. Cannot use any index — every call full-scans the table.
2. Is brittle once role names share a prefix (e.g. ``"all"`` vs a future
   ``"all_admins"``).

Switching the predicate to JSONB containment (``mentioned_user_ids @>
'["usr_x"]'`` / ``mentioned_roles @> '["admin"]'``) is both correct and
GIN-indexable. This migration creates the supporting indexes.

Idempotent: ``CREATE INDEX IF NOT EXISTS`` guards a re-run.
"""

from alembic import op


revision = "076"
down_revision = "075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_team_chat_messages_mentioned_user_ids_gin
        ON team_chat_messages USING GIN (mentioned_user_ids)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_team_chat_messages_mentioned_roles_gin
        ON team_chat_messages USING GIN (mentioned_roles)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_team_chat_messages_mentioned_roles_gin")
    op.execute("DROP INDEX IF EXISTS ix_team_chat_messages_mentioned_user_ids_gin")
