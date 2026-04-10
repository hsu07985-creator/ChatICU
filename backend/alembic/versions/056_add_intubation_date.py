"""Add intubation_date column to patients table.

Allows auto-calculation of ventilator_days from intubation_date to today.

Revision ID: 056
Revises: 055
"""

revision = "056"
down_revision = "055"

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column("patients", sa.Column("intubation_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("patients", "intubation_date")
