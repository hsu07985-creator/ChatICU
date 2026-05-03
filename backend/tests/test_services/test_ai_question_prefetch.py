from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.culture_result import CultureResult
from app.services.ai_question_prefetch import (
    build_question_prefetch_context,
    format_culture_context,
    get_recent_cultures,
    should_prefetch_cultures,
)


def test_should_prefetch_cultures_for_infection_questions():
    assert should_prefetch_cultures("這床抗生素可以 de-escalation 嗎？")
    assert should_prefetch_cultures("有沒有培養和感受性結果？")
    assert should_prefetch_cultures("Any culture data for VAP?")
    assert not should_prefetch_cultures("今天 K 和 Cr 多少？")


def test_format_culture_context_includes_isolates_and_susceptibility():
    culture = CultureResult(
        id="cul_unit",
        patient_id="pat_001",
        sheet_number="S1",
        specimen="Blood culture",
        specimen_code="BLO",
        collected_at=datetime(2026, 5, 2, 2, 0, tzinfo=timezone.utc),
        reported_at=datetime(2026, 5, 3, 4, 0, tzinfo=timezone.utc),
        isolates=[{"organism": "E. coli", "colonies": "2/2 bottles"}],
        susceptibility=[
            {"antibiotic": "Ceftriaxone", "result": "S"},
            {"antibiotic": "Piperacillin/Tazobactam", "result": "S"},
        ],
        q_score=2,
        result="Positive",
    )

    text = format_culture_context([culture], days=14)

    assert "【微生物培養 最近14天】" in text
    assert "狀態: ok（1 筆" in text
    assert "Blood culture" in text
    assert "E. coli (2/2 bottles)" in text
    assert "Ceftriaxone S" in text
    assert "Piperacillin/Tazobactam S" in text


@pytest.mark.asyncio
async def test_get_recent_cultures_filters_to_recent_records(seeded_db):
    recent = CultureResult(
        id="cul_recent",
        patient_id="pat_001",
        sheet_number="recent",
        specimen="Sputum culture",
        specimen_code="SPU",
        collected_at=datetime.now(timezone.utc) - timedelta(days=1),
        reported_at=datetime.now(timezone.utc) - timedelta(hours=12),
        isolates=[{"organism": "K. pneumoniae"}],
        susceptibility=[{"antibiotic": "Meropenem", "result": "S"}],
        result="Positive",
    )
    old = CultureResult(
        id="cul_old",
        patient_id="pat_001",
        sheet_number="old",
        specimen="Urine culture",
        specimen_code="URI",
        collected_at=datetime.now(timezone.utc) - timedelta(days=30),
        reported_at=datetime.now(timezone.utc) - timedelta(days=29),
        result="No growth",
    )
    seeded_db.add_all([recent, old])
    await seeded_db.commit()

    rows = await get_recent_cultures(seeded_db, "pat_001", days=14)

    assert [row.id for row in rows] == ["cul_recent"]


@pytest.mark.asyncio
async def test_build_question_prefetch_context_returns_no_data_when_triggered(seeded_db):
    text = await build_question_prefetch_context(
        seeded_db, "pat_001", "這床抗生素如何調整？"
    )

    assert "【微生物培養 最近14天】" in text
    assert "狀態: no_data" in text


@pytest.mark.asyncio
async def test_build_question_prefetch_context_skips_unrelated_question(seeded_db):
    text = await build_question_prefetch_context(
        seeded_db, "pat_001", "今天血鉀和腎功能怎麼樣？"
    )

    assert text == ""
