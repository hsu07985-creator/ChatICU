"""Tests for GET /pharmacy/advice-records/orphan-tag-stats.

An "orphan" bulletin-board message is one that has a VPN-format tag
(e.g. "1-A 給藥問題") but has NO linked PharmacyAdvice row — neither
``advice_record_id`` (widget path) nor ``source_message_id`` (bulletin
sync path). Since migration 067 the sync hook in ``messages.py`` prevents
new orphans from being created through the public API, so these tests
seed orphans directly into the DB to simulate historical rows that
predate the hook.
"""
from datetime import datetime, timezone

import pytest

from app.models.message import PatientMessage


def _make_orphan_message(**overrides):
    """Factory for a PatientMessage that simulates a pre-migration-067 row:
    has VPN tags, no advice linkage in either direction."""
    defaults = dict(
        id=f"pmsg_orphan_{overrides.get('suffix', 'x')}",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="orphan seed",
        timestamp=datetime.now(timezone.utc),
        is_read=False,
        tags=["1-A 給藥問題"],
        advice_record_id=None,
    )
    defaults.update({k: v for k, v in overrides.items() if k != "suffix"})
    return PatientMessage(**defaults)


@pytest.mark.asyncio
async def test_orphan_tag_stats_empty_when_no_messages(client):
    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 0
    assert data["byTag"] == []
    assert data["byMessageType"] == []
    assert data["samples"] == []


@pytest.mark.asyncio
async def test_orphan_tag_stats_ignores_linked_advice_messages(client):
    """Messages auto-created by POST /pharmacy/advice-records have
    advice_record_id set, so their VPN tags are NOT orphans."""
    await client.post("/pharmacy/advice-records", json={
        "patientId": "pat_001",
        "adviceCode": "1-A",
        "adviceLabel": "給藥問題",
        "category": "1. 建議處方",
        "content": "linked advice",
    })

    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 0


@pytest.mark.asyncio
async def test_orphan_tag_stats_counts_manual_vpn_tags(client, seeded_db):
    """Historic rows seeded straight into the DB (no sync) are reported."""
    seeded_db.add(_make_orphan_message(
        suffix="a", id="pmsg_orphan_a",
        content="小心 Vanco 濃度",
        tags=["1-B 適應症問題", "建議處方"],
    ))
    seeded_db.add(_make_orphan_message(
        suffix="b", id="pmsg_orphan_b",
        content="交互作用提醒",
        tags=["1-E 藥品交互作用"],
    ))
    await seeded_db.commit()

    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    data = resp.json()["data"]
    assert data["total"] == 2

    tags_seen = {row["tag"]: row["count"] for row in data["byTag"]}
    assert tags_seen == {
        "1-B 適應症問題": 1,
        "1-E 藥品交互作用": 1,
    }
    assert "建議處方" not in tags_seen

    assert len(data["samples"]) == 2
    for s in data["samples"]:
        assert s["patientId"] == "pat_001"
        assert s["messageId"].startswith("pmsg_orphan_")
        assert all(t.startswith(("1-", "2-", "3-", "4-")) for t in s["orphanTags"])


@pytest.mark.asyncio
async def test_orphan_tag_stats_ignores_non_vpn_tags(client):
    """A message with only custom/preset (non-VPN) tags is NOT orphan."""
    await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "一般筆記",
        "tags": ["待追蹤", "weekend-round"],
    })

    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    assert resp.json()["data"]["total"] == 0


@pytest.mark.asyncio
async def test_orphan_tag_stats_groups_by_message_type(client, seeded_db):
    seeded_db.add(_make_orphan_message(
        suffix="g", id="pmsg_orphan_g", message_type="general",
        tags=["1-A 給藥問題"],
    ))
    seeded_db.add(_make_orphan_message(
        suffix="m", id="pmsg_orphan_m", message_type="medication-advice",
        tags=["2-O 建議用藥/建議增加用藥"],
    ))
    await seeded_db.commit()

    data = (await client.get("/pharmacy/advice-records/orphan-tag-stats")).json()["data"]
    by_type = {row["messageType"]: row["count"] for row in data["byMessageType"]}
    assert by_type == {"general": 1, "medication-advice": 1}


@pytest.mark.asyncio
async def test_orphan_tag_stats_invalid_month_returns_422(client):
    resp = await client.get(
        "/pharmacy/advice-records/orphan-tag-stats",
        params={"month": "not-a-date"},
    )
    assert resp.status_code == 422
    assert resp.json()["success"] is False


@pytest.mark.asyncio
async def test_orphan_tag_stats_sample_limit(client, seeded_db):
    for i in range(5):
        seeded_db.add(_make_orphan_message(
            suffix=str(i), id=f"pmsg_orphan_{i}",
            content=f"note {i}",
            tags=["1-A 給藥問題"],
        ))
    await seeded_db.commit()

    resp = await client.get(
        "/pharmacy/advice-records/orphan-tag-stats",
        params={"sample_limit": 2},
    )
    data = resp.json()["data"]
    assert data["total"] == 5
    assert len(data["samples"]) == 2
    assert data["byTag"][0]["count"] == 5


@pytest.mark.asyncio
async def test_orphan_tag_stats_excludes_messages_synced_via_source_message_id(client, seeded_db):
    """A message that already produced PharmacyAdvice rows via the bulletin
    sync hook (tracked by PharmacyAdvice.source_message_id) is NOT orphan,
    even though its ``advice_record_id`` is NULL."""
    # Post a normal bulletin message via the API; sync hook creates the advice.
    post = await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "synced bulletin msg",
        "tags": ["1-A 給藥問題"],
    })
    assert post.status_code == 200

    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    assert resp.json()["data"]["total"] == 0
