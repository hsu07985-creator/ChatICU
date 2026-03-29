"""Fix missing updated_at columns that 010_schema_hardening failed to apply.

Revision ID: 023_fix_updated_at
Revises: 022_pgvector_rag
Create Date: 2026-03-30
"""

import sqlalchemy as sa
from alembic import op

revision = "023_fix_updated_at"
down_revision = "022_pgvector_rag"
branch_labels = None
depends_on = None

_TABLES = [
    "patients",
    "medications",
    "users",
    "vital_signs",
    "lab_data",
    "ventilator_settings",
    "weaning_assessments",
    "patient_messages",
    "team_chat_messages",
    "pharmacy_advices",
    "error_reports",
    "audit_logs",
    "drug_interactions",
    "iv_compatibilities",
]


def upgrade() -> None:
    conn = op.get_bind()
    for table in _TABLES:
        # Check if column already exists before adding
        result = conn.execute(sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :tbl AND column_name = 'updated_at'"
        ), {"tbl": table})
        if result.fetchone() is None:
            op.add_column(
                table,
                sa.Column(
                    "updated_at",
                    sa.DateTime(timezone=True),
                    server_default=sa.text("now()"),
                    nullable=False,
                ),
            )


def downgrade() -> None:
    pass  # No-op: don't remove columns that may have been added by 010
