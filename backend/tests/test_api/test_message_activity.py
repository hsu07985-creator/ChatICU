"""Tests for GET /patients/messages/tagged-activity endpoint."""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.message import PatientMessage


@pytest.mark.asyncio
async def test_tagged_activity_empty(client):
    """No tagged messages → empty activity list."""
    resp = await client.get("/patients/messages/tagged-activity")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["activity"] == []
    assert body["data"]["total"] == 0


@pytest.mark.asyncio
async def test_tagged_activity_returns_patient(client, seeded_db):
    """Seed tagged messages → should appear in activity."""
    now = datetime.now(timezone.utc)
    msg = PatientMessage(
        id="pmsg_act001",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="血鉀偏低，建議補充 KCl 20mEq",
        timestamp=now,
        is_read=False,
        tags=["急件", "TDM"],
    )
    seeded_db.add(msg)
    await seeded_db.commit()

    resp = await client.get("/patients/messages/tagged-activity")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1

    item = data["activity"][0]
    assert item["patientId"] == "pat_001"
    assert item["patientName"] == "許先生"
    assert item["bedNumber"] == "I-1"
    assert item["taggedCount"] == 1
    assert item["unreadCount"] == 1
    assert "急件" in item["tags"]
    assert "TDM" in item["tags"]
    assert "血鉀偏低" in item["latestContent"]
    assert item["latestAuthorName"] == "Test Doctor"


@pytest.mark.asyncio
async def test_tagged_activity_excludes_untagged(client, seeded_db):
    """Messages without tags should not appear."""
    now = datetime.now(timezone.utc)
    tagged = PatientMessage(
        id="pmsg_act010",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="Tagged message",
        timestamp=now,
        is_read=False,
        tags=["需追蹤"],
    )
    untagged = PatientMessage(
        id="pmsg_act011",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="Untagged message",
        timestamp=now - timedelta(minutes=1),
        is_read=False,
        tags=[],
    )
    seeded_db.add_all([tagged, untagged])
    await seeded_db.commit()

    resp = await client.get("/patients/messages/tagged-activity")
    data = resp.json()["data"]
    assert data["total"] == 1
    assert data["activity"][0]["taggedCount"] == 1


@pytest.mark.asyncio
async def test_tagged_activity_hours_back_filter(client, seeded_db):
    """Old messages outside hours_back window should be excluded."""
    now = datetime.now(timezone.utc)
    recent = PatientMessage(
        id="pmsg_act020",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="Recent tagged",
        timestamp=now,
        is_read=False,
        tags=["急件"],
    )
    old = PatientMessage(
        id="pmsg_act021",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="Old tagged",
        timestamp=now - timedelta(hours=50),
        is_read=False,
        tags=["急件"],
    )
    seeded_db.add_all([recent, old])
    await seeded_db.commit()

    # Default 24h → only recent
    resp = await client.get("/patients/messages/tagged-activity?hours_back=24")
    data = resp.json()["data"]
    assert data["total"] == 1
    assert data["activity"][0]["taggedCount"] == 1

    # 72h → both
    resp2 = await client.get("/patients/messages/tagged-activity?hours_back=72")
    data2 = resp2.json()["data"]
    assert data2["total"] == 1
    assert data2["activity"][0]["taggedCount"] == 2


@pytest.mark.asyncio
async def test_tagged_activity_unread_count(client, seeded_db):
    """Verify correct unread counting."""
    now = datetime.now(timezone.utc)
    read_msg = PatientMessage(
        id="pmsg_act030",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="Read tagged",
        timestamp=now,
        is_read=True,
        tags=["已處理"],
    )
    unread_msg = PatientMessage(
        id="pmsg_act031",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="Unread tagged",
        timestamp=now - timedelta(minutes=5),
        is_read=False,
        tags=["急件"],
    )
    seeded_db.add_all([read_msg, unread_msg])
    await seeded_db.commit()

    resp = await client.get("/patients/messages/tagged-activity")
    data = resp.json()["data"]
    assert data["total"] == 1
    item = data["activity"][0]
    assert item["taggedCount"] == 2
    assert item["unreadCount"] == 1
