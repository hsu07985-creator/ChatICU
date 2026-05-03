from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.culture_result import CultureResult
from app.models.diagnostic_report import DiagnosticReport
from app.models.medication import Medication
from app.models.pharmacy_advice import PharmacyAdvice
from app.models.user import User
from app.services.ai_question_prefetch import (
    build_question_prefetch_context,
    build_question_prefetch_with_metadata,
    format_culture_context,
    format_diagnostic_reports_context,
    format_medication_changes_context,
    format_pharmacy_advice_context,
    get_recent_cultures,
    get_recent_diagnostic_reports,
    get_recent_medication_changes,
    search_pharmacy_advice_history,
    should_prefetch_cultures,
    should_prefetch_diagnostic_reports,
    should_prefetch_medication_changes,
    should_prefetch_pharmacy_advice,
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


def test_should_prefetch_pharmacy_advice_for_history_questions():
    assert should_prefetch_pharmacy_advice("我之前給過 vancomycin 建議在哪一床？")
    assert should_prefetch_pharmacy_advice("哪裡可以看我的藥師建議歷史紀錄？")
    assert should_prefetch_pharmacy_advice("Any pharmacy advice history?")
    assert not should_prefetch_pharmacy_advice("今天 K 和 Cr 多少？")


def test_should_prefetch_diagnostic_reports_for_report_questions():
    assert should_prefetch_diagnostic_reports("請看最近 CT report")
    assert should_prefetch_diagnostic_reports("胸片報告有沒有肺炎？")
    assert should_prefetch_diagnostic_reports("完整報告內容是什麼？")
    assert not should_prefetch_diagnostic_reports("今天 K 和 Cr 多少？")


def _user(role: str = "pharmacist", user_id: str = "usr_test") -> User:
    return User(
        id=user_id,
        name="Test Pharmacist",
        username=f"{user_id}_name",
        password_hash="",
        email=f"{user_id}@example.test",
        role=role,
        unit="Pharmacy",
        active=True,
    )


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


def test_format_pharmacy_advice_context_masks_patient_and_links_back():
    record = PharmacyAdvice(
        id="adv_unit",
        patient_id="pat_001",
        patient_name="王小明",
        bed_number="I-01",
        pharmacist_id="usr_test",
        pharmacist_name="Test Pharmacist",
        advice_code="2-L",
        advice_label="腎功能調整",
        category="2. 用藥安全",
        content="Vancomycin 建議依 CrCl 調整劑量",
        linked_medications=["Vancomycin"],
        accepted=None,
        timestamp=datetime(2026, 5, 3, 4, 0, tzinfo=timezone.utc),
    )

    text = format_pharmacy_advice_context([record], days=30)

    assert "【藥師建議歷史 最近30天】" in text
    assert "I-01 王○明" in text
    assert "2-L 腎功能調整" in text
    assert "linked: Vancomycin" in text
    assert "/pharmacy/advice-statistics" in text


def test_format_diagnostic_reports_context_truncates_body_text():
    report = DiagnosticReport(
        id="diag_unit",
        patient_id="pat_001",
        report_type="imaging",
        exam_name="CT Chest",
        exam_date=datetime(2026, 5, 3, 4, 0, tzinfo=timezone.utc),
        impression="Bilateral pneumonia.",
        body_text="A" * 1300,
        status="final",
    )

    text = format_diagnostic_reports_context([report], days=14)

    assert "【診斷/影像報告 最近14天】" in text
    assert "CT Chest" in text
    assert "Bilateral pneumonia." in text
    assert "已截斷" in text


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
async def test_get_recent_diagnostic_reports_filters_to_recent_records(seeded_db):
    recent = DiagnosticReport(
        id="diag_recent",
        patient_id="pat_001",
        report_type="imaging",
        exam_name="CXR",
        exam_date=datetime.now(timezone.utc) - timedelta(days=1),
        body_text="No focal infiltrate.",
        impression="No pneumonia.",
        status="final",
    )
    old = DiagnosticReport(
        id="diag_old",
        patient_id="pat_001",
        report_type="imaging",
        exam_name="CT Brain",
        exam_date=datetime.now(timezone.utc) - timedelta(days=30),
        body_text="Old report.",
        status="final",
    )
    seeded_db.add_all([recent, old])
    await seeded_db.commit()

    rows = await get_recent_diagnostic_reports(seeded_db, "pat_001", days=14)

    assert [row.id for row in rows] == ["diag_recent"]


@pytest.mark.asyncio
async def test_search_pharmacy_advice_history_scopes_to_current_user(seeded_db):
    seeded_db.add(_user("pharmacist", "usr_other"))
    own = PharmacyAdvice(
        id="adv_own",
        patient_id="pat_001",
        patient_name="許先生",
        bed_number="I-1",
        pharmacist_id="usr_test",
        pharmacist_name="Test Doctor",
        advice_code="2-L",
        advice_label="腎功能調整",
        category="2. 用藥安全",
        content="Vancomycin dose adjustment needed",
        linked_medications=["Vancomycin"],
        timestamp=datetime.now(timezone.utc),
    )
    other = PharmacyAdvice(
        id="adv_other",
        patient_id="pat_001",
        patient_name="許先生",
        bed_number="I-1",
        pharmacist_id="usr_other",
        pharmacist_name="Other Pharmacist",
        advice_code="2-L",
        advice_label="腎功能調整",
        category="2. 用藥安全",
        content="Vancomycin dose adjustment needed",
        linked_medications=["Vancomycin"],
        timestamp=datetime.now(timezone.utc),
    )
    seeded_db.add_all([own, other])
    await seeded_db.commit()

    rows = await search_pharmacy_advice_history(
        seeded_db,
        _user("pharmacist", "usr_test"),
        "我之前給過 vancomycin 建議在哪一床？",
        patient_id=None,
    )

    assert [row.id for row in rows] == ["adv_own"]


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
async def test_build_question_prefetch_context_returns_advice_history_and_audit(
    seeded_db,
):
    seeded_db.add(
        PharmacyAdvice(
            id="adv_prefetch",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_test",
            pharmacist_name="Test Doctor",
            advice_code="2-L",
            advice_label="腎功能調整",
            category="2. 用藥安全",
            content="Vancomycin 建議依腎功能調整",
            linked_medications=["Vancomycin"],
            timestamp=datetime.now(timezone.utc),
        )
    )
    await seeded_db.commit()

    text = await build_question_prefetch_context(
        seeded_db,
        None,
        "我之前給過 vancomycin 建議在哪一床？",
        user=_user("pharmacist", "usr_test"),
        ip="10.1.2.3",
    )

    assert "【藥師建議歷史 最近30天】" in text
    assert "I-1 許○生" in text
    assert "Vancomycin" in text
    logs = (
        await seeded_db.execute(
            select(AuditLog).where(
                AuditLog.action == "ai_chat_pharmacy_advice_history_search"
            )
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].ip == "10.1.2.3"
    assert logs[0].details["result_count"] == 1


@pytest.mark.asyncio
async def test_admin_can_see_other_pharmacists_advice_records(seeded_db):
    """F-ACL1: admin role should bypass the pharmacist_id filter so
    cross-pharmacist searches work; pharmacist still scoped to own."""
    # Two records from two different pharmacists
    seeded_db.add_all([
        PharmacyAdvice(
            id="adv_admin_a",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_pharm_alice",
            pharmacist_name="Alice",
            advice_code="2-L",
            advice_label="腎功能調整",
            category="2. 用藥安全",
            content="Vancomycin 建議依腎功能調整",
            timestamp=datetime.now(timezone.utc),
        ),
        PharmacyAdvice(
            id="adv_admin_b",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_pharm_bob",
            pharmacist_name="Bob",
            advice_code="2-K",
            advice_label="藥物交互",
            category="2. 用藥安全",
            content="meropenem + valproate 交互作用提醒",
            timestamp=datetime.now(timezone.utc),
        ),
    ])
    await seeded_db.commit()

    # Admin sees BOTH
    text_admin, meta_admin = await build_question_prefetch_with_metadata(
        seeded_db,
        None,
        "查看最近的藥師建議紀錄",
        user=_user("admin", "usr_admin"),
        ip="10.1.2.3",
    )
    ids_admin = {r["id"] for r in meta_admin["adviceRefs"]}
    assert "adv_admin_a" in ids_admin and "adv_admin_b" in ids_admin
    assert "全部藥師建立的紀錄" in text_admin

    # Audit log records the cross-pharmacist flag so we can later distinguish
    # admin's broader search from a self-scoped one.
    logs = (
        await seeded_db.execute(
            select(AuditLog).where(
                AuditLog.action == "ai_chat_pharmacy_advice_history_search"
            )
        )
    ).scalars().all()
    assert any(
        log.details.get("cross_pharmacist") is True
        and log.user_id == "usr_admin"
        for log in logs
    )


@pytest.mark.asyncio
async def test_pharmacist_only_sees_own_records_not_other_pharmacists(seeded_db):
    """F-ACL1 inverse: pharmacist must NOT pick up another pharmacist's
    records via AI chat (privacy boundary)."""
    seeded_db.add_all([
        PharmacyAdvice(
            id="adv_self",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_pharm_alice",
            pharmacist_name="Alice",
            advice_code="2-L",
            advice_label="腎功能調整",
            category="2. 用藥安全",
            content="自己寫的",
            timestamp=datetime.now(timezone.utc),
        ),
        PharmacyAdvice(
            id="adv_other",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_pharm_bob",
            pharmacist_name="Bob",
            advice_code="2-K",
            advice_label="藥物交互",
            category="2. 用藥安全",
            content="別人寫的",
            timestamp=datetime.now(timezone.utc),
        ),
    ])
    await seeded_db.commit()

    text, meta = await build_question_prefetch_with_metadata(
        seeded_db,
        None,
        "查看最近的藥師建議紀錄",
        user=_user("pharmacist", "usr_pharm_alice"),
    )
    ids = {r["id"] for r in meta["adviceRefs"]}
    assert ids == {"adv_self"}, f"pharmacist should only see own records, saw {ids}"
    assert "目前登入者自己建立的紀錄" in text


@pytest.mark.asyncio
async def test_build_question_prefetch_context_returns_report_no_data_when_triggered(
    seeded_db,
):
    text = await build_question_prefetch_context(
        seeded_db,
        "pat_001",
        "請列出最近完整報告",
        user=_user("doctor", "usr_doc"),
    )

    assert "【診斷/影像報告 最近14天】" in text
    assert "狀態: no_data" in text


@pytest.mark.asyncio
async def test_build_question_prefetch_context_denies_advice_history_for_doctor(
    seeded_db,
):
    text = await build_question_prefetch_context(
        seeded_db,
        "pat_001",
        "我之前給過用藥建議在哪一床？",
        user=_user("doctor", "usr_doc"),
    )

    assert "【藥師建議歷史 最近30天】" in text
    assert "狀態: denied" in text


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


# F3: build_question_prefetch_with_metadata returns deep-link references


@pytest.mark.asyncio
async def test_prefetch_metadata_carries_advice_refs_for_pharmacist(seeded_db):
    seeded_db.add(
        PharmacyAdvice(
            id="adv_meta_a",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_test",
            pharmacist_name="Test Doctor",
            advice_code="2-L",
            advice_label="腎功能調整",
            category="2. 用藥安全",
            content="Vancomycin 建議依腎功能調整",
            linked_medications=["Vancomycin"],
            timestamp=datetime.now(timezone.utc),
        )
    )
    await seeded_db.commit()

    text, meta = await build_question_prefetch_with_metadata(
        seeded_db,
        None,
        "我之前給過 vancomycin 建議在哪一床？",
        user=_user("pharmacist", "usr_test"),
    )

    assert "【藥師建議歷史 最近30天】" in text
    refs = meta["adviceRefs"]
    assert len(refs) == 1
    ref = refs[0]
    assert ref["id"] == "adv_meta_a"
    assert ref["bedNumber"] == "I-1"
    # Mask matches the same _mask_patient_name the LLM-facing text uses,
    # so the chip never exposes a name the LLM section already hid.
    assert ref["patientNameMasked"] == "許○生"
    assert ref["adviceCode"] == "2-L"
    assert ref["adviceLabel"] == "腎功能調整"
    # ISO-8601 timestamp — frontend can render via Date directly. SQLite
    # in tests strips the TZ suffix that PostgreSQL preserves; assert the
    # core ISO shape rather than the TZ marker so the test stays portable.
    assert ref["timestamp"] is not None
    datetime.fromisoformat(ref["timestamp"].replace("Z", "+00:00"))


@pytest.mark.asyncio
async def test_prefetch_metadata_advice_refs_empty_when_denied(seeded_db):
    """A nurse asking for advice history must get denied AND no refs leaked."""
    seeded_db.add(
        PharmacyAdvice(
            id="adv_meta_denied",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_other",
            pharmacist_name="Other Pharm",
            advice_code="2-L",
            advice_label="腎功能調整",
            category="2. 用藥安全",
            content="should not surface",
            timestamp=datetime.now(timezone.utc),
        )
    )
    await seeded_db.commit()

    text, meta = await build_question_prefetch_with_metadata(
        seeded_db,
        "pat_001",
        "我之前給過用藥建議在哪一床？",
        user=_user("doctor", "usr_doc"),
    )

    assert "狀態: denied" in text
    assert meta["adviceRefs"] == []


@pytest.mark.asyncio
async def test_prefetch_metadata_advice_refs_empty_when_not_triggered(seeded_db):
    """Unrelated questions never populate adviceRefs even if records exist."""
    seeded_db.add(
        PharmacyAdvice(
            id="adv_meta_skip",
            patient_id="pat_001",
            patient_name="許先生",
            bed_number="I-1",
            pharmacist_id="usr_test",
            pharmacist_name="Test Pharmacist",
            advice_code="2-L",
            advice_label="腎功能調整",
            category="2. 用藥安全",
            content="...",
            timestamp=datetime.now(timezone.utc),
        )
    )
    await seeded_db.commit()

    text, meta = await build_question_prefetch_with_metadata(
        seeded_db, "pat_001", "今天血鉀多少？",
        user=_user("pharmacist", "usr_test"),
    )

    assert text == ""
    assert meta["adviceRefs"] == []
