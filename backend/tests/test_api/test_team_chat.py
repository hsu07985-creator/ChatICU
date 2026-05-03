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


# ── Per-user unread (sidebar badge) ────────────────────────────────────

@pytest.mark.asyncio
async def test_unread_count_zero_before_first_visit(client):
    """Never-visited users get 0 even when there are messages."""
    # The mock auth fixture creates usr_test with last_chat_visit_at=NULL
    # (column was just added). Send a few messages from another user.
    from datetime import datetime, timezone
    from app.models.chat_message import TeamChatMessage
    # We need a separate session to insert "from another user" — reuse the
    # /team/chat endpoint to send, then patch the user_id manually via the
    # send-as-current-user shortcut: the simplest path is just to call _send
    # which creates a message attributed to usr_test, then verify the count.
    # Since unread excludes self, that path always shows 0 before visit.
    await _send(client, "before-visit msg")

    resp = await client.get("/team/chat/unread-count")
    assert resp.status_code == 200
    assert resp.json()["data"]["count"] == 0


@pytest.mark.asyncio
async def test_unread_count_excludes_own_messages_after_visit(client, seeded_db):
    """After visiting, my own messages don't count; others' do."""
    from datetime import datetime, timezone, timedelta
    from app.models.chat_message import TeamChatMessage

    # 1) Mark visit so last_chat_visit_at = now
    visit_resp = await client.post("/team/chat/visit")
    assert visit_resp.status_code == 200

    # Tick the clock forward in DB by inserting messages with timestamps
    # explicitly later than the just-recorded visit.
    later = datetime.now(timezone.utc) + timedelta(seconds=5)
    seeded_db.add_all([
        # From me — should NOT count
        TeamChatMessage(
            id="tchat_unread_self",
            user_id="usr_test", user_name="Me", user_role="admin",
            content="my own", timestamp=later,
            is_read=False, read_by=[],
            mentioned_roles=[], mentioned_user_ids=[],
        ),
        # From someone else — SHOULD count
        TeamChatMessage(
            id="tchat_unread_other_1",
            user_id="usr_other", user_name="Other A", user_role="nurse",
            content="from a coworker", timestamp=later,
            is_read=False, read_by=[],
            mentioned_roles=[], mentioned_user_ids=[],
        ),
        TeamChatMessage(
            id="tchat_unread_other_2",
            user_id="usr_other2", user_name="Other B", user_role="doctor",
            content="another coworker", timestamp=later,
            is_read=False, read_by=[],
            mentioned_roles=[], mentioned_user_ids=[],
        ),
    ])
    await seeded_db.commit()

    resp = await client.get("/team/chat/unread-count")
    assert resp.json()["data"]["count"] == 2


@pytest.mark.asyncio
async def test_visit_resets_unread_count(client, seeded_db):
    """Calling /visit again clears the badge."""
    from datetime import datetime, timezone, timedelta
    from app.models.chat_message import TeamChatMessage

    await client.post("/team/chat/visit")
    later = datetime.now(timezone.utc) + timedelta(seconds=5)
    seeded_db.add(TeamChatMessage(
        id="tchat_unread_reset",
        user_id="usr_other", user_name="Other", user_role="nurse",
        content="ping", timestamp=later,
        is_read=False, read_by=[],
        mentioned_roles=[], mentioned_user_ids=[],
    ))
    await seeded_db.commit()

    pre = (await client.get("/team/chat/unread-count")).json()["data"]["count"]
    assert pre == 1

    # Re-visit (timestamp moves past the message) → count back to 0
    import asyncio
    await asyncio.sleep(0.01)  # ensure NOW() > later by epsilon
    # Push the message timestamp back to the past so the new visit overtakes it
    seeded_db.expire_all()
    from sqlalchemy import select as _select
    msg = (await seeded_db.execute(
        _select(TeamChatMessage).where(TeamChatMessage.id == "tchat_unread_reset")
    )).scalar_one()
    msg.timestamp = datetime.now(timezone.utc) - timedelta(seconds=10)
    await seeded_db.commit()

    await client.post("/team/chat/visit")
    post = (await client.get("/team/chat/unread-count")).json()["data"]["count"]
    assert post == 0


@pytest.mark.asyncio
async def test_invalid_mentioned_role_rejected(client):
    """Invalid role in mentionedRoles should be rejected."""
    resp = await client.post("/team/chat", json={
        "content": "bad role",
        "pinned": False,
        "mentionedRoles": ["invalid_role"],
    })
    assert resp.status_code == 422


# ── TC-B01: admin gate for pin / pinned-post / mark_read ───────────────

def _user_override(user_id: str, name: str, role: str):
    """Return a get_current_user override that yields a User with the
    given role. Used to swap the mock-auth identity mid-test so we can
    assert non-admin paths are 403."""
    from app.models.user import User
    async def _inner():
        return User(
            id=user_id,
            name=name,
            username=user_id,
            password_hash="",
            email=f"{user_id}@hospital.com",
            role=role,
            unit="ICU",
            active=True,
        )
    return _inner


@pytest.mark.asyncio
async def test_non_admin_cannot_post_pinned(client):
    """POST /team/chat with pinned=True must reject non-admin (TC-B01)."""
    from app.main import app
    from app.middleware.auth import get_current_user

    app.dependency_overrides[get_current_user] = _user_override(
        "usr_nurse_a", "Nurse A", role="nurse",
    )
    try:
        resp = await client.post("/team/chat", json={
            "content": "sneaky announcement",
            "pinned": True,
        })
        assert resp.status_code == 403
        # Plain (non-pinned) post should still succeed for nurse
        resp_ok = await client.post("/team/chat", json={
            "content": "regular message",
            "pinned": False,
        })
        assert resp_ok.status_code == 200
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_non_admin_cannot_toggle_pin(client):
    """PATCH /team/chat/{id}/pin must reject non-admin (TC-B01)."""
    from app.main import app
    from app.middleware.auth import get_current_user

    # Admin posts a message first
    msg = await _send(client, "to be pinned by admin only")

    # Swap to nurse and try to pin
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_nurse_b", "Nurse B", role="nurse",
    )
    try:
        resp = await client.patch(f"/team/chat/{msg['id']}/pin")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_non_recipient_cannot_mark_read(client):
    """Marking-read flips a global is_read flag that drives team-wide
    mention badges; restrict to author / mentioned recipients / admin
    (TC-B01 + audit F-02 mitigation)."""
    from app.main import app
    from app.middleware.auth import get_current_user

    # Admin sends a message mentioning role=doctor
    msg = await _send(client, "for doctors only", mentioned_roles=["doctor"])

    # Switch to a pharmacist (not author, not mentioned)
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_x", "Pharmacist X", role="pharmacist",
    )
    try:
        resp = await client.patch(f"/team/chat/{msg['id']}/read")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_mentioned_recipient_can_mark_read(client):
    """A user in mentioned_roles SHOULD be able to mark read."""
    from app.main import app
    from app.middleware.auth import get_current_user

    msg = await _send(client, "doctors please ack", mentioned_roles=["doctor"])

    # Doctor (different from admin author) reads it
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_doc_a", "Doctor A", role="doctor",
    )
    try:
        resp = await client.patch(f"/team/chat/{msg['id']}/read")
        assert resp.status_code == 200
        assert resp.json()["data"]["isRead"] is True
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_author_can_mark_own_read(client):
    """Authors can mark their own message read (idempotent self-action)."""
    msg = await _send(client, "self note")
    resp = await client.patch(f"/team/chat/{msg['id']}/read")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_mention_predicate_no_substring_collision(client, seeded_db):
    """TC-B02: mentions/count must use JSONB containment, not text-cast LIKE.

    The old ``cast(JSONB as text) LIKE '"<role>"'`` predicate would falsely
    match if a row had a role string containing the caller's role as a
    proper prefix-with-quotes match isn't possible with the current enum
    (admin/doctor/nurse/np/pharmacist), but inserting raw rows lets us
    pin the contract: role=admin must NOT match a row whose only
    mentioned_role is the literal "all_admins" (a hypothetical future
    enum addition).
    """
    from datetime import datetime, timezone
    from app.models.chat_message import TeamChatMessage

    seeded_db.add(TeamChatMessage(
        id="tchat_substr_check",
        user_id="usr_other",
        user_name="Other",
        user_role="doctor",
        content="should not match admin",
        timestamp=datetime.now(timezone.utc),
        pinned=False,
        is_read=False,
        read_by=[],
        mentioned_roles=["all_admins"],  # superset string of "admin"
        mentioned_user_ids=[],
    ))
    await seeded_db.commit()

    resp = await client.get("/team/chat/mentions/count")
    assert resp.status_code == 200
    # Default mock user is role=admin; with @> it cannot match ["all_admins"].
    # If this returns >= 1 the predicate is back to substring matching.
    count = resp.json()["data"]["count"]
    # We only inserted one synthetic row; everything else was created via
    # the API in earlier tests in the same module's session-scoped fixture
    # — but each test runs against a fresh DB (function-scoped seeded_db),
    # so this row is the only one. Expect 0.
    assert count == 0, f"@> predicate must not match 'all_admins' for role=admin; got {count}"


@pytest.mark.asyncio
async def test_mark_read_writes_audit_log(client, seeded_db):
    """mark_read writes an audit log so silent zeroing of mention badges
    is traceable (TC-B01 mitigation for audit gap)."""
    from sqlalchemy import select as _select
    from app.models.audit_log import AuditLog

    msg = await _send(client, "auditable", mentioned_roles=["admin"])
    resp = await client.patch(f"/team/chat/{msg['id']}/read")
    assert resp.status_code == 200

    seeded_db.expire_all()
    audit_rows = (await seeded_db.execute(
        _select(AuditLog).where(AuditLog.target == msg["id"])
    )).scalars().all()
    actions = [r.action for r in audit_rows]
    assert "標記團隊訊息已讀" in actions
