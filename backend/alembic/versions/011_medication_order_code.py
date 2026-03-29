"""Add order_code column to medications table.

Revision ID: 011_medication_order_code
Revises: 010_clinical_scores
Create Date: 2026-03-03
"""

from alembic import op
import sqlalchemy as sa

revision = "011_medication_order_code"
down_revision = "010_clinical_scores"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("medications", sa.Column("order_code", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("medications", "order_code")
