"""Add tracheostomy fields to patients.

Revision ID: 068
Revises: 067
Create Date: 2026-04-24 13:25:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "068"
down_revision = "067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "patients",
        sa.Column("tracheostomy", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "patients",
        sa.Column("tracheostomy_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("patients", "tracheostomy_date")
    op.drop_column("patients", "tracheostomy")
