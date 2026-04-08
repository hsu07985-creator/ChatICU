"""Migrate advice_code from numeric format to VPN letter format.

e.g. 1-1 → 1-A, 2-3 → 2-L, 3-1 → 3-R, 4-1 → 4-U

Revision ID: 052
Revises: 051
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None

# Old numeric code → new VPN letter code
CODE_MAP = {
    "1-1": "1-A", "1-2": "1-B", "1-3": "1-C", "1-4": "1-D",
    "1-5": "1-E", "1-6": "1-F", "1-7": "1-G", "1-8": "1-H",
    "1-9": "1-I", "1-10": "1-J", "1-11": "1-K", "1-12": "1-L",
    "1-13": "1-M",
    "2-1": "2-J", "2-2": "2-K", "2-3": "2-L", "2-4": "2-M",
    "2-5": "2-N", "2-6": "2-O", "2-7": "2-P", "2-8": "2-Q",
    "3-1": "3-R", "3-2": "3-S", "3-3": "3-T",
    "4-1": "4-U", "4-2": "4-V", "4-3": "4-W",
}


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Update pharmacy_advices.advice_code
    for old, new in CODE_MAP.items():
        conn.execute(sa.text(
            "UPDATE pharmacy_advices SET advice_code = :new WHERE advice_code = :old"
        ), {"old": old, "new": new})

    # 2. Update patient_messages.advice_code
    for old, new in CODE_MAP.items():
        conn.execute(sa.text(
            "UPDATE patient_messages SET advice_code = :new WHERE advice_code = :old"
        ), {"old": old, "new": new})

    # 3. Update tags in patient_messages (JSONB array)
    # Replace bare codes like "1-1" and readable tags like "1-1 給藥問題"
    for old, new in CODE_MAP.items():
        # Replace exact bare code in tags array
        conn.execute(sa.text("""
            UPDATE patient_messages
            SET tags = (
                SELECT jsonb_agg(
                    CASE
                        WHEN elem::text = :old_quoted THEN to_jsonb(:new::text)
                        WHEN elem::text LIKE :old_prefix THEN to_jsonb(replace(elem::text, :old_bare, :new_bare)::text)
                        ELSE elem
                    END
                )
                FROM jsonb_array_elements(tags) AS elem
            )
            WHERE tags::text LIKE :search_pattern
        """), {
            "old_quoted": f'"{old}"',
            "new": new,
            "old_prefix": f'"{old} %',
            "old_bare": old,
            "new_bare": new,
            "search_pattern": f'%"{old}%',
        })


def downgrade() -> None:
    conn = op.get_bind()
    # Reverse mapping
    for old, new in CODE_MAP.items():
        conn.execute(sa.text(
            "UPDATE pharmacy_advices SET advice_code = :old WHERE advice_code = :new"
        ), {"old": old, "new": new})
        conn.execute(sa.text(
            "UPDATE patient_messages SET advice_code = :old WHERE advice_code = :new"
        ), {"old": old, "new": new})
