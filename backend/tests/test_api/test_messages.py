"""Tests for patient messages endpoints."""
import pytest
from datetime import datetime, timezone

from app.models.message import PatientMessage

pytestmark = pytest.mark.anyio


@pytest.fixture
async def seeded_messages(seeded_db):
    """Seed messages for pat_001."""
    db = seeded_db
    now = datetime.now(timezone.utc)
    msg1 = PatientMessage(
        id="pmsg_test_001",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doc",
        author_role="admin",
        message_type="general",
        content="General test message",
        timestamp=now,
        is_read=False,
        tags=["important"],
    )
    msg2 = PatientMessage(
        id="pmsg_test_002",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doc",
        author_role="admin",
        message_type="medication-advice",
        content="Suggest dose reduction",
        timestamp=now,
        is_read=True,
        advice_code="1-A",
        tags=["建議處方", "1-A 給藥問題"],
    )
    db.add_all([msg1, msg2])
    await db.commit()
    return db


# ── List messages ──

async def test_list_messages(client, seeded_messages):
    """GET /patients/{id}/messages returns messages."""
    resp = await client.get("/patients/pat_001/messages")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert len(data["messages"]) == 2
    assert data["total"] == 2


async def test_list_messages_filter_unread(client, seeded_messages):
    """Filter by unread=true returns only unread messages."""
    resp = await client.get("/patients/pat_001/messages?unread=true")
    assert resp.status_code == 200
    msgs = resp.json()["data"]["messages"]
    assert len(msgs) == 1
    assert msgs[0]["id"] == "pmsg_test_001"


async def test_list_messages_filter_type(client, seeded_messages):
    """Filter by type returns only matching message type."""
    resp = await client.get("/patients/pat_001/messages?type=medication-advice")
    assert resp.status_code == 200
    msgs = resp.json()["data"]["messages"]
    assert len(msgs) == 1
    assert msgs[0]["messageType"] == "medication-advice"


async def test_list_messages_pagination(client, seeded_messages):
    """Pagination works with page and limit."""
    resp = await client.get("/patients/pat_001/messages?page=1&limit=1")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["messages"]) == 1
    assert data["total"] >= 1


# ── Create message ──

async def test_create_message(client, seeded_db):
    """POST /patients/{id}/messages creates a new message."""
    resp = await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "New test message",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    msg = body["data"]
    assert msg["content"] == "New test message"
    assert msg["messageType"] == "general"
    assert msg["patientId"] == "pat_001"
    assert msg["authorId"] == "usr_test"


async def test_create_reply(client, seeded_messages):
    """POST with replyToId creates a reply and increments replyCount."""
    resp = await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "Reply to first message",
        "replyToId": "pmsg_test_001",
    })
    assert resp.status_code == 200
    reply = resp.json()["data"]
    assert reply["replyToId"] == "pmsg_test_001"


async def test_create_message_with_tags(client, seeded_db):
    """Message can be created with tags."""
    resp = await client.post("/patients/pat_001/messages", json={
        "messageType": "general",
        "content": "Tagged message",
        "tags": ["urgent", "follow-up"],
    })
    assert resp.status_code == 200
    msg = resp.json()["data"]
    assert "urgent" in msg.get("tags", [])


# ── Mark read ──

async def test_mark_message_read(client, seeded_messages):
    """PATCH /{message_id}/read marks message as read."""
    resp = await client.patch("/patients/pat_001/messages/pmsg_test_001/read")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    msg = body["data"]
    assert msg["isRead"] is True
    assert len(msg.get("readBy", [])) >= 1


async def test_mark_nonexistent_message_read(client, seeded_db):
    """404 when marking nonexistent message as read."""
    resp = await client.patch("/patients/pat_001/messages/pmsg_nonexist/read")
    assert resp.status_code == 404


# ── Tags ──

async def test_update_message_tags(client, seeded_messages):
    """PATCH /{message_id}/tags adds and removes tags."""
    resp = await client.patch("/patients/pat_001/messages/pmsg_test_001/tags", json={
        "add": ["new-tag"],
        "remove": ["important"],
    })
    assert resp.status_code == 200
    tags = resp.json()["data"]["tags"]
    assert "new-tag" in tags
    assert "important" not in tags


# ── Preset tags ──

async def test_get_preset_tags(client, seeded_db):
    """GET /patients/{id}/messages/preset-tags returns tags list."""
    resp = await client.get("/patients/pat_001/messages/preset-tags")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)
    assert len(body["data"]) > 0


# ── Pharmacy tags ──

async def test_get_pharmacy_tags(client, seeded_db):
    """GET /patients/{id}/messages/pharmacy-tags returns structured categories."""
    resp = await client.get("/patients/pat_001/messages/pharmacy-tags")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    # admin role should see pharmacy tags
    data = body["data"]
    assert isinstance(data, list)


# ── Custom tags ──

async def test_create_and_list_custom_tags(client, seeded_db):
    """Create a custom tag and verify it appears in the list."""
    # Create
    resp = await client.post("/patients/pat_001/messages/custom-tags", json={
        "name": "my-custom-tag",
    })
    assert resp.status_code == 200
    tag = resp.json()["data"]
    assert tag["name"] == "my-custom-tag"
    tag_id = tag["id"]

    # List
    resp = await client.get("/patients/pat_001/messages/custom-tags")
    assert resp.status_code == 200
    tags = resp.json()["data"]
    assert any(t["id"] == tag_id for t in tags)


async def test_delete_custom_tag(client, seeded_db):
    """Delete a custom tag returns success."""
    # Create first
    resp = await client.post("/patients/pat_001/messages/custom-tags", json={
        "name": "temp-tag",
    })
    tag_id = resp.json()["data"]["id"]

    # Delete
    resp = await client.delete(f"/patients/pat_001/messages/custom-tags/{tag_id}")
    assert resp.status_code == 200

    # Verify deleted
    resp = await client.get("/patients/pat_001/messages/custom-tags")
    tags = resp.json()["data"]
    assert not any(t["id"] == tag_id for t in tags)
