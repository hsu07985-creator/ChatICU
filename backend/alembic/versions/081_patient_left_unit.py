"""patient left_unit census flag

Adds patients.left_unit — True when the patient's MRN is absent from the latest
getICUbed roster (left the ICU: transfer/discharge), distinct from `archived`
(death). Schema-only; the flag is populated by HIS sync, not backfilled here.

See docs/his-sync/census-left-unit-detection-design-2026-07-21.md

Revision ID: 081
Revises: 080
"""
from alembic import op

revision = "081"
down_revision = "080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS → idempotent, safe on a fresh DB and on re-run.
    op.execute(
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS left_unit BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE patients DROP COLUMN IF EXISTS left_unit")
