"""Schema hardening: FK RESTRICT, CHECK constraints, UNIQUE, indexes, updated_at

Revision ID: 010_schema_hardening
Revises: 009_indexes
"""

import sqlalchemy as sa
from alembic import op

revision = "010_schema_hardening"
down_revision = "009_indexes"
branch_labels = None
depends_on = None

# Tables that need updated_at column
_UPDATED_AT_TABLES = [
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


def _find_fk_name(conn, table, column, ref_table):
    """Look up the actual FK constraint name from pg_constraint.

    Handles both auto-generated names (table_col_fkey) and explicit names
    (fk_table_col) since the naming depends on how the DB was initialized.
    """
    # Use CAST instead of :: to avoid conflict with SQLAlchemy param syntax
    result = conn.execute(sa.text(
        "SELECT c.conname "
        "FROM pg_constraint c "
        "JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid "
        f"WHERE c.conrelid = CAST('{table}' AS regclass) "
        f"AND c.confrelid = CAST('{ref_table}' AS regclass) "
        "AND c.contype = 'f' "
        "AND a.attname = :col"
    ), {"col": column})
    row = result.fetchone()
    if row is None:
        raise RuntimeError(
            f"FK constraint not found: {table}.{column} -> {ref_table}"
        )
    return row[0]


def upgrade() -> None:
    conn = op.get_bind()

    # ── Step 1: Add updated_at columns ──────────────────────────────────
    for table in _UPDATED_AT_TABLES:
        op.add_column(
            table,
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )

    # ── Step 2 & 3: Drop and recreate FKs with correct ON DELETE ──────
    # Dynamically look up constraint names to handle both auto-generated
    # (table_col_fkey) and explicit (fk_table_col) naming conventions.
    _FK_CHANGES = [
        # (table, column, ref_table, ref_col, new_name, on_delete)
        ("medications", "patient_id", "patients", "id", "fk_medications_patient_id", "RESTRICT"),
        ("vital_signs", "patient_id", "patients", "id", "fk_vital_signs_patient_id", "RESTRICT"),
        ("lab_data", "patient_id", "patients", "id", "fk_lab_data_patient_id", "RESTRICT"),
        ("ventilator_settings", "patient_id", "patients", "id", "fk_ventilator_settings_patient_id", "RESTRICT"),
        ("weaning_assessments", "patient_id", "patients", "id", "fk_weaning_assessments_patient_id", "RESTRICT"),
        ("patient_messages", "patient_id", "patients", "id", "fk_patient_messages_patient_id", "RESTRICT"),
        ("team_chat_messages", "user_id", "users", "id", "fk_team_chat_messages_user_id", "RESTRICT"),
        ("audit_logs", "user_id", "users", "id", "fk_audit_logs_user_id", "RESTRICT"),
        ("password_history", "user_id", "users", "id", "fk_password_history_user_id", "CASCADE"),
        ("medication_administrations", "patient_id", "patients", "id", "fk_med_admins_patient_id", "RESTRICT"),
        ("medication_administrations", "medication_id", "medications", "id", "fk_med_admins_medication_id", "RESTRICT"),
        ("pharmacy_advices", "patient_id", "patients", "id", "fk_pharmacy_advices_patient_id", "RESTRICT"),
        ("ai_sessions", "user_id", "users", "id", "fk_ai_sessions_user_id", "RESTRICT"),
        ("pharmacy_compatibility_favorites", "user_id", "users", "id", "fk_pharm_compat_favs_user_id", "RESTRICT"),
    ]
    for table, col, ref_table, ref_col, new_name, on_del in _FK_CHANGES:
        old_name = _find_fk_name(conn, table, col, ref_table)
        op.execute(sa.text(
            f"ALTER TABLE {table} DROP CONSTRAINT {old_name}"
        ))
        op.execute(sa.text(
            f"ALTER TABLE {table} ADD CONSTRAINT {new_name} "
            f"FOREIGN KEY ({col}) REFERENCES {ref_table}({ref_col}) ON DELETE {on_del}"
        ))

    # ── Step 4: UNIQUE constraints ──────────────────────────────────────
    op.create_unique_constraint("uq_patients_medical_record_number", "patients", ["medical_record_number"])
    op.create_unique_constraint("uq_users_email", "users", ["email"])

    # ── Step 5: CHECK constraints ───────────────────────────────────────
    # patients
    op.create_check_constraint("ck_patients_age_range", "patients", "age >= 0 AND age <= 200")
    op.create_check_constraint("ck_patients_gender_valid", "patients", "gender IN ('M','F','Other','男','女')")
    op.create_check_constraint("ck_patients_ventilator_days_gte0", "patients", "ventilator_days >= 0")

    # medications
    op.create_check_constraint("ck_medications_status_valid", "medications", "status IN ('active','inactive','discontinued','completed','on-hold')")

    # medication_administrations
    op.create_check_constraint("ck_med_admins_status_valid", "medication_administrations", "status IN ('administered','scheduled','held','missed','refused')")

    # error_reports
    op.create_check_constraint("ck_error_reports_severity_valid", "error_reports", "severity IN ('low','moderate','high','critical')")
    op.create_check_constraint("ck_error_reports_status_valid", "error_reports", "status IN ('pending','reviewing','resolved','closed')")

    # users
    op.create_check_constraint("ck_users_role_valid", "users", "role IN ('doctor','nurse','pharmacist','admin')")

    # audit_logs
    op.create_check_constraint("ck_audit_logs_status_valid", "audit_logs", "status IN ('success','failed','error','degraded')")

    # vital_signs
    op.create_check_constraint("ck_vital_signs_spo2_range", "vital_signs", "spo2 IS NULL OR (spo2 >= 0 AND spo2 <= 100)")

    # ventilator_settings
    op.create_check_constraint("ck_ventilator_fio2_range", "ventilator_settings", "fio2 IS NULL OR (fio2 >= 21 AND fio2 <= 100)")

    # weaning_assessments
    op.create_check_constraint("ck_weaning_readiness_range", "weaning_assessments", "readiness_score IS NULL OR (readiness_score >= 0 AND readiness_score <= 100)")

    # ── Step 6: New indexes ─────────────────────────────────────────────
    op.create_index("ix_team_chat_messages_timestamp", "team_chat_messages", ["timestamp"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_pharmacy_advices_category", "pharmacy_advices", ["category"])
    op.create_index("ix_patients_archived", "patients", ["archived"])
    op.create_index("ix_patients_department", "patients", ["department"])


def downgrade() -> None:
    # ── Step 6 reverse: drop new indexes ────────────────────────────────
    op.drop_index("ix_patients_department", table_name="patients")
    op.drop_index("ix_patients_archived", table_name="patients")
    op.drop_index("ix_pharmacy_advices_category", table_name="pharmacy_advices")
    op.drop_index("ix_audit_logs_action", table_name="audit_logs")
    op.drop_index("ix_team_chat_messages_timestamp", table_name="team_chat_messages")

    # ── Step 5 reverse: drop CHECK constraints ──────────────────────────
    op.drop_constraint("ck_weaning_readiness_range", "weaning_assessments", type_="check")
    op.drop_constraint("ck_ventilator_fio2_range", "ventilator_settings", type_="check")
    op.drop_constraint("ck_vital_signs_spo2_range", "vital_signs", type_="check")
    op.drop_constraint("ck_audit_logs_status_valid", "audit_logs", type_="check")
    op.drop_constraint("ck_users_role_valid", "users", type_="check")
    op.drop_constraint("ck_error_reports_status_valid", "error_reports", type_="check")
    op.drop_constraint("ck_error_reports_severity_valid", "error_reports", type_="check")
    op.drop_constraint("ck_med_admins_status_valid", "medication_administrations", type_="check")
    op.drop_constraint("ck_medications_status_valid", "medications", type_="check")
    op.drop_constraint("ck_patients_ventilator_days_gte0", "patients", type_="check")
    op.drop_constraint("ck_patients_gender_valid", "patients", type_="check")
    op.drop_constraint("ck_patients_age_range", "patients", type_="check")

    # ── Step 4 reverse: drop UNIQUE constraints ─────────────────────────
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_constraint("uq_patients_medical_record_number", "patients", type_="unique")

    # ── Step 2&3 reverse: drop new FKs and restore originals ────────────
    conn = op.get_bind()
    _FK_RESTORE = [
        # (table, col, ref_table, ref_col, orig_name, orig_on_delete)
        ("medications", "patient_id", "patients", "id", "medications_patient_id_fkey", None),
        ("vital_signs", "patient_id", "patients", "id", "vital_signs_patient_id_fkey", None),
        ("lab_data", "patient_id", "patients", "id", "lab_data_patient_id_fkey", None),
        ("ventilator_settings", "patient_id", "patients", "id", "ventilator_settings_patient_id_fkey", None),
        ("weaning_assessments", "patient_id", "patients", "id", "weaning_assessments_patient_id_fkey", None),
        ("patient_messages", "patient_id", "patients", "id", "patient_messages_patient_id_fkey", None),
        ("team_chat_messages", "user_id", "users", "id", "team_chat_messages_user_id_fkey", None),
        ("audit_logs", "user_id", "users", "id", "audit_logs_user_id_fkey", None),
        ("password_history", "user_id", "users", "id", "password_history_user_id_fkey", None),
        ("medication_administrations", "patient_id", "patients", "id", "medication_administrations_patient_id_fkey", None),
        ("medication_administrations", "medication_id", "medications", "id", "medication_administrations_medication_id_fkey", None),
        ("pharmacy_advices", "patient_id", "patients", "id", "pharmacy_advices_patient_id_fkey", "CASCADE"),
        ("ai_sessions", "user_id", "users", "id", "ai_sessions_user_id_fkey", "CASCADE"),
        ("pharmacy_compatibility_favorites", "user_id", "users", "id", "pharmacy_compatibility_favorites_user_id_fkey", "CASCADE"),
    ]
    for table, col, ref_table, ref_col, orig_name, orig_on_del in _FK_RESTORE:
        current_name = _find_fk_name(conn, table, col, ref_table)
        op.execute(sa.text(
            f"ALTER TABLE {table} DROP CONSTRAINT {current_name}"
        ))
        on_del_clause = f" ON DELETE {orig_on_del}" if orig_on_del else ""
        op.execute(sa.text(
            f"ALTER TABLE {table} ADD CONSTRAINT {orig_name} "
            f"FOREIGN KEY ({col}) REFERENCES {ref_table}({ref_col}){on_del_clause}"
        ))

    # ── Step 1 reverse: drop updated_at columns ─────────────────────────
    for table in reversed(_UPDATED_AT_TABLES):
        op.drop_column(table, "updated_at")
