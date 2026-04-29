"""Allow hard-delete of users by relaxing FK constraints to public.users.

Most user-referencing tables had ON DELETE RESTRICT, which prevented
admin-initiated user deletion as soon as the user had any history
(audit logs, chat messages, etc.). To support real DELETE in
``DELETE /admin/users/{id}`` while preserving the audit trail:

History tables → ON DELETE SET NULL (and column made nullable).
The denormalised ``*_name`` strings (user_name, created_by_name)
already preserve human-readable identity for those rows.

Personal-preference tables → ON DELETE CASCADE
(``pharmacy_compatibility_favorites``).

Tables left untouched (already CASCADE / unrelated):
- ``password_history.user_id`` (CASCADE) — already correct
- ``custom_tags.created_by_id`` (CASCADE) — already correct
- All ``identities``, ``mfa_factors``, ``oauth_*``, ``sessions``,
  ``webauthn_*`` — those reference ``auth.users`` (Supabase managed),
  not ``public.users``.

Idempotency: every constraint drop guards with IF EXISTS.
"""

from alembic import op
import sqlalchemy as sa


revision = "075"
down_revision = "074"
branch_labels = None
depends_on = None


# (table, column, old_constraint_name, new_constraint_name, ondelete, make_nullable)
_FK_CHANGES = [
    ("audit_logs", "user_id", "fk_audit_logs_user_id", "fk_audit_logs_user_id", "SET NULL", True),
    ("ai_sessions", "user_id", "fk_ai_sessions_user_id", "fk_ai_sessions_user_id", "SET NULL", True),
    ("team_chat_messages", "user_id", "fk_team_chat_messages_user_id", "fk_team_chat_messages_user_id", "SET NULL", True),
    ("patient_messages", "author_id", "fk_patient_messages_author_id", "fk_patient_messages_author_id", "SET NULL", True),
    ("record_templates", "created_by_id", "record_templates_created_by_id_fkey", "record_templates_created_by_id_fkey", "SET NULL", True),
    ("record_templates", "updated_by_id", "record_templates_updated_by_id_fkey", "record_templates_updated_by_id_fkey", "SET NULL", True),
    ("pharmacy_advices", "pharmacist_id", "fk_pharmacy_advices_pharmacist_id", "fk_pharmacy_advices_pharmacist_id", "SET NULL", True),
    ("pharmacy_advices", "responded_by_id", "fk_advices_responder", "fk_advices_responder", "SET NULL", True),
    ("error_reports", "reporter_id", "fk_error_reports_reporter_id", "fk_error_reports_reporter_id", "SET NULL", True),
    ("duplicate_alert_feedback", "pharmacist_id", "duplicate_alert_feedback_pharmacist_id_fkey", "duplicate_alert_feedback_pharmacist_id_fkey", "SET NULL", True),
    ("pharmacy_compatibility_favorites", "user_id", "fk_pharm_compat_favs_user_id", "fk_pharm_compat_favs_user_id", "CASCADE", False),
]


def _drop_fk_if_exists(table: str, constraint: str) -> None:
    op.execute(
        sa.text(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS "{constraint}"')
    )


def upgrade() -> None:
    for table, col, old_name, new_name, ondelete, make_nullable in _FK_CHANGES:
        _drop_fk_if_exists(table, old_name)
        if make_nullable:
            op.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN {col} DROP NOT NULL"))
        op.create_foreign_key(
            new_name,
            table,
            "users",
            [col],
            ["id"],
            ondelete=ondelete,
        )


def downgrade() -> None:
    # Restore RESTRICT (and NOT NULL where applicable). Note: rows with
    # NULL user references created while at SET NULL would block this
    # downgrade — that's expected; downgrade is for dev only.
    for table, col, old_name, new_name, ondelete, make_nullable in _FK_CHANGES:
        _drop_fk_if_exists(table, new_name)
        if make_nullable:
            op.execute(
                sa.text(f"ALTER TABLE {table} ALTER COLUMN {col} SET NOT NULL")
            )
        original_ondelete = "CASCADE" if table == "pharmacy_compatibility_favorites" else "RESTRICT"
        op.create_foreign_key(
            old_name,
            table,
            "users",
            [col],
            ["id"],
            ondelete=original_ondelete,
        )
