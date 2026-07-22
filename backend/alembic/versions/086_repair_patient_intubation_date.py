"""Repair patients.intubation_date on databases with historical schema drift.

Revision ID: 086
Revises: 085
"""
from alembic import op


revision = "086"
down_revision = "085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS intubation_date DATE"
    )


def downgrade() -> None:
    # Migration 056 owns this column; 086 only repairs databases where 056 was
    # marked applied without the physical column, so downgrade must keep it.
    pass
