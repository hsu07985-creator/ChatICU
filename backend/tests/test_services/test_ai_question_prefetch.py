from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.culture_result import CultureResult
from app.models.medication import Medication
from app.services.ai_question_prefetch import (
    build_question_prefetch_context,
    format_culture_context,
    format_medication_changes_context,
    get_recent_cultures,
    get_recent_medication_changes,
    should_prefetch_cultures,
    should_prefetch_medication_changes,
)


def test_should_prefetch_cultures_for_infection_questions():
    assert should_prefetch_cultures("這床抗生素可以 de-escalation 嗎？")
    assert should_prefetch_cultures("有沒有培養和感受性結果？")
    assert should_prefetch_cultures("Any culture data for VAP?")
    assert not should_prefetch_cultures("今天 K 和 Cr 多少？")


def test_should_prefetch_medication_changes_for_recent_change_questions():
    assert should_prefetch_medication_changes("這2天有改什麼藥？")
    assert should_prefetch_medication_changes("剛停 vancomycin 嗎？")
    assert should_prefetch_medication_changes("Any med changes in 72h?")
    assert not should_prefetch_medication_changes("今天 K 和 Cr 多少？")


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


def test_format_medication_changes_context_groups_recent_rows():
    today = date.today()
    now = datetime.now(timezone.utc)
    meds = [
        Medication(
            id="med_started",
            patient_id="pat_001",
            name="Meropenem",
            generic_name="Meropenem",
            dose="1",
            unit="g",
            frequency="q8h",
            route="IV",
            start_date=today,
            status="active",
            updated_at=now,
        ),
        Medication(
            id="med_stopped",
            patient_id="pat_001",
            name="Vancomycin",
            generic_name="Vancomycin",
            end_date=today,
            status="discontinued",
            updated_at=now,
        ),
        Medication(
            id="med_hold",
            patient_id="pat_001",
            name="Morphine",
            generic_name="Morphine",
            status="on-hold",
            updated_at=now,
        ),
    ]

    text = format_medication_changes_context(meds, hours=72)

    assert "【最近72小時用藥變更】" in text
    assert "新增/開始:" in text
    assert "Meropenem 1g q8h IV" in text
    assert "停用/結束:" in text
    assert "Vancomycin" in text
    assert "Hold:" in text
    assert "Morphine" in text
    assert "目前 schema 無歷史前值" in text


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
async def test_get_recent_medication_changes_filters_to_recent_records(seeded_db):
    recent = Medication(
        id="med_recent_change",
        patient_id="pat_001",
        name="Meropenem",
        generic_name="Meropenem",
        start_date=date.today(),
        status="active",
        updated_at=datetime.now(timezone.utc),
    )
    old = Medication(
        id="med_old_change",
        patient_id="pat_001",
        name="Cefazolin",
        generic_name="Cefazolin",
        start_date=date.today() - timedelta(days=30),
        status="active",
        updated_at=datetime.now(timezone.utc) - timedelta(days=30),
    )
    seeded_db.add_all([recent, old])
    await seeded_db.commit()

    rows = await get_recent_medication_changes(seeded_db, "pat_001", hours=72)

    assert [row.id for row in rows] == ["med_recent_change"]


@pytest.mark.asyncio
async def test_build_question_prefetch_context_returns_culture_no_data_when_triggered(
    seeded_db,
):
    text = await build_question_prefetch_context(
        seeded_db, "pat_001", "這床抗生素如何調整？"
    )

    assert "【微生物培養 最近14天】" in text
    assert "狀態: no_data" in text


@pytest.mark.asyncio
async def test_build_question_prefetch_context_returns_med_change_no_data_when_triggered(
    seeded_db,
):
    text = await build_question_prefetch_context(
        seeded_db, "pat_001", "這2天有改什麼藥？"
    )

    assert "【最近72小時用藥變更】" in text
    assert "狀態: no_data" in text


@pytest.mark.asyncio
async def test_build_question_prefetch_context_can_include_both_blocks(seeded_db):
    seeded_db.add(
        Medication(
            id="med_both",
            patient_id="pat_001",
            name="Vancomycin",
            generic_name="Vancomycin",
            start_date=date.today(),
            status="active",
            updated_at=datetime.now(timezone.utc),
        )
    )
    await seeded_db.commit()

    text = await build_question_prefetch_context(
        seeded_db, "pat_001", "抗生素這幾天有改嗎？培養如何？"
    )

    assert "【微生物培養 最近14天】" in text
    assert "【最近72小時用藥變更】" in text
    assert "Vancomycin" in text


@pytest.mark.asyncio
async def test_build_question_prefetch_context_skips_unrelated_question(seeded_db):
    text = await build_question_prefetch_context(
        seeded_db, "pat_001", "今天血鉀和腎功能怎麼樣？"
    )

    assert text == ""
