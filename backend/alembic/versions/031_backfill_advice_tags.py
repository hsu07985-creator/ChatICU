"""Backfill pharmacy category+code tags on existing advice messages.

Existing PatientMessages linked to PharmacyAdvice records have no tags.
This migration sets tags = [category_tag, advice_code] based on the
linked pharmacy_advices.category and pharmacy_advices.advice_code.

Revision ID: 031
Revises: 030
Create Date: 2026-04-05
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None

_CATEGORY_TO_TAG = {
    "1. 建議處方": "建議處方",
    "2. 主動建議": "主動建議",
    "3. 建議監測": "建議監測",
    "4. 用藥連貫性": "用藥連貫性",
    "4. 用藥適從性": "用藥連貫性",
}


def upgrade():
    conn = op.get_bind()

    rows = conn.execute(sa.text(
        "SELECT pa.id, pa.category, pa.advice_code, pm.id AS msg_id "
        "FROM pharmacy_advices pa "
        "JOIN patient_messages pm ON pm.advice_record_id = pa.id "
        "WHERE pm.tags IS NULL OR pm.tags = '[]'::jsonb"
    )).fetchall()

    for row in rows:
        category_tag = _CATEGORY_TO_TAG.get(row.category)
        if not category_tag:
            continue

        tags = [category_tag]
        if row.advice_code:
            tags.append(row.advice_code)

        conn.execute(
            sa.text("UPDATE patient_messages SET tags = :tags WHERE id = :id"),
            {"tags": json.dumps(tags), "id": row.msg_id},
        )


def downgrade():
    pass
