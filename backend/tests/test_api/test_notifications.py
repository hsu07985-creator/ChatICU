"""Tests for GET /notifications/summary endpoint."""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.message import PatientMessage


@pytest.mark.asyncio
async def test_summary_empty(client):
    """No messages → all counts 0."""
    resp = await client.get("/notifications/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["mentions"] == 0
    assert body["data"]["alerts"] == 0
    assert body["data"]["total"] == 0


@pytest.mark.asyncio
async def test_summary_counts_mentions_matching_role(client, seeded_db):
    """Unread message with mentioned_roles containing user's role → counted as mention."""
    now = datetime.now(timezone.utc)
    seeded_db.add_all([
        PatientMessage(
            id="pmsg_notif_001",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="general",
            content="@admin 請協助確認",
            timestamp=now,
            is_read=False,
            mentioned_roles=["admin"],
        ),
        # Not mentioning admin — should NOT count
        PatientMessage(
            id="pmsg_notif_002",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="general",
            content="@doctor 請協助",
            timestamp=now,
            is_read=False,
            mentioned_roles=["doctor"],
        ),
        # Already read — should NOT count
        PatientMessage(
            id="pmsg_notif_003",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="general",
            content="@admin 舊訊息",
            timestamp=now,
            is_read=True,
            mentioned_roles=["admin"],
        ),
    ])
    await seeded_db.commit()

    resp = await client.get("/notifications/summary")
    data = resp.json()["data"]
    assert data["mentions"] == 1
    assert data["alerts"] == 0
    assert data["total"] == 1


@pytest.mark.asyncio
async def test_summary_counts_alert_and_urgent(client, seeded_db):
    """Unread messages with type alert/urgent → counted as alerts."""
    now = datetime.now(timezone.utc)
    seeded_db.add_all([
        PatientMessage(
            id="pmsg_notif_101",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="alert",
            content="血壓異常",
            timestamp=now,
            is_read=False,
        ),
        PatientMessage(
            id="pmsg_notif_102",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="urgent",
            content="緊急處置",
            timestamp=now,
            is_read=False,
        ),
        # Read — should NOT count
        PatientMessage(
            id="pmsg_notif_103",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="alert",
            content="舊警示",
            timestamp=now,
            is_read=True,
        ),
    ])
    await seeded_db.commit()

    resp = await client.get("/notifications/summary")
    data = resp.json()["data"]
    assert data["alerts"] == 2
    assert data["total"] == 2


@pytest.mark.asyncio
async def test_summary_excludes_old_messages(client, seeded_db):
    """Messages older than window (168h) should not be counted."""
    long_ago = datetime.now(timezone.utc) - timedelta(hours=200)
    seeded_db.add(
        PatientMessage(
            id="pmsg_notif_old",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="alert",
            content="old alert",
            timestamp=long_ago,
            is_read=False,
            mentioned_roles=["admin"],
        )
    )
    await seeded_db.commit()

    resp = await client.get("/notifications/summary")
    data = resp.json()["data"]
    assert data["mentions"] == 0
    assert data["alerts"] == 0
