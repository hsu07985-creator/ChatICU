"""Tests for team chat reply threading + read tracking (P0 upgrade)."""

import pytest


# ── Helpers ────────────────────────────────────────────────────────────

async def _send(client, content, pinned=False, reply_to_id=None, mentioned_roles=None):
    body = {"content": content, "pinned": pinned}
    if reply_to_id:
        body["replyToId"] = reply_to_id
    if mentioned_roles:
        body["mentionedRoles"] = mentioned_roles
    resp = await client.post("/team/chat", json=body)
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    return resp.json()["data"]


# ── Reply threading ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_send_reply(client):
    """Reply to a message increments parent replyCount."""
    parent = await _send(client, "parent message")
    reply = await _send(client, "reply message", reply_to_id=parent["id"])

    assert reply["replyToId"] == parent["id"]

    # GET list should include reply nested under parent
    resp = await client.get("/team/chat")
    messages = resp.json()["data"]["messages"]
    parent_msg = next(m for m in messages if m["id"] == parent["id"])
    assert parent_msg["replyCount"] == 1
    assert len(parent_msg["replies"]) == 1
    assert parent_msg["replies"][0]["id"] == reply["id"]


@pytest.mark.asyncio
async def test_reply_not_in_top_level(client):
    """Replies should not appear as top-level messages."""
    parent = await _send(client, "top level msg")
    await _send(client, "nested reply", reply_to_id=parent["id"])

    resp = await client.get("/team/chat")
    messages = resp.json()["data"]["messages"]
    top_ids = [m["id"] for m in messages]
    # Only parent should be top-level
    assert parent["id"] in top_ids
    # Replies should be nested, not top-level
    for msg in messages:
        if msg["id"] == parent["id"]:
            assert msg["replyCount"] == 1


@pytest.mark.asyncio
async def test_flatten_reply_to_reply(client):
    """Reply-to-reply should flatten to root parent."""
    root = await _send(client, "root")
    reply1 = await _send(client, "reply1", reply_to_id=root["id"])
    reply2 = await _send(client, "reply2 (to reply1)", reply_to_id=reply1["id"])

    # reply2 should be flattened to root
    assert reply2["replyToId"] == root["id"]

    resp = await client.get("/team/chat")
    messages = resp.json()["data"]["messages"]
    root_msg = next(m for m in messages if m["id"] == root["id"])
    assert root_msg["replyCount"] == 2
    assert len(root_msg["replies"]) == 2


@pytest.mark.asyncio
async def test_reply_to_nonexistent_returns_404(client):
    """Reply to nonexistent message returns 404."""
    resp = await client.post("/team/chat", json={
        "content": "orphan reply",
        "pinned": False,
        "replyToId": "tchat_nonexist",
    })
    assert resp.status_code == 404


# ── Read tracking ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mark_read(client):
    """Mark message as read updates isRead and readBy."""
    msg = await _send(client, "unread message")
    assert msg["isRead"] is False
    assert msg["readBy"] == []

    resp = await client.patch(f"/team/chat/{msg['id']}/read")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["isRead"] is True
    assert len(data["readBy"]) == 1
    assert data["readBy"][0]["userId"] == "usr_test"
    assert "readAt" in data["readBy"][0]


@pytest.mark.asyncio
async def test_mark_read_nonexistent_returns_404(client):
    """Mark read on nonexistent message returns 404."""
    resp = await client.patch("/team/chat/tchat_nonexist/read")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_new_message_defaults(client):
    """New messages default to isRead=False, replyCount=0, empty replies."""
    msg = await _send(client, "fresh message")
    assert msg["isRead"] is False
    assert msg["readBy"] == []
    assert msg["replyToId"] is None
    assert msg["replyCount"] == 0
    assert msg["replies"] == []


# ── Total count ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_total_excludes_replies(client):
    """Total count should only count top-level messages."""
    await _send(client, "msg1")
    parent = await _send(client, "msg2")
    await _send(client, "reply to msg2", reply_to_id=parent["id"])

    resp = await client.get("/team/chat")
    data = resp.json()["data"]
    # total should count only top-level messages
    top_level_count = len(data["messages"])
    assert data["total"] == top_level_count


# ── Pin still works ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pin_with_new_fields(client):
    """Pin toggle should still work alongside new fields."""
    msg = await _send(client, "pin test")

    resp = await client.patch(f"/team/chat/{msg['id']}/pin")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["pinned"] is True
    # New fields should be present
    assert "isRead" in data
    assert "replyCount" in data
    assert "replies" in data


# ── Role mentions ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_send_with_mentioned_roles(client):
    """Message with mentionedRoles stores and returns them."""
    msg = await _send(client, "attention nurses!", mentioned_roles=["nurse", "doctor"])
    assert "nurse" in msg["mentionedRoles"]
    assert "doctor" in msg["mentionedRoles"]


@pytest.mark.asyncio
async def test_mentioned_roles_default_empty(client):
    """Messages without mentionedRoles return empty list."""
    msg = await _send(client, "no mentions")
    assert msg["mentionedRoles"] == []


@pytest.mark.asyncio
async def test_mentions_count_endpoint(client):
    """GET /team/chat/mentions/count returns unread mention count for current user role."""
    # Current mock user is role=admin
    await _send(client, "msg for admin", mentioned_roles=["admin"])
    await _send(client, "msg for nurse", mentioned_roles=["nurse"])
    await _send(client, "msg for admin+nurse", mentioned_roles=["admin", "nurse"])

    resp = await client.get("/team/chat/mentions/count")
    assert resp.status_code == 200
    count = resp.json()["data"]["count"]
    # admin role should match 2 messages (admin-only + admin+nurse)
    assert count == 2


@pytest.mark.asyncio
async def test_mentions_count_decreases_after_read(client):
    """Mention count decreases when a mentioned message is marked read."""
    msg = await _send(client, "urgent for admin", mentioned_roles=["admin"])

    resp1 = await client.get("/team/chat/mentions/count")
    count_before = resp1.json()["data"]["count"]

    await client.patch(f"/team/chat/{msg['id']}/read")

    resp2 = await client.get("/team/chat/mentions/count")
    count_after = resp2.json()["data"]["count"]
    assert count_after == count_before - 1


@pytest.mark.asyncio
async def test_invalid_mentioned_role_rejected(client):
    """Invalid role in mentionedRoles should be rejected."""
    resp = await client.post("/team/chat", json={
        "content": "bad role",
        "pinned": False,
        "mentionedRoles": ["invalid_role"],
    })
    assert resp.status_code == 422
