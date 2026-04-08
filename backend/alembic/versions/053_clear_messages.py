"""Clear all patient_messages and team_chat_messages."""

from alembic import op

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM patient_messages")
    op.execute("DELETE FROM team_chat_messages")


def downgrade() -> None:
    pass  # data deletion is not reversible
