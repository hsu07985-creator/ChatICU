"""Add intubation_date column to patients table.

Allows auto-calculation of ventilator_days from intubation_date to today.

Revision ID: 056
Revises: 055
"""

revision = "056"
down_revision = "055"

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("patients")]
    if "intubation_date" not in columns:
        op.add_column("patients", sa.Column("intubation_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("patients", "intubation_date")
