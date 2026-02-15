"""add password_history table and users.password_changed_at column

Revision ID: 002_password_history
Revises: 001_initial
Create Date: 2026-02-15 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '002_password_history'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add password_changed_at to users
    op.add_column('users', sa.Column(
        'password_changed_at', sa.DateTime(timezone=True), nullable=True
    ))

    # Create password_history table
    op.create_table(
        'password_history',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('user_id', sa.String(50), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_password_history_user_id', 'password_history', ['user_id'])


def downgrade() -> None:
    op.drop_table('password_history')
    op.drop_column('users', 'password_changed_at')
