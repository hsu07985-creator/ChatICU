"""Backfill updated_at columns missing on patient_messages and weaning_assessments.

Revision ID: 064
Revises: 063

Schema drift fix — ORM models (app/models/message.py::PatientMessage,
app/models/ventilator.py::WeaningAssessment) declare updated_at with
``server_default=func.now()`` and ``onupdate=func.now()``, but the underlying
tables were created without the column in their original migrations. This
causes every SELECT / list-query to fail with:

    column patient_messages.updated_at does not exist
    column weaning_assessments.updated_at does not exist

Migration 023 attempted a bulk backfill for missing ``updated_at`` columns but
these two tables slipped through on this database. We add the column here
idempotently with ``ADD COLUMN IF NOT EXISTS`` so the migration is safe no
matter the prior state (manual fix applied, 023 partially applied, or never
applied).

Design notes:
  * ``DEFAULT NOW() NOT NULL`` backfills every existing row with the migration
    time. For these two tables the semantic is acceptable (no per-row mutation
    log is exposed to users; ``onupdate=func.now()`` will overwrite on the next
    UPDATE anyway).
  * No new index is created — there are no known query paths that order/filter
    by ``updated_at`` on either table today.
  * Style mirrors migrations 060–063: ``op.execute()`` + raw SQL with
    ``IF [NOT] EXISTS`` guards; no ``$N`` positional params (see migration 052
    postmortem).
"""
from alembic import op


revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


_TABLES = ("patient_messages", "weaning_assessments")


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"""
            ALTER TABLE {table}
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
                DEFAULT NOW() NOT NULL
            """
        )


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS updated_at")
