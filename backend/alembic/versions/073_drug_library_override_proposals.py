"""Phase 4b — drug-library hospital override + proposal/approval workflow.

Revision ID: 073
Revises: 072

Adds 6 override columns to drug_interactions (Option C: schema-isolated
override + COALESCE at read time, never overwriting source columns) and a
new drug_rule_proposals table for the 4-eye proposal/approval flow.

Per docs/drug-library-phase4-plan.md §4 Phase 4b. Bitemporal valid_from /
valid_to deferred to 4c.
"""
from alembic import op


revision = "073"
down_revision = "072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Override columns on drug_interactions (Option C, never touches source) ──
    op.execute("""
        ALTER TABLE drug_interactions
            ADD COLUMN IF NOT EXISTS override_risk_rating  VARCHAR(2),
            ADD COLUMN IF NOT EXISTS override_severity     VARCHAR(20),
            ADD COLUMN IF NOT EXISTS override_reason       TEXT,
            ADD COLUMN IF NOT EXISTS override_citation     TEXT,
            ADD COLUMN IF NOT EXISTS overridden_by         VARCHAR(50),
            ADD COLUMN IF NOT EXISTS overridden_at         TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS override_expires_at   TIMESTAMPTZ
    """)

    # Index to surface 'currently overridden' rules in governance dashboard
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_drug_interactions_overridden
            ON drug_interactions (overridden_at DESC)
            WHERE override_risk_rating IS NOT NULL
    """)

    # ── Proposal table (drug_rule_proposals) ─────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS drug_rule_proposals (
            id                 BIGSERIAL PRIMARY KEY,
            rule_id            VARCHAR(50)  NOT NULL,
            kind               VARCHAR(20)  NOT NULL,
            -- 'override'  : propose hospital override (severity downgrade etc.)
            -- 'restore'   : (future) propose restoring a deprecated rule
            proposed_changes   JSONB        NOT NULL,
            -- e.g. {"override_risk_rating":"C","override_reason":"...","override_citation":"PMID:..."}
            status             VARCHAR(20)  NOT NULL DEFAULT 'pending',
            -- 'pending' | 'approved' | 'rejected' | 'withdrawn'
            proposer_id        VARCHAR(50)  NOT NULL,
            proposer_name      VARCHAR(100) NOT NULL,
            proposer_role      VARCHAR(50),
            reason             TEXT         NOT NULL,
            citation           TEXT,
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            -- Approval / rejection metadata
            approver_id        VARCHAR(50),
            approver_name      VARCHAR(100),
            decided_at         TIMESTAMPTZ,
            decision_comment   TEXT
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_dlrp_status_created
            ON drug_rule_proposals (status, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_dlrp_rule
            ON drug_rule_proposals (rule_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_dlrp_proposer
            ON drug_rule_proposals (proposer_id, created_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS drug_rule_proposals")

    op.execute("""
        ALTER TABLE drug_interactions
            DROP COLUMN IF EXISTS override_expires_at,
            DROP COLUMN IF EXISTS overridden_at,
            DROP COLUMN IF EXISTS overridden_by,
            DROP COLUMN IF EXISTS override_citation,
            DROP COLUMN IF EXISTS override_reason,
            DROP COLUMN IF EXISTS override_severity,
            DROP COLUMN IF EXISTS override_risk_rating
    """)
    op.execute("DROP INDEX IF EXISTS ix_drug_interactions_overridden")
