"""Drop patient_messages patient_id FK to support Layer2 patients.

Patient messages can reference patients from Layer2Store (JSON-based)
which are not present in the patients DB table. The FK constraint
caused 500 errors when posting messages for Layer2 patients.

Revision ID: 012_drop_messages_patient_fk
Revises: 011_medication_order_code
Create Date: 2026-03-04
"""

from alembic import op

revision = "012_drop_messages_patient_fk"
down_revision = "011_medication_order_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "patient_messages_patient_id_fkey",
        "patient_messages",
        type_="foreignkey",
    )


def downgrade() -> None:
    op.create_foreign_key(
        "patient_messages_patient_id_fkey",
        "patient_messages",
        "patients",
        ["patient_id"],
        ["id"],
    )
