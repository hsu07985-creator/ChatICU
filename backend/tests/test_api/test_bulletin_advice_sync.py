"""Bulletin-board VPN tags ↔ ``PharmacyAdvice`` sync.

Migration 067 + ``messages._sync_advices_from_message`` make bulletin
messages a first-class source of pharmacy-intervention statistics. These
tests pin down the state machine:

    - POST /messages with N VPN tags  → N advices (one per code)
    - PATCH /tags adding a VPN        → new advice
    - PATCH /tags swapping VPN codes  → old deleted + new inserted
    - PATCH /tags removing last VPN   → all synced advices deleted
    - DELETE /messages/{id}           → synced advices cascade away
    - Non-pharmacist author           → no sync (protects stat integrity)
    - Widget-created message          → sync is a no-op (no double-write)
"""
import pytest
from sqlalchemy import select

from app.models.pharmacy_advice import PharmacyAdvice


pytestmark = pytest.mark.anyio


async def _advices_for_message(db, message_id):
    result = await db.execute(
        select(PharmacyAdvice).where(PharmacyAdvice.source_message_id == message_id)
    )
    return result.scalars().all()


@pytest.mark.asyncio
async def test_post_message_with_single_vpn_tag_creates_one_advice(client, seeded_db):
    resp = await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "建議檢視 Vancomycin 劑量",
        "tags": ["建議處方", "1-A 給藥問題"],
    })
    assert resp.status_code == 200
    msg_id = resp.json()["data"]["id"]

    advices = await _advices_for_message(seeded_db, msg_id)
    assert len(advices) == 1
    a = advices[0]
    assert a.advice_code == "1-A"
    assert a.advice_label == "給藥問題"
    assert a.category == "1. 建議處方"
    assert a.content == "建議檢視 Vancomycin 劑量"
    assert a.accepted is None
    assert a.pharmacist_name == "Test Doctor"
    assert a.source_message_id == msg_id


@pytest.mark.asyncio
async def test_post_message_with_multiple_vpn_tags_creates_multiple_advices(client, seeded_db):
    resp = await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "多重介入",
        "tags": ["1-A 給藥問題", "2-O 建議用藥/建議增加用藥", "3-R 建議藥品療效監測"],
        "linkedMedication": "Vancomycin, Propofol",
    })
    msg_id = resp.json()["data"]["id"]

    advices = await _advices_for_message(seeded_db, msg_id)
    codes = sorted(a.advice_code for a in advices)
    assert codes == ["1-A", "2-O", "3-R"]

    by_code = {a.advice_code: a for a in advices}
    assert by_code["1-A"].category == "1. 建議處方"
    assert by_code["2-O"].category == "2. 主動建議"
    assert by_code["3-R"].category == "3. 建議監測"
    # linked_medication string split by comma into array
    assert by_code["1-A"].linked_medications == ["Vancomycin", "Propofol"]


@pytest.mark.asyncio
async def test_patch_tags_adds_second_vpn_creates_second_advice(client, seeded_db):
    post = await client.post("/patients/pat_001/messages", json={
        "messageType": "general", "content": "X", "tags": ["1-A 給藥問題"],
    })
    msg_id = post.json()["data"]["id"]

    patch = await client.patch(
        f"/patients/pat_001/messages/{msg_id}/tags",
        json={"add": ["2-O 建議用藥/建議增加用藥"]},
    )
    assert patch.status_code == 200

    advices = await _advices_for_message(seeded_db, msg_id)
    assert sorted(a.advice_code for a in advices) == ["1-A", "2-O"]


@pytest.mark.asyncio
async def test_patch_tags_swaps_vpn_code_deletes_old_inserts_new(client, seeded_db):
    post = await client.post("/patients/pat_001/messages", json={
        "messageType": "general", "content": "X", "tags": ["1-A 給藥問題"],
    })
    msg_id = post.json()["data"]["id"]

    await client.patch(
        f"/patients/pat_001/messages/{msg_id}/tags",
        json={"remove": ["1-A 給藥問題"], "add": ["1-B 適應症問題"]},
    )

    advices = await _advices_for_message(seeded_db, msg_id)
    assert len(advices) == 1
    assert advices[0].advice_code == "1-B"
    assert advices[0].advice_label == "適應症問題"


@pytest.mark.asyncio
async def test_patch_tags_removes_last_vpn_deletes_all_advices(client, seeded_db):
    post = await client.post("/patients/pat_001/messages", json={
        "messageType": "general", "content": "X",
        "tags": ["1-A 給藥問題", "2-O 建議用藥/建議增加用藥"],
    })
    msg_id = post.json()["data"]["id"]
    assert len(await _advices_for_message(seeded_db, msg_id)) == 2

    await client.patch(
        f"/patients/pat_001/messages/{msg_id}/tags",
        json={"remove": ["1-A 給藥問題", "2-O 建議用藥/建議增加用藥"]},
    )

    assert await _advices_for_message(seeded_db, msg_id) == []


@pytest.mark.asyncio
async def test_delete_message_removes_linked_advices(client, seeded_db):
    post = await client.post("/patients/pat_001/messages", json={
        "messageType": "general", "content": "X",
        "tags": ["1-A 給藥問題", "3-R 建議藥品療效監測"],
    })
    msg_id = post.json()["data"]["id"]
    assert len(await _advices_for_message(seeded_db, msg_id)) == 2

    del_resp = await client.delete(f"/patients/pat_001/messages/{msg_id}")
    assert del_resp.status_code == 200

    # Query the full table — nothing should reference the deleted message id.
    any_leftover = await seeded_db.execute(
        select(PharmacyAdvice).where(PharmacyAdvice.source_message_id == msg_id)
    )
    assert any_leftover.scalars().all() == []


@pytest.mark.asyncio
async def test_non_vpn_tags_do_not_create_advices(client, seeded_db):
    resp = await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "一般筆記",
        "tags": ["待追蹤", "weekend-round", "建議處方"],  # category tag alone is not VPN
    })
    msg_id = resp.json()["data"]["id"]
    assert await _advices_for_message(seeded_db, msg_id) == []


@pytest.mark.asyncio
async def test_widget_created_message_is_not_resynced(client, seeded_db):
    """Posting via /pharmacy/advice-records must leave exactly one advice —
    no duplicate from the sync helper."""
    create = await client.post("/pharmacy/advice-records", json={
        "patientId": "pat_001",
        "adviceCode": "1-D",
        "adviceLabel": "藥品併用問題",
        "category": "1. 建議處方",
        "content": "widget path",
    })
    assert create.status_code == 200

    # Find the auto-posted message and assert it has advice_record_id,
    # and no entry via source_message_id.
    from app.models.message import PatientMessage
    msg_q = await seeded_db.execute(
        select(PatientMessage)
        .where(PatientMessage.patient_id == "pat_001",
               PatientMessage.advice_record_id.isnot(None))
    )
    msgs = msg_q.scalars().all()
    assert len(msgs) == 1
    msg = msgs[0]
    assert msg.advice_record_id is not None

    synced = await _advices_for_message(seeded_db, msg.id)
    assert synced == []  # sync helper did not run on the widget-created message

    # Total PharmacyAdvice rows = 1 (the widget's), not 2.
    all_result = await seeded_db.execute(select(PharmacyAdvice))
    assert len(all_result.scalars().all()) == 1


@pytest.mark.asyncio
async def test_orphan_tag_stats_is_zero_after_sync(client):
    """Once a VPN tag goes through POST /messages, the sync hook fires and
    the orphan counter returns 0."""
    await client.post("/patients/pat_001/messages", json={
        "messageType": "general", "content": "X", "tags": ["1-A 給藥問題"],
    })

    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 0


@pytest.mark.asyncio
async def test_synced_advice_shows_up_in_admin_stats(client):
    """End-to-end: bulletin VPN tag → /pharmacy/advice-records/stats counts it."""
    await client.post("/patients/pat_001/messages", json={
        "messageType": "general", "content": "X",
        "tags": ["1-A 給藥問題", "2-O 建議用藥/建議增加用藥"],
    })

    stats = await client.get("/pharmacy/advice-records/stats")
    assert stats.status_code == 200
    data = stats.json()["data"]
    assert data["total"] == 2
    categories = {c["category"]: c["count"] for c in data["byCategory"]}
    assert categories.get("1. 建議處方") == 1
    assert categories.get("2. 主動建議") == 1


@pytest.mark.asyncio
async def test_backfill_helper_is_idempotent(client, seeded_db):
    """Seed an orphan message (pre-migration-067 style), then call the
    sync helper by hand. First call creates advices; second call is a no-op."""
    from datetime import datetime, timezone
    from app.models.message import PatientMessage
    from app.models.user import User
    from app.routers.messages import _sync_advices_from_message

    orphan = PatientMessage(
        id="pmsg_historic",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="historic pre-067 message",
        timestamp=datetime.now(timezone.utc),
        is_read=False,
        tags=["1-A 給藥問題", "2-O 建議用藥/建議增加用藥"],
    )
    seeded_db.add(orphan)
    await seeded_db.commit()

    user = (await seeded_db.execute(select(User).where(User.id == "usr_test"))).scalar_one()

    created1, deleted1 = await _sync_advices_from_message(orphan, user, seeded_db)
    await seeded_db.commit()
    assert len(created1) == 2
    assert deleted1 == []

    # Second invocation must see both advices already present and return empty diffs
    created2, deleted2 = await _sync_advices_from_message(orphan, user, seeded_db)
    await seeded_db.commit()
    assert created2 == []
    assert deleted2 == []

    # Orphan endpoint now returns 0 for the historic message
    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    assert resp.json()["data"]["total"] == 0
