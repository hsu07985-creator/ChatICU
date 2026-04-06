"""Add composite indexes for query performance.

- vital_signs(patient_id, timestamp DESC)
- lab_data(patient_id, timestamp DESC)
- medications(status) for dashboard aggregation

Revision ID: 042
Revises: 041
"""

from alembic import op
from sqlalchemy import text

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_vital_signs_patient_timestamp "
        "ON vital_signs (patient_id, timestamp DESC)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_lab_data_patient_timestamp "
        "ON lab_data (patient_id, timestamp DESC)"
    ))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_medications_status "
        "ON medications (status)"
    ))


def downgrade() -> None:
    op.drop_index("ix_medications_status", table_name="medications")
    op.drop_index("ix_lab_data_patient_timestamp", table_name="lab_data")
    op.drop_index("ix_vital_signs_patient_timestamp", table_name="vital_signs")
