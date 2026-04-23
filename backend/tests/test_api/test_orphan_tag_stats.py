"""Tests for GET /pharmacy/advice-records/orphan-tag-stats.

An "orphan" bulletin-board message is one that has a VPN-format tag
(e.g. "1-A 給藥問題") but whose ``advice_record_id`` is NULL — meaning
the VPN tag was applied by hand on the messages page rather than through
the pharmacy advice widget, so it never reaches the admin pharmacy
statistics.

This endpoint exists so admins can watch that backlog drain during the
F22 frontend migration.
"""
import pytest


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
async def test_orphan_tag_stats_counts_manual_vpn_tags(client):
    """Hand-tagging a general message with a VPN code is the orphan case."""
    await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "小心 Vanco 濃度",
        "tags": ["1-B 適應症問題", "建議處方"],
    })
    await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "交互作用提醒",
        "tags": ["1-E 藥品交互作用"],
    })

    resp = await client.get("/pharmacy/advice-records/orphan-tag-stats")
    data = resp.json()["data"]
    assert data["total"] == 2

    tags_seen = {row["tag"]: row["count"] for row in data["byTag"]}
    assert tags_seen == {
        "1-B 適應症問題": 1,
        "1-E 藥品交互作用": 1,
    }
    # Category tag "建議處方" is NOT a VPN code and should be excluded.
    assert "建議處方" not in tags_seen

    assert len(data["samples"]) == 2
    for s in data["samples"]:
        assert s["patientId"] == "pat_001"
        assert s["messageId"].startswith("pmsg_")
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
async def test_orphan_tag_stats_groups_by_message_type(client):
    await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "a",
        "tags": ["1-A 給藥問題"],
    })
    await client.post("/patients/pat_001/messages", json={
        "messageType": "medication-advice",
        "content": "b",
        "tags": ["2-O 建議用藥/建議增加用藥"],
    })

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
async def test_orphan_tag_stats_sample_limit(client):
    for i in range(5):
        await client.post("/patients/pat_001/messages", json={
            "messageType": "general",
            "content": f"note {i}",
            "tags": ["1-A 給藥問題"],
        })

    resp = await client.get(
        "/pharmacy/advice-records/orphan-tag-stats",
        params={"sample_limit": 2},
    )
    data = resp.json()["data"]
    assert data["total"] == 5
    assert len(data["samples"]) == 2
    # Aggregate count still covers all 5
    assert data["byTag"][0]["count"] == 5
