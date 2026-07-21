"""Add medications.nhi_code (Taiwan NHI drug code passthrough).

HIS getAllMedicine supplies NHI_CODE (10-char national drug code) at ~99% fill.
Capture it as a nullable passthrough for future NHI-reimbursement / cross-hospital
reconciliation features. No consumer today. Schema-only, idempotent, fresh-DB safe.
NOTE: never use as a join/dedup key (null on some procedure/OTC meds) — use
order_code / atc_code (see patient-snapshot-field-inventory-2026-07-21.md).

Revision ID: 084
Revises: 083
"""
from alembic import op


revision = "084"
down_revision = "083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE medications ADD COLUMN IF NOT EXISTS nhi_code VARCHAR(12)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE medications DROP COLUMN IF EXISTS nhi_code")
