"""Add missing columns and tables for HIS data import.

Adds: patients.campus, medications (8 cols), lab_data (6 JSONB cols),
diagnostic_reports table.

Revision ID: 055
Revises: 054
"""

revision = "055"
down_revision = "054"

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


def _add_col_if_not_exists(table: str, column: str, col_type: str, default: str = None):
    """Idempotent ADD COLUMN."""
    default_clause = f" DEFAULT {default}" if default else ""
    op.execute(f"""
        DO $$ BEGIN
            ALTER TABLE {table} ADD COLUMN {column} {col_type}{default_clause};
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
    """)


def upgrade() -> None:
    # ---- patients: add campus ----
    _add_col_if_not_exists("patients", "campus", "VARCHAR(50)")

    # ---- medications: add 8 missing columns ----
    _add_col_if_not_exists("medications", "notes", "TEXT")
    _add_col_if_not_exists("medications", "source_type", "VARCHAR(20)", "'inpatient'")
    _add_col_if_not_exists("medications", "source_campus", "VARCHAR(50)")
    _add_col_if_not_exists("medications", "prescribing_hospital", "VARCHAR(200)")
    _add_col_if_not_exists("medications", "prescribing_department", "VARCHAR(100)")
    _add_col_if_not_exists("medications", "prescribing_doctor_name", "VARCHAR(100)")
    _add_col_if_not_exists("medications", "days_supply", "INTEGER")
    _add_col_if_not_exists("medications", "is_external", "BOOLEAN", "false")

    # ---- lab_data: add 6 JSONB category columns ----
    for col in ["venous_blood_gas", "cardiac", "thyroid", "hormone", "lipid", "other"]:
        _add_col_if_not_exists("lab_data", col, "JSONB")

    # ---- diagnostic_reports: create table if not exists ----
    op.execute("""
        CREATE TABLE IF NOT EXISTS diagnostic_reports (
            id VARCHAR(50) PRIMARY KEY,
            patient_id VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
            report_type VARCHAR(50) NOT NULL,
            exam_name VARCHAR(200) NOT NULL,
            exam_date TIMESTAMP WITH TIME ZONE NOT NULL,
            body_text TEXT NOT NULL,
            impression TEXT,
            reporter_name VARCHAR(100),
            status VARCHAR(20) NOT NULL DEFAULT 'final',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_diagnostic_reports_patient_id
        ON diagnostic_reports(patient_id);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS diagnostic_reports")
    for col in ["venous_blood_gas", "cardiac", "thyroid", "hormone", "lipid", "other"]:
        op.execute(f"ALTER TABLE lab_data DROP COLUMN IF EXISTS {col}")
    for col in ["notes", "source_type", "source_campus", "prescribing_hospital",
                "prescribing_department", "prescribing_doctor_name", "days_supply", "is_external"]:
        op.execute(f"ALTER TABLE medications DROP COLUMN IF EXISTS {col}")
    op.execute("ALTER TABLE patients DROP COLUMN IF EXISTS campus")
