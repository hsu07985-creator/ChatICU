"""Seed system record templates for progress-note, medication-advice, nursing-record.

Revision ID: 029
Revises: 028
Create Date: 2026-04-04
"""

import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None

# System templates keyed by (record_type, name)
SYSTEM_TEMPLATES = [
    # ── Progress Note ──
    {
        "name": "SOAP 格式",
        "description": "標準 SOAP Progress Note 模板",
        "record_type": "progress-note",
        "role_scope": "all",
        "content": (
            "S (Subjective): ___\n"
            "O (Objective):\n"
            "  Vitals: BP ___ / ___ mmHg, HR ___ bpm, RR ___ rpm, T ___ °C\n"
            "  Labs: ___\n"
            "  Physical exam: ___\n"
            "A (Assessment): ___\n"
            "P (Plan): ___"
        ),
        "sort_order": 1,
    },
    {
        "name": "簡要紀錄",
        "description": "簡短 Progress Note 模板",
        "record_type": "progress-note",
        "role_scope": "all",
        "content": "主訴: ___\n目前狀況: ___\n處置計畫: ___",
        "sort_order": 2,
    },
    # ── Medication Advice ──
    {
        "name": "劑量調整建議",
        "description": "藥師劑量調整建議模板",
        "record_type": "medication-advice",
        "role_scope": "pharmacist",
        "content": (
            "藥品名稱: ___\n"
            "目前劑量: ___\n"
            "建議調整: ___\n"
            "調整原因: ___\n"
            "監測項目: ___"
        ),
        "sort_order": 1,
    },
    {
        "name": "新增藥品建議",
        "description": "藥師新增藥品建議模板",
        "record_type": "medication-advice",
        "role_scope": "pharmacist",
        "content": (
            "建議藥品: ___\n"
            "適應症: ___\n"
            "建議劑量: ___\n"
            "給藥途徑: ___\n"
            "注意事項: ___"
        ),
        "sort_order": 2,
    },
    # ── Nursing Record ──
    {
        "name": "一般交班",
        "description": "護理一般交班模板",
        "record_type": "nursing-record",
        "role_scope": "nurse",
        "content": (
            "病患意識: ___\n"
            "生命徵象: BP ___ / ___ mmHg, HR ___ bpm, RR ___ rpm, T ___ °C\n"
            "呼吸器設定: Mode ___, FiO2 ___ %, PEEP ___ cmH2O\n"
            "管路: ___ (位置、狀況)\n"
            "輸液: ___ ml/hr\n"
            "尿量: ___ ml/8hr\n"
            "特殊狀況: ___"
        ),
        "sort_order": 1,
    },
    {
        "name": "鎮靜評估",
        "description": "護理鎮靜評估模板",
        "record_type": "nursing-record",
        "role_scope": "nurse",
        "content": (
            "RASS Score: ___\n"
            "CAM-ICU: Positive / Negative\n"
            "使用鎮靜劑: ___\n"
            "劑量調整: ___\n"
            "呼吸型態: ___\n"
            "建議: ___"
        ),
        "sort_order": 2,
    },
    {
        "name": "管路評估",
        "description": "護理管路評估模板",
        "record_type": "nursing-record",
        "role_scope": "nurse",
        "content": (
            "氣管內管: ___ cm (固定位置)\n"
            "中心靜脈導管: ___ (位置、天數)\n"
            "動脈導管: ___ (位置、天數)\n"
            "尿管: ___ (尿液顏色、量)\n"
            "鼻胃管: ___ (位置、引流量)\n"
            "其他管路: ___"
        ),
        "sort_order": 3,
    },
    {
        "name": "傷口護理",
        "description": "護理傷口護理模板",
        "record_type": "nursing-record",
        "role_scope": "nurse",
        "content": (
            "傷口位置: ___\n"
            "傷口大小: ___ cm x ___ cm\n"
            "傷口深度: ___\n"
            "滲液: 有 / 無 (量: ___, 顏色: ___)\n"
            "紅腫熱痛: ___\n"
            "換藥頻率: ___\n"
            "使用敷料: ___"
        ),
        "sort_order": 4,
    },
]


def upgrade():
    conn = op.get_bind()
    tbl = sa.table(
        "record_templates",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("record_type", sa.String),
        sa.column("role_scope", sa.String),
        sa.column("content", sa.Text),
        sa.column("is_system", sa.Boolean),
        sa.column("is_active", sa.Boolean),
        sa.column("sort_order", sa.Integer),
        sa.column("created_by_id", sa.String),
        sa.column("created_by_name", sa.String),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )

    now = datetime.now(timezone.utc)
    for t in SYSTEM_TEMPLATES:
        # Idempotent: skip if already exists
        exists = conn.execute(
            sa.select(tbl.c.id).where(
                tbl.c.name == t["name"],
                tbl.c.record_type == t["record_type"],
                tbl.c.is_system == True,
            )
        ).first()
        if exists:
            continue

        conn.execute(
            tbl.insert().values(
                id=f"tpl_{uuid.uuid4().hex[:8]}",
                name=t["name"],
                description=t.get("description"),
                record_type=t["record_type"],
                role_scope=t["role_scope"],
                content=t["content"],
                is_system=True,
                is_active=True,
                sort_order=t.get("sort_order", 0),
                created_by_id="system",
                created_by_name="System",
                created_at=now,
                updated_at=now,
            )
        )


def downgrade():
    conn = op.get_bind()
    tbl = sa.table(
        "record_templates",
        sa.column("is_system", sa.Boolean),
    )
    conn.execute(tbl.delete().where(tbl.c.is_system == True))
