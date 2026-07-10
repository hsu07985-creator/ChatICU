"""System record-template seeding for fresh environments.

Canonical copy of the 8 system templates originally seeded by alembic
migrations 029/030. Those migrations require usr_003 to already exist
(true on prod, false on fresh DBs) and now skip themselves when it does
not — this module provides the same templates through the seed pipeline,
which runs after users are inserted.

Idempotent: existing (name, record_type, is_system=True) rows are kept.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.record_template import RecordTemplate

SYSTEM_TEMPLATE_CREATOR_ID = "usr_003"
SYSTEM_TEMPLATE_CREATOR_NAME = "系統管理"

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


async def seed_system_templates(session: AsyncSession) -> int:
    """Insert missing system templates. Returns the number inserted."""
    inserted = 0
    for t in SYSTEM_TEMPLATES:
        existing = await session.execute(
            select(RecordTemplate.id).where(
                RecordTemplate.name == t["name"],
                RecordTemplate.record_type == t["record_type"],
                RecordTemplate.is_system.is_(True),
            )
        )
        if existing.first():
            continue
        session.add(RecordTemplate(
            id=f"tpl_{uuid.uuid4().hex[:8]}",
            name=t["name"],
            description=t.get("description"),
            record_type=t["record_type"],
            role_scope=t["role_scope"],
            content=t["content"],
            is_system=True,
            is_active=True,
            sort_order=t.get("sort_order", 0),
            created_by_id=SYSTEM_TEMPLATE_CREATOR_ID,
            created_by_name=SYSTEM_TEMPLATE_CREATOR_NAME,
        ))
        inserted += 1
    return inserted
