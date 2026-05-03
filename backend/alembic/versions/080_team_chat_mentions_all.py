"""Add mentions_all flag to team_chat_messages.

Lets a sender @ everyone in one go ("@所有人"). Stored as a dedicated
boolean column rather than expanded into ``mentioned_user_ids`` at send
time so:

- The set is dynamic — a user added after the message is posted is
  still treated as @-ed when computing their bell badge.
- The mention predicate stays index-friendly: a partial index on
  ``mentions_all = TRUE`` is tiny because @所有人 is rare relative to
  total messages.
- Per-user ``read_by`` semantics carry over unchanged — each recipient
  still acks individually.

Idempotent: ``IF NOT EXISTS`` guards a re-run.
"""

from alembic import op


revision = "080"
down_revision = "079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE team_chat_messages
        ADD COLUMN IF NOT EXISTS mentions_all BOOLEAN NOT NULL DEFAULT FALSE
        """
    )
    # Partial index: only the rare @所有人 rows. Mention predicate ORs
    # this with mentioned_user_ids / mentioned_roles, so the planner can
    # bitmap-OR a tiny scan into the existing GIN paths.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_team_chat_messages_mentions_all
        ON team_chat_messages (timestamp DESC)
        WHERE mentions_all = TRUE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_team_chat_messages_mentions_all")
    op.execute(
        "ALTER TABLE team_chat_messages DROP COLUMN IF EXISTS mentions_all"
    )
