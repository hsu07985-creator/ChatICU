"""Add tables for duplicate-medication detection (L3/L4 groups, overrides,
feedback, cache).

Revision ID: 063
Revises: 062

Supports docs/duplicate-medication-detection-implementation-plan.md §4.1 and
docs/duplicate-medication-integration-plan.md §5.1. Seven tables total:

  * drug_mechanism_groups / drug_mechanism_group_members  — L3 (同機轉)
  * drug_endpoint_groups  / drug_endpoint_group_members   — L4 (同療效終點)
  * duplicate_rule_overrides    — §3.1 upgrade / §3.3 whitelist
  * duplicate_alert_feedback    — KPI / pharmacist action trail
  * medication_duplicate_cache  — per-patient precomputed alerts JSON

Populated by backend/scripts/seed_duplicate_groups.py using the CSV source of
truth in backend/app/fhir/code_maps/. Follows the 060 / 061 style —
op.execute() + raw SQL + IF [NOT] EXISTS so reruns are safe.
"""
from alembic import op


revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # L3 — drug_mechanism_groups (+ members)
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS drug_mechanism_groups (
            id               SERIAL PRIMARY KEY,
            group_key        VARCHAR(50)  NOT NULL UNIQUE,
            group_name_zh    VARCHAR(100),
            group_name_en    VARCHAR(100),
            severity         VARCHAR(10),
            mechanism_note   TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS drug_mechanism_group_members (
            group_id          INT         NOT NULL
                REFERENCES drug_mechanism_groups(id) ON DELETE CASCADE,
            atc_code          VARCHAR(10) NOT NULL,
            active_ingredient VARCHAR(100),
            PRIMARY KEY (group_id, atc_code)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_drug_mechanism_group_members_atc_code "
        "ON drug_mechanism_group_members (atc_code)"
    )

    # ------------------------------------------------------------------
    # L4 — drug_endpoint_groups (+ members, with optional member_subtype)
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS drug_endpoint_groups (
            id               SERIAL PRIMARY KEY,
            group_key        VARCHAR(50)  NOT NULL UNIQUE,
            group_name_zh    VARCHAR(100),
            group_name_en    VARCHAR(100),
            severity         VARCHAR(10),
            mechanism_note   TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS drug_endpoint_group_members (
            group_id          INT         NOT NULL
                REFERENCES drug_endpoint_groups(id) ON DELETE CASCADE,
            atc_code          VARCHAR(10) NOT NULL,
            active_ingredient VARCHAR(100),
            member_subtype    VARCHAR(30),
            PRIMARY KEY (group_id, atc_code)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_drug_endpoint_group_members_atc_code "
        "ON drug_endpoint_group_members (atc_code)"
    )

    # ------------------------------------------------------------------
    # duplicate_rule_overrides — upgrade / whitelist
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS duplicate_rule_overrides (
            id                SERIAL PRIMARY KEY,
            rule_type         VARCHAR(20) NOT NULL,
            atc_code_1        VARCHAR(20) NOT NULL,
            atc_code_2        VARCHAR(20) NOT NULL,
            severity_override VARCHAR(10),
            reason            TEXT,
            evidence_url      VARCHAR(300),
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_duplicate_rule_overrides_rule_type
                CHECK (rule_type IN ('upgrade','whitelist')),
            CONSTRAINT uq_duplicate_rule_overrides_triplet
                UNIQUE (rule_type, atc_code_1, atc_code_2)
        )
        """
    )

    # ------------------------------------------------------------------
    # duplicate_alert_feedback — KPI / pharmacist action trail
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS duplicate_alert_feedback (
            id                 SERIAL PRIMARY KEY,
            patient_id         VARCHAR(50) NOT NULL
                REFERENCES patients(id),
            alert_fingerprint  VARCHAR(64) NOT NULL,
            action             VARCHAR(20) NOT NULL,
            override_reason    VARCHAR(100),
            pharmacist_id      VARCHAR(50)
                REFERENCES users(id),
            notes              TEXT,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_duplicate_alert_feedback_action
                CHECK (action IN ('accepted','overridden','modified','dismissed'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duplicate_alert_feedback_patient_created "
        "ON duplicate_alert_feedback (patient_id, created_at)"
    )

    # ------------------------------------------------------------------
    # medication_duplicate_cache — per-patient precomputed alerts
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS medication_duplicate_cache (
            patient_id        VARCHAR(50) PRIMARY KEY
                REFERENCES patients(id) ON DELETE CASCADE,
            computed_at       TIMESTAMPTZ NOT NULL,
            medications_hash  VARCHAR(64),
            alerts_json       JSONB       NOT NULL DEFAULT '[]'::jsonb,
            context           VARCHAR(20),
            counts            JSONB
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_medication_duplicate_cache_computed_at "
        "ON medication_duplicate_cache (computed_at)"
    )


def downgrade() -> None:
    # Drop in reverse dependency order; cache / feedback first, then groups.
    op.execute("DROP INDEX IF EXISTS ix_medication_duplicate_cache_computed_at")
    op.execute("DROP TABLE IF EXISTS medication_duplicate_cache")

    op.execute("DROP INDEX IF EXISTS ix_duplicate_alert_feedback_patient_created")
    op.execute("DROP TABLE IF EXISTS duplicate_alert_feedback")

    op.execute("DROP TABLE IF EXISTS duplicate_rule_overrides")

    op.execute("DROP INDEX IF EXISTS ix_drug_endpoint_group_members_atc_code")
    op.execute("DROP TABLE IF EXISTS drug_endpoint_group_members")
    op.execute("DROP TABLE IF EXISTS drug_endpoint_groups")

    op.execute("DROP INDEX IF EXISTS ix_drug_mechanism_group_members_atc_code")
    op.execute("DROP TABLE IF EXISTS drug_mechanism_group_members")
    op.execute("DROP TABLE IF EXISTS drug_mechanism_groups")
