"""Seed height and weight for 4 demo patients.

Revision ID: 043
Revises: 042
Create Date: 2026-04-08
"""

from alembic import op

revision = "043"
down_revision = "042"
branch_labels = None
depends_on = None

# Simulated ICU patient anthropometrics
PATIENT_DATA = [
    # (patient_id, height_cm, weight_kg, gender)
    ("pat_001", 172.0, 78.5, "男"),   # 中年男性
    ("pat_002", 158.0, 55.0, "女"),   # 中年女性
    ("pat_003", 180.0, 95.0, "男"),   # 較高壯男性
    ("pat_004", 165.0, 62.0, "女"),   # 一般女性
]


def upgrade():
    for pid, h, w, gender in PATIENT_DATA:
        op.execute(
            f"UPDATE patients SET height = {h}, weight = {w}, gender = '{gender}' "
            f"WHERE id = '{pid}' AND (height IS NULL OR weight IS NULL)"
        )


def downgrade():
    for pid, _, _, _ in PATIENT_DATA:
        op.execute(
            f"UPDATE patients SET height = NULL, weight = NULL "
            f"WHERE id = '{pid}'"
        )
