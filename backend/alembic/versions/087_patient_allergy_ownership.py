"""Track whether patient allergies are owned by structured HIS data.

Revision ID: 087
Revises: 086
"""
from alembic import op


revision = "087"
down_revision = "086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS "
        "allergies_from_his BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE patients DROP COLUMN IF EXISTS allergies_from_his")
