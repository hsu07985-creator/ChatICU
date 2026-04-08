"""Drop patient_messages patient_id FK to support Layer2 patients.

Patient messages can reference patients from Layer2Store (JSON-based)
which are not present in the patients DB table. The FK constraint
caused 500 errors when posting messages for Layer2 patients.

Revision ID: 012_drop_messages_patient_fk
Revises: 011_medication_order_code
Create Date: 2026-03-04
"""

from alembic import op
from sqlalchemy import text

revision = "012_drop_messages_patient_fk"
down_revision = "011_medication_order_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Find the actual FK constraint name (may differ from assumed name)
    result = conn.execute(text(
        "SELECT conname FROM pg_constraint "
        "WHERE conrelid = 'patient_messages'::regclass "
        "AND contype = 'f' AND conkey @> ARRAY["
        "(SELECT attnum FROM pg_attribute WHERE attrelid = 'patient_messages'::regclass AND attname = 'patient_id')"
        "]"
    ))
    row = result.fetchone()
    if row:
        op.drop_constraint(row[0], "patient_messages", type_="foreignkey")
    # If no FK exists, nothing to drop — safe to continue


def downgrade() -> None:
    op.create_foreign_key(
        "patient_messages_patient_id_fkey",
        "patient_messages",
        "patients",
        ["patient_id"],
        ["id"],
    )
