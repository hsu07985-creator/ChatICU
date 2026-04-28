"""Phase 4a — drug-library editor 'sticky note' columns + append-only audit log.

Revision ID: 072
Revises: 071

Per docs/drug-library-phase4-plan.md §5.1.

Adds five nullable columns to drug_interactions:
  pharmacist_note, last_verified_at, verified_by, is_active, etag

Creates drug_library_audit_log (append-only via Postgres triggers).

This is the MVP-Lite slice — pharmacists can attach notes, mark verified,
and soft-delete. Severity / mechanism edits and overrides come in Phase 4b.
Migration uses NULL defaults / IF NOT EXISTS so it is instant + idempotent
on the live 10k-row table.
"""
from alembic import op


revision = "072"
down_revision = "071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Add editor columns to drug_interactions ──────────────────
    op.execute("""
        ALTER TABLE drug_interactions
            ADD COLUMN IF NOT EXISTS pharmacist_note  TEXT,
            ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS verified_by      VARCHAR(50),
            ADD COLUMN IF NOT EXISTS deprecated_at    TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS deprecated_by    VARCHAR(50),
            ADD COLUMN IF NOT EXISTS deprecated_reason TEXT,
            ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS etag             INTEGER NOT NULL DEFAULT 1
    """)

    # Partial index speeds up read-side WHERE is_active=TRUE filter.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_drug_interactions_is_active
            ON drug_interactions (is_active)
            WHERE is_active = FALSE
    """)

    # ── 2. Audit log table ──────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS drug_library_audit_log (
            id            BIGSERIAL PRIMARY KEY,
            action        VARCHAR(20)  NOT NULL,
            entity_type   VARCHAR(20)  NOT NULL,
            entity_id     VARCHAR(50)  NOT NULL,
            before_json   JSONB,
            after_json    JSONB,
            actor_id      VARCHAR(50)  NOT NULL,
            actor_name    VARCHAR(100) NOT NULL,
            actor_role    VARCHAR(50),
            reason        TEXT,
            ip_address    VARCHAR(64),
            user_agent    TEXT,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_dlaa_entity
            ON drug_library_audit_log (entity_type, entity_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_dlaa_actor
            ON drug_library_audit_log (actor_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_dlaa_action
            ON drug_library_audit_log (action, created_at DESC)
    """)

    # ── 3. Append-only enforcement (Postgres triggers) ──────────────
    # Reject any UPDATE / DELETE on the audit log so rows are immutable.
    # 醫療法 §70 expects 7-year retention; immutability + retention policy
    # together satisfy ISMS / TJCHA expectations.
    op.execute("""
        CREATE OR REPLACE FUNCTION reject_audit_log_modify()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'drug_library_audit_log is append-only (TG_OP=%)', TG_OP
                USING ERRCODE = '42501';
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        DROP TRIGGER IF EXISTS tr_dlaa_no_update ON drug_library_audit_log;
        CREATE TRIGGER tr_dlaa_no_update
            BEFORE UPDATE ON drug_library_audit_log
            FOR EACH ROW EXECUTE FUNCTION reject_audit_log_modify();
    """)
    op.execute("""
        DROP TRIGGER IF EXISTS tr_dlaa_no_delete ON drug_library_audit_log;
        CREATE TRIGGER tr_dlaa_no_delete
            BEFORE DELETE ON drug_library_audit_log
            FOR EACH ROW EXECUTE FUNCTION reject_audit_log_modify();
    """)


def downgrade() -> None:
    # Drop triggers first so the table is mutable, then drop everything.
    op.execute("DROP TRIGGER IF EXISTS tr_dlaa_no_update ON drug_library_audit_log")
    op.execute("DROP TRIGGER IF EXISTS tr_dlaa_no_delete ON drug_library_audit_log")
    op.execute("DROP FUNCTION IF EXISTS reject_audit_log_modify()")
    op.execute("DROP TABLE IF EXISTS drug_library_audit_log")

    op.execute("""
        ALTER TABLE drug_interactions
            DROP COLUMN IF EXISTS etag,
            DROP COLUMN IF EXISTS is_active,
            DROP COLUMN IF EXISTS deprecated_reason,
            DROP COLUMN IF EXISTS deprecated_by,
            DROP COLUMN IF EXISTS deprecated_at,
            DROP COLUMN IF EXISTS verified_by,
            DROP COLUMN IF EXISTS last_verified_at,
            DROP COLUMN IF EXISTS pharmacist_note
    """)
    op.execute("DROP INDEX IF EXISTS ix_drug_interactions_is_active")
