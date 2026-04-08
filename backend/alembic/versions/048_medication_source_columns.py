"""Add medication source columns + patient campus.

Revision ID: 048
Revises: 047
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def _add_column_if_not_exists(conn, table: str, column: str, col_type: str, default: str = "") -> None:
    """Add a column only if it doesn't already exist (PostgreSQL)."""
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :tbl AND column_name = :col"
    ), {"tbl": table, "col": column}).fetchone()
    if result:
        return
    default_clause = f" DEFAULT {default}" if default else ""
    conn.execute(sa.text(f'ALTER TABLE {table} ADD COLUMN "{column}" {col_type}{default_clause}'))


def upgrade() -> None:
    conn = op.get_bind()

    # -- medications: 7 new columns for outpatient source tracking --
    _add_column_if_not_exists(conn, "medications", "source_type", "VARCHAR(20) NOT NULL", "'inpatient'")
    _add_column_if_not_exists(conn, "medications", "source_campus", "VARCHAR(50)")
    _add_column_if_not_exists(conn, "medications", "prescribing_hospital", "VARCHAR(200)")
    _add_column_if_not_exists(conn, "medications", "prescribing_department", "VARCHAR(100)")
    _add_column_if_not_exists(conn, "medications", "prescribing_doctor_name", "VARCHAR(100)")
    _add_column_if_not_exists(conn, "medications", "days_supply", "INTEGER")
    _add_column_if_not_exists(conn, "medications", "is_external", "BOOLEAN NOT NULL", "false")
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_medications_source_type ON medications (source_type)"
    ))

    # -- patients: campus column --
    _add_column_if_not_exists(conn, "patients", "campus", "VARCHAR(50)")


def downgrade() -> None:
    with op.batch_alter_table("patients") as batch_op:
        batch_op.drop_column("campus")

    with op.batch_alter_table("medications") as batch_op:
        batch_op.drop_index("ix_medications_source_type")
        batch_op.drop_column("is_external")
        batch_op.drop_column("days_supply")
        batch_op.drop_column("prescribing_doctor_name")
        batch_op.drop_column("prescribing_department")
        batch_op.drop_column("prescribing_hospital")
        batch_op.drop_column("source_campus")
        batch_op.drop_column("source_type")
