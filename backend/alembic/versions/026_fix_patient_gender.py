"""fix swapped gender for pat_002 and pat_003

Revision ID: 026
Revises: 025
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pat_002 (I-2) name contains "小姐" (Miss) but gender is "男" → fix to "女"
    op.execute(
        sa.text(
            "UPDATE patients SET gender = '女' "
            "WHERE id = 'pat_002' AND gender = '男' AND name LIKE '%小姐%'"
        )
    )
    # pat_003 (I-3) name contains "先生" (Mr.) but gender is "女" → fix to "男"
    op.execute(
        sa.text(
            "UPDATE patients SET gender = '男' "
            "WHERE id = 'pat_003' AND gender = '女' AND name LIKE '%先生%'"
        )
    )


def downgrade() -> None:
    # Reverse the fix
    op.execute(
        sa.text(
            "UPDATE patients SET gender = '男' "
            "WHERE id = 'pat_002' AND gender = '女' AND name LIKE '%小姐%'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE patients SET gender = '女' "
            "WHERE id = 'pat_003' AND gender = '男' AND name LIKE '%先生%'"
        )
    )
