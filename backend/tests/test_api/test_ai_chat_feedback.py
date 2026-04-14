"""Tests for PATCH /ai/chat/messages/{message_id}/feedback.

Regression: frontend's `updateMessageFeedback()` was calling this endpoint
from the thumbs-up/down buttons, but the backend route did not exist and
production returned 404. These tests lock in the contract.
"""
import pytest

from app.models.ai_session import AIMessage, AISession


async def _seed_session_with_messages(
    db,
    session_id: str,
    user_id: str,
    assistant_msg_id: str = None,
    user_msg_id: str = None,
):
    session = AISession(id=session_id, user_id=user_id, patient_id=None, title="t")
    db.add(session)
    if user_msg_id:
        db.add(AIMessage(id=user_msg_id, session_id=session_id, role="user", content="q"))
    if assistant_msg_id:
        db.add(AIMessage(id=assistant_msg_id, session_id=session_id, role="assistant", content="a"))
    await db.commit()


@pytest.mark.asyncio
async def test_feedback_up_then_down_then_clear(client, seeded_db):
    await _seed_session_with_messages(
        seeded_db,
        session_id="sess_fb01",
        user_id="usr_test",
        assistant_msg_id="msg_asst_fb01",
    )

    r = await client.patch("/ai/chat/messages/msg_asst_fb01/feedback", json={"feedback": "up"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["feedback"] == "up"
    assert body["data"]["id"] == "msg_asst_fb01"

    r = await client.patch("/ai/chat/messages/msg_asst_fb01/feedback", json={"feedback": "down"})
    assert r.status_code == 200
    assert r.json()["data"]["feedback"] == "down"

    r = await client.patch("/ai/chat/messages/msg_asst_fb01/feedback", json={"feedback": None})
    assert r.status_code == 200
    assert r.json()["data"]["feedback"] is None


@pytest.mark.asyncio
async def test_feedback_rejects_invalid_value(client, seeded_db):
    await _seed_session_with_messages(
        seeded_db,
        session_id="sess_fb02",
        user_id="usr_test",
        assistant_msg_id="msg_asst_fb02",
    )

    r = await client.patch("/ai/chat/messages/msg_asst_fb02/feedback", json={"feedback": "love"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_feedback_404_when_message_missing(client, seeded_db):
    r = await client.patch("/ai/chat/messages/msg_nope/feedback", json={"feedback": "up"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_feedback_404_when_session_not_owned_by_user(client, seeded_db):
    """Message exists but belongs to another user's session → 404, not 403,
    so we don't leak existence."""
    await _seed_session_with_messages(
        seeded_db,
        session_id="sess_fb_other",
        user_id="usr_someone_else",
        assistant_msg_id="msg_asst_other",
    )

    r = await client.patch("/ai/chat/messages/msg_asst_other/feedback", json={"feedback": "up"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_feedback_rejects_non_assistant_message(client, seeded_db):
    await _seed_session_with_messages(
        seeded_db,
        session_id="sess_fb03",
        user_id="usr_test",
        user_msg_id="msg_usr_fb03",
    )

    r = await client.patch("/ai/chat/messages/msg_usr_fb03/feedback", json={"feedback": "up"})
    assert r.status_code == 400
