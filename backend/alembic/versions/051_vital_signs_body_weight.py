"""Add body_weight column to vital_signs and seed weight history.

Revision ID: 051
Revises: 050
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None

# Weight history per patient (id_suffix, patient_id, base_weight, offsets over 5 days)
_WEIGHT_SEEDS = [
    # pat_001 許先生: 63.2 kg baseline, stable
    ("pat_001", 63.2, [0.3, 0.0, -0.4, -0.2, 0.0]),
    # pat_002 林小姐: 55.0 kg, fluid loss trend
    ("pat_002", 55.0, [1.5, 1.0, 0.5, 0.2, 0.0]),
    # pat_003 陳女士: 68.5 kg, post-dialysis dehydration
    ("pat_003", 68.5, [3.5, 2.0, 1.0, 0.5, 0.0]),
    # pat_004 黃先生: 78.0 kg, stable
    ("pat_004", 78.0, [0.0, 0.2, 0.5, 0.3, 0.0]),
]


def _add_column_if_not_exists(conn, table, column, col_type):
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :table AND column_name = :col"
    ), {"table": table, "col": column}).fetchone()
    if not exists:
        conn.execute(sa.text(
            f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
        ))


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add column idempotently
    _add_column_if_not_exists(conn, "vital_signs", "body_weight", "FLOAT")

    # 2. Update existing vital_signs records with body_weight
    for pid, base_weight, _ in _WEIGHT_SEEDS:
        conn.execute(sa.text(
            "UPDATE vital_signs SET body_weight = :w "
            "WHERE patient_id = :pid AND body_weight IS NULL"
        ), {"w": base_weight, "pid": pid})

    # 3. Insert weight-history vital_signs records (5 per patient, daily)
    for pid, base_weight, offsets in _WEIGHT_SEEDS:
        for i, offset in enumerate(offsets):
            rid = f"vs_bw_{pid}_{i:02d}"
            exists = conn.execute(
                sa.text("SELECT 1 FROM vital_signs WHERE id = :id"),
                {"id": rid},
            ).fetchone()
            if exists:
                continue
            weight = round(base_weight + offset, 1)
            days_ago = 4 - i
            conn.execute(sa.text(
                "INSERT INTO vital_signs (id, patient_id, timestamp, body_weight) "
                f"VALUES (:id, :pid, NOW() - INTERVAL '{days_ago} days', :w)"
            ), {"id": rid, "pid": pid, "w": weight})


def downgrade() -> None:
    op.drop_column("vital_signs", "body_weight")
