"""Add pharmacy_advices table for pharmacist care intervention records.

Revision ID: 003
Revises: 002
Create Date: 2026-02-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "003_pharmacy_advices"
down_revision = "002_password_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'pharmacy_advices',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), nullable=False),
        sa.Column('patient_name', sa.String(100), nullable=False),
        sa.Column('bed_number', sa.String(20), nullable=False),
        sa.Column('pharmacist_id', sa.String(50), nullable=False),
        sa.Column('pharmacist_name', sa.String(100), nullable=False),
        sa.Column('advice_code', sa.String(10), nullable=False),
        sa.Column('advice_label', sa.String(200), nullable=False),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('linked_medications', postgresql.JSONB(), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_pharmacy_advices_patient_id', 'pharmacy_advices', ['patient_id'])
    op.create_index('ix_pharmacy_advices_pharmacist_id', 'pharmacy_advices', ['pharmacist_id'])


def downgrade() -> None:
    op.drop_index('ix_pharmacy_advices_pharmacist_id', table_name='pharmacy_advices')
    op.drop_index('ix_pharmacy_advices_patient_id', table_name='pharmacy_advices')
    op.drop_table('pharmacy_advices')
