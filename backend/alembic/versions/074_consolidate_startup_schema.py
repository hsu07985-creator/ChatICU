"""Consolidate residual schema from startup_migrations.py into Alembic.

Phase 4.1 Step 2a: schema-only convergence. The runtime ``startup_migrations``
fallback bag (`backend/app/startup_migrations.py`) is kept intact for now
(it stays idempotent and harmless against an upgraded DB); this revision
just moves the schema pieces it owns into Alembic so future Step 2b/3 can
remove the fallback bag without losing schema reproducibility on a fresh DB.

Net-new schema covered here:

1. ``ai_messages.feedback`` VARCHAR(10) — runtime fallback only
2. ``sync_status`` table + ``ix_sync_status_source`` — runtime fallback only
3. ``vital_signs.{etco2, cvp, icp, cpp}`` FLOAT — runtime fallback only
   (``body_weight`` is already in 051)
4. Three dashboard-perf indexes that ``startup_migrations`` ensured but
   that 042 did not: ``ix_patient_messages_patient_is_read``,
   ``ix_medications_status_san_category``,
   ``ix_pharmacy_advices_category_timestamp``
5. Two FK constraints: ``fk_clinical_scores_patient`` (clinical_scores ->
   patients) and ``fk_custom_tags_created_by`` (custom_tags -> users)
6. Convert four ``drug_interactions`` columns from TEXT to JSONB:
   ``dependencies, dependency_types, interacting_members, pubmed_ids``
7. Drop the ``_startup_flags`` metadata table (its only flag —
   ``clear_messages_053`` — is now redundant since 053 already cleared
   messages and the table is unreferenced anywhere else)

Excluded from this revision (handled in later Step 2b/3 as seed/repair):
- All ``_seed_*`` helpers
- ``_fix_gender_swap`` (already in 026)
- ``_patch_ddi_interacting_members`` (data backfill, not schema)
- ``_seed_outpatient_demo`` (049)
- ``_ensure_diagnostic_reports`` demo seed (50 covers schema)
- ``_migrate_vpn_letter_codes`` (already in 052)

Idempotency: every operation guards on existence (``IF NOT EXISTS`` /
``DO $$ ... EXCEPTION WHEN duplicate_* THEN NULL`` / information_schema
checks). Safe against any prod DB whose schema may already match — re-running
this migration on a converged DB is a no-op.

Revision ID: 074
Revises: 073
Create Date: 2026-04-29
"""

from alembic import op
import sqlalchemy as sa


revision = "074"
down_revision = "073"
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    return conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
        ),
        {"t": table, "c": column},
    ).fetchone() is not None


def _table_exists(conn, table: str) -> bool:
    return conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name=:t"
        ),
        {"t": table},
    ).fetchone() is not None


def _column_type(conn, table: str, column: str) -> str | None:
    row = conn.execute(
        sa.text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
        ),
        {"t": table, "c": column},
    ).fetchone()
    return row[0] if row else None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. ai_messages.feedback
    if _table_exists(conn, "ai_messages") and not _column_exists(conn, "ai_messages", "feedback"):
        op.add_column("ai_messages", sa.Column("feedback", sa.String(length=10), nullable=True))

    # 2. sync_status table + index
    if not _table_exists(conn, "sync_status"):
        op.create_table(
            "sync_status",
            sa.Column("key", sa.String(length=100), primary_key=True),
            sa.Column("source", sa.String(length=50), nullable=False),
            sa.Column("version", sa.String(length=100), nullable=False),
            sa.Column(
                "last_synced_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column("details", sa.dialects.postgresql.JSONB(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
        op.create_index("ix_sync_status_source", "sync_status", ["source"])

    # 3. vital_signs advanced columns (body_weight is already in 051)
    if _table_exists(conn, "vital_signs"):
        for col_name in ("etco2", "cvp", "icp", "cpp"):
            if not _column_exists(conn, "vital_signs", col_name):
                op.add_column("vital_signs", sa.Column(col_name, sa.Float(), nullable=True))

    # 4. Three dashboard-perf indexes
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_patient_messages_patient_is_read "
        "ON patient_messages (patient_id, is_read)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_medications_status_san_category "
        "ON medications (status, san_category)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_pharmacy_advices_category_timestamp "
        "ON pharmacy_advices (category, timestamp)"
    ))

    # 5. FK constraints (idempotent via DO $$ EXCEPTION)
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "ALTER TABLE clinical_scores ADD CONSTRAINT fk_clinical_scores_patient "
        "FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT; "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "ALTER TABLE custom_tags ADD CONSTRAINT fk_custom_tags_created_by "
        "FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT; "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
    ))

    # 6. drug_interactions TEXT -> JSONB for 4 columns (skip if already JSONB)
    for col in ("dependencies", "dependency_types", "interacting_members", "pubmed_ids"):
        current = _column_type(conn, "drug_interactions", col)
        if current is None:
            # Column doesn't exist — 028 should have created it. Skip; not our job.
            continue
        if current == "jsonb":
            continue
        conn.execute(sa.text(
            f"ALTER TABLE drug_interactions "
            f"ALTER COLUMN {col} TYPE JSONB USING {col}::jsonb"
        ))

    # 7. Drop _startup_flags metadata table (one-time runtime gate, no longer needed)
    conn.execute(sa.text("DROP TABLE IF EXISTS _startup_flags"))


def downgrade() -> None:
    conn = op.get_bind()

    # 7. Recreate _startup_flags (empty)
    conn.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS _startup_flags (flag VARCHAR(100) PRIMARY KEY)"
    ))

    # 6. JSONB -> TEXT for drug_interactions (lossless, JSON is valid text)
    for col in ("dependencies", "dependency_types", "interacting_members", "pubmed_ids"):
        current = _column_type(conn, "drug_interactions", col)
        if current == "jsonb":
            conn.execute(sa.text(
                f"ALTER TABLE drug_interactions "
                f"ALTER COLUMN {col} TYPE TEXT USING {col}::text"
            ))

    # 5. Drop FK constraints
    conn.execute(sa.text(
        "ALTER TABLE custom_tags DROP CONSTRAINT IF EXISTS fk_custom_tags_created_by"
    ))
    conn.execute(sa.text(
        "ALTER TABLE clinical_scores DROP CONSTRAINT IF EXISTS fk_clinical_scores_patient"
    ))

    # 4. Drop perf indexes
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_pharmacy_advices_category_timestamp"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_medications_status_san_category"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_patient_messages_patient_is_read"))

    # 3. Drop vital_signs advanced columns
    if _table_exists(conn, "vital_signs"):
        for col_name in ("cpp", "icp", "cvp", "etco2"):
            if _column_exists(conn, "vital_signs", col_name):
                op.drop_column("vital_signs", col_name)

    # 2. Drop sync_status table
    if _table_exists(conn, "sync_status"):
        op.drop_index("ix_sync_status_source", table_name="sync_status")
        op.drop_table("sync_status")

    # 1. Drop ai_messages.feedback
    if _table_exists(conn, "ai_messages") and _column_exists(conn, "ai_messages", "feedback"):
        op.drop_column("ai_messages", "feedback")
