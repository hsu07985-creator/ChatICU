"""Add partial index for top-level patient messages (H7)

The hot query in ``app/routers/messages.py`` filters
``WHERE patient_id = ? AND reply_to_id IS NULL ORDER BY timestamp DESC``.
The existing composite index ``ix_patient_messages_patient_ts`` covers
``(patient_id, timestamp)`` but cannot use the ``IS NULL`` predicate
efficiently. This adds a partial index matching the predicate exactly
so the planner can do a backward index scan without filter.

Revision ID: 059
Revises: 058
"""
from alembic import op

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_patient_messages_toplevel
        ON patient_messages (patient_id, timestamp DESC)
        WHERE reply_to_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_patient_messages_toplevel")
