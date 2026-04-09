"""Add np (專科護理師) role to users CHECK constraint.

Revision ID: 054
Revises: 053
"""

revision = "054"
down_revision = "053"

from alembic import op


def upgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role_valid")
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_role_valid "
        "CHECK (role IN ('doctor','nurse','pharmacist','admin','np'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role_valid")
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_role_valid "
        "CHECK (role IN ('doctor','nurse','pharmacist','admin'))"
    )
