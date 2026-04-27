"""Add mentioned_user_ids to patient_messages.

Revision ID: 070
Revises: 069
Create Date: 2026-04-27 10:00:00.000000

Uses raw SQL ``ADD COLUMN IF NOT EXISTS`` (Postgres ≥ 9.6) so the migration is
robust to the column already existing or alembic introspection differences
between dev/prod environments.
"""

from alembic import op


revision = "070"
down_revision = "069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE patient_messages "
        "ADD COLUMN IF NOT EXISTS mentioned_user_ids JSONB "
        "DEFAULT '[]'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE patient_messages DROP COLUMN IF EXISTS mentioned_user_ids")
