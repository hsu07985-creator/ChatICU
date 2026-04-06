"""Create custom_tags table for team-shared custom tags.

Revision ID: 041
Revises: 040
"""

from alembic import op

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS custom_tags (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(30) NOT NULL UNIQUE,
            created_by_id VARCHAR(50) NOT NULL,
            created_by_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_custom_tags_name
        ON custom_tags (name)
    """)


def downgrade() -> None:
    pass
