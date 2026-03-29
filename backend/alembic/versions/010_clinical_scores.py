"""Add clinical_scores table for Pain and RASS score tracking.

Revision ID: 010_clinical_scores
Revises: 010_schema_hardening
Create Date: 2026-03-03
"""

from alembic import op
import sqlalchemy as sa

revision = "010_clinical_scores"
down_revision = "010_schema_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clinical_scores",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("patient_id", sa.String(50), nullable=False, index=True),
        sa.Column("score_type", sa.String(20), nullable=False),
        sa.Column("value", sa.Integer, nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_by", sa.String(50), nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_clinical_scores_patient_type_ts",
        "clinical_scores",
        ["patient_id", "score_type", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index("ix_clinical_scores_patient_type_ts", table_name="clinical_scores")
    op.drop_table("clinical_scores")
