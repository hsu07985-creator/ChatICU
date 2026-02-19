"""Add missing ForeignKey constraints with ondelete behavior.

Adds FK constraints to 5 tables (8 columns total) that previously stored
reference IDs without database-level referential integrity.

Revision ID: 008_add_fks
Revises: 007_med_admins
Create Date: 2026-02-18
"""

from alembic import op

revision = "008_add_fks"
down_revision = "007_med_admins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- error_reports ---
    op.create_foreign_key(
        "fk_error_reports_patient_id",
        "error_reports", "patients",
        ["patient_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_error_reports_reporter_id",
        "error_reports", "users",
        ["reporter_id"], ["id"],
        ondelete="RESTRICT",
    )

    # --- ai_sessions ---
    op.create_foreign_key(
        "fk_ai_sessions_user_id",
        "ai_sessions", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_ai_sessions_patient_id",
        "ai_sessions", "patients",
        ["patient_id"], ["id"],
        ondelete="SET NULL",
    )

    # --- pharmacy_advices ---
    op.create_foreign_key(
        "fk_pharmacy_advices_patient_id",
        "pharmacy_advices", "patients",
        ["patient_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_pharmacy_advices_pharmacist_id",
        "pharmacy_advices", "users",
        ["pharmacist_id"], ["id"],
        ondelete="RESTRICT",
    )

    # --- pharmacy_compatibility_favorites ---
    op.create_foreign_key(
        "fk_pharm_compat_favs_user_id",
        "pharmacy_compatibility_favorites", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )

    # --- patient_messages ---
    op.create_foreign_key(
        "fk_patient_messages_author_id",
        "patient_messages", "users",
        ["author_id"], ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_patient_messages_author_id", "patient_messages", type_="foreignkey")
    op.drop_constraint("fk_pharm_compat_favs_user_id", "pharmacy_compatibility_favorites", type_="foreignkey")
    op.drop_constraint("fk_pharmacy_advices_pharmacist_id", "pharmacy_advices", type_="foreignkey")
    op.drop_constraint("fk_pharmacy_advices_patient_id", "pharmacy_advices", type_="foreignkey")
    op.drop_constraint("fk_ai_sessions_patient_id", "ai_sessions", type_="foreignkey")
    op.drop_constraint("fk_ai_sessions_user_id", "ai_sessions", type_="foreignkey")
    op.drop_constraint("fk_error_reports_reporter_id", "error_reports", type_="foreignkey")
    op.drop_constraint("fk_error_reports_patient_id", "error_reports", type_="foreignkey")
