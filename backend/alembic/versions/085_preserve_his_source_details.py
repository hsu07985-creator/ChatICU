"""Preserve source-complete HIS medication and culture payloads.

Revision ID: 085
Revises: 084
"""
from alembic import op


revision = "085"
down_revision = "084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE medications ADD COLUMN IF NOT EXISTS source_details JSONB"
    )
    op.execute(
        "ALTER TABLE culture_results ADD COLUMN IF NOT EXISTS source_campus VARCHAR(50)"
    )
    op.execute(
        "ALTER TABLE culture_results ADD COLUMN IF NOT EXISTS source_details JSONB"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE culture_results DROP COLUMN IF EXISTS source_details")
    op.execute("ALTER TABLE culture_results DROP COLUMN IF EXISTS source_campus")
    op.execute("ALTER TABLE medications DROP COLUMN IF EXISTS source_details")
