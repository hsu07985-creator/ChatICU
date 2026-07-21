"""drop patients.left_unit

The getICUbed-roster "left ICU" flag (migration 081) is superseded by census
auto-archive keyed on the patient/ directory set (a patient no longer exported
by HIS is discharged → archived directly). The flag has no consumer; drop it.

See docs/his-sync/census-left-unit-detection-design-2026-07-21.md

Revision ID: 082
Revises: 081
"""
from alembic import op

revision = "082"
down_revision = "081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE patients DROP COLUMN IF EXISTS left_unit")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS left_unit BOOLEAN NOT NULL DEFAULT FALSE"
    )
