"""Soft delete for team_chat_messages (TC-B11 / F-16).

Hard deletes erased the audit trail: admin removed a message at 14:32 →
audit log says "刪除團隊訊息 target=tchat_xxx" but the content is gone.
A reply quoting the message also lost its parent reference (FK SET NULL
from migration 015) and rendered as an orphan in the UI.

Switch to soft delete:
- ``deleted_at`` (timestamp) marks the row removed.
- ``deleted_by_id`` records who did it (FK to users with SET NULL so the
  user being deleted later doesn't break this column).
- Application-level: list queries filter ``deleted_at IS NULL``;
  audit log carries a 500-char content snapshot in ``details`` so the
  full record exists in the audit table even after the row is hidden.

Idempotent: ``IF NOT EXISTS`` guards a re-run.
"""

from alembic import op
import sqlalchemy as sa


revision = "078"
down_revision = "077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE team_chat_messages
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE team_chat_messages
        ADD COLUMN IF NOT EXISTS deleted_by_id VARCHAR(50)
        """
    )
    # Partial index: most rows are not deleted, so only index the
    # exception. Speeds up the list query's NOT-deleted filter.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_team_chat_messages_deleted_at
        ON team_chat_messages (deleted_at)
        WHERE deleted_at IS NOT NULL
        """
    )
    # FK on deleted_by_id with ON DELETE SET NULL so deleting the
    # admin user later doesn't fail or lose the soft-delete record.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_team_chat_messages_deleted_by_id'
                  AND table_name = 'team_chat_messages'
            ) THEN
                ALTER TABLE team_chat_messages
                ADD CONSTRAINT fk_team_chat_messages_deleted_by_id
                FOREIGN KEY (deleted_by_id)
                REFERENCES users(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE team_chat_messages "
        "DROP CONSTRAINT IF EXISTS fk_team_chat_messages_deleted_by_id"
    )
    op.execute("DROP INDEX IF EXISTS ix_team_chat_messages_deleted_at")
    op.execute(
        "ALTER TABLE team_chat_messages DROP COLUMN IF EXISTS deleted_by_id"
    )
    op.execute(
        "ALTER TABLE team_chat_messages DROP COLUMN IF EXISTS deleted_at"
    )
