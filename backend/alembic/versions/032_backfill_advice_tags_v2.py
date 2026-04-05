"""Backfill pharmacy tags on medication-advice messages (v2).

Migration 031 used advice_record_id JOIN which missed messages where
the FK was null. This version uses advice_code prefix to derive the
category tag directly.

Revision ID: 032
Revises: 031
Create Date: 2026-04-06
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None

_CODE_PREFIX_TO_TAG = {
    "1": "建議處方",
    "2": "主動建議",
    "3": "建議監測",
    "4": "用藥連貫性",
}


def upgrade():
    conn = op.get_bind()

    rows = conn.execute(sa.text(
        "SELECT id, advice_code FROM patient_messages "
        "WHERE message_type = 'medication-advice' "
        "AND advice_code IS NOT NULL "
        "AND (tags IS NULL OR tags = '[]'::jsonb)"
    )).fetchall()

    for row in rows:
        prefix = row.advice_code.split("-")[0] if row.advice_code else None
        category_tag = _CODE_PREFIX_TO_TAG.get(prefix) if prefix else None
        if not category_tag:
            continue

        tags = [category_tag, row.advice_code]
        conn.execute(
            sa.text("UPDATE patient_messages SET tags = :tags WHERE id = :id"),
            {"tags": json.dumps(tags), "id": row.id},
        )


def downgrade():
    pass
