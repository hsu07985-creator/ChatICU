"""Add composite indexes for time-series queries and common filters.

PostgreSQL B-tree indexes support backward scan, so (patient_id, timestamp)
works efficiently for both ASC and DESC ordering.

Revision ID: 009_indexes
Revises: 008_add_fks
Create Date: 2026-02-18
"""

from alembic import op

revision = "009_indexes"
down_revision = "008_add_fks"
branch_labels = None
depends_on = None

# (index_name, table, columns)
_INDEXES = [
    # Time-series composite indexes (patient_id + timestamp)
    ("ix_lab_data_patient_ts", "lab_data", ["patient_id", "timestamp"]),
    ("ix_vital_signs_patient_ts", "vital_signs", ["patient_id", "timestamp"]),
    ("ix_ventilator_settings_patient_ts", "ventilator_settings", ["patient_id", "timestamp"]),
    ("ix_weaning_assessments_patient_ts", "weaning_assessments", ["patient_id", "timestamp"]),
    ("ix_med_admins_patient_sched", "medication_administrations", ["patient_id", "scheduled_time"]),
    ("ix_patient_messages_patient_ts", "patient_messages", ["patient_id", "timestamp"]),
    # Medication status filtering
    ("ix_medications_patient_status", "medications", ["patient_id", "status"]),
    # Audit log time-range queries
    ("ix_audit_logs_timestamp", "audit_logs", ["timestamp"]),
    # Error report triage
    ("ix_error_reports_status_severity", "error_reports", ["status", "severity"]),
    ("ix_error_reports_timestamp", "error_reports", ["timestamp"]),
    # Pharmacy advice reports
    ("ix_pharmacy_advices_timestamp", "pharmacy_advices", ["timestamp"]),
]


def upgrade() -> None:
    for name, table, columns in _INDEXES:
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
