"""Tests for GET /notifications/summary endpoint.

Per-user model (TC-FU-T1): the patient-board half of /notifications/summary
now consults ``read_by`` (per-user) instead of the legacy global ``is_read``
boolean. Tests have been re-seeded accordingly:

- "already-read by usr_test" rows now carry an explicit ``read_by`` entry
  for ``usr_test`` instead of ``is_read=True``.
- Each test seeds ``users.last_chat_visit_at`` so the unified PB+TC
  baseline is older than the freshly-inserted rows; without this, a
  brand-new user would see 0 mentions/alerts (intended first-visit
  behaviour, mirrors /team/chat/unread-count).
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.message import PatientMessage
from app.models.user import User


async def _seed_visit_baseline_in_past(seeded_db, user_id="usr_test", hours_ago=1):
    """Same helper as test_team_chat / test_patient_board_per_user_unread —
    set ``last_chat_visit_at`` strictly older than the test's freshly-sent
    messages so the unified PB+TC baseline accepts them as "after my last
    visit"."""
    db_user = await seeded_db.get(User, user_id)
    db_user.last_chat_visit_at = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    await seeded_db.commit()


def _read_by_usr_test():
    """Single-entry ``read_by`` array marking the row as already-read by
    the conftest's mock user (``usr_test``)."""
    return [{
        "userId": "usr_test",
        "userName": "Test Doctor",
        "readAt": datetime.now(timezone.utc).isoformat(),
    }]


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
    await _seed_visit_baseline_in_past(seeded_db)
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
            read_by=[],
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
            read_by=[],
        ),
        # Already read by usr_test — should NOT count for usr_test
        PatientMessage(
            id="pmsg_notif_003",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="general",
            content="@admin 舊訊息",
            timestamp=now,
            is_read=False,
            mentioned_roles=["admin"],
            read_by=_read_by_usr_test(),
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
    await _seed_visit_baseline_in_past(seeded_db)
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
            read_by=[],
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
            read_by=[],
        ),
        # Read by usr_test — should NOT count for usr_test
        PatientMessage(
            id="pmsg_notif_103",
            patient_id="pat_001",
            author_id="usr_test",
            author_name="Nurse A",
            author_role="nurse",
            message_type="alert",
            content="舊警示",
            timestamp=now,
            is_read=False,
            read_by=_read_by_usr_test(),
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
    await _seed_visit_baseline_in_past(seeded_db)
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
            read_by=[],
        )
    )
    await seeded_db.commit()

    resp = await client.get("/notifications/summary")
    data = resp.json()["data"]
    assert data["mentions"] == 0
    assert data["alerts"] == 0


@pytest.mark.asyncio
async def test_mark_read_clears_mentions_and_alerts(client, seeded_db):
    """POST /notifications/mark-read should mark contributing messages read.

    Coverage:
    - Unread mention matching role → marked read (per-user receipt added)
    - Unread alert (no mention) → marked read (per-user receipt added)
    - Already-read-by-me mention → untouched
    - Out-of-window unread alert → untouched
    - Mention NOT matching this user's role → untouched
    """
    await _seed_visit_baseline_in_past(seeded_db)
    now = datetime.now(timezone.utc)
    long_ago = now - timedelta(hours=200)
    seeded_db.add_all([
        PatientMessage(
            id="pmsg_mark_001",
            patient_id="pat_001",
            author_id="usr_test", author_name="Nurse A", author_role="nurse",
            message_type="general", content="@admin 請看",
            timestamp=now, is_read=False, mentioned_roles=["admin"],
            read_by=[],
        ),
        PatientMessage(
            id="pmsg_mark_002",
            patient_id="pat_001",
            author_id="usr_test", author_name="Nurse A", author_role="nurse",
            message_type="alert", content="警示",
            timestamp=now, is_read=False,
            read_by=[],
        ),
        # Already read by usr_test — should NOT be re-marked
        PatientMessage(
            id="pmsg_mark_003_read",
            patient_id="pat_001",
            author_id="usr_test", author_name="Nurse A", author_role="nurse",
            message_type="general", content="@admin 已讀",
            timestamp=now, is_read=False, mentioned_roles=["admin"],
            read_by=_read_by_usr_test(),
        ),
        PatientMessage(
            id="pmsg_mark_004_old",
            patient_id="pat_001",
            author_id="usr_test", author_name="Nurse A", author_role="nurse",
            message_type="alert", content="超過 window",
            timestamp=long_ago, is_read=False,
            read_by=[],
        ),
        PatientMessage(
            id="pmsg_mark_005_other_role",
            patient_id="pat_001",
            author_id="usr_test", author_name="Nurse A", author_role="nurse",
            message_type="general", content="@doctor 不關 admin",
            timestamp=now, is_read=False, mentioned_roles=["doctor"],
            read_by=[],
        ),
    ])
    await seeded_db.commit()

    # Sanity: pre-mark badge = 2 (1 mention + 1 alert)
    pre = (await client.get("/notifications/summary")).json()["data"]
    assert pre["total"] == 2

    resp = await client.post("/notifications/mark-read")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["markedPatientBoard"] == 2
    assert body["data"]["markedTeamChat"] == 0
    assert body["data"]["total"] == 2

    # Badge cleared
    post = (await client.get("/notifications/summary")).json()["data"]
    assert post["total"] == 0

    # Untouched rows stay unread / out of count
    seeded_db.expire_all()
    from sqlalchemy import select as _select
    rows = (await seeded_db.execute(
        _select(PatientMessage).order_by(PatientMessage.id)
    )).scalars().all()
    by_id = {r.id: r for r in rows}
    # Touched rows now carry usr_test in their read_by AND have legacy
    # is_read=True flipped (kept for backward compat with msg_to_dict).
    assert by_id["pmsg_mark_001"].is_read is True
    assert by_id["pmsg_mark_002"].is_read is True
    # pmsg_mark_003 was seeded with read_by=[usr_test] but is_read=False
    # — predicate excludes it so neither flag flips.
    assert any(
        e.get("userId") == "usr_test"
        for e in (by_id["pmsg_mark_003_read"].read_by or [])
    )
    assert by_id["pmsg_mark_003_read"].is_read is False
    assert by_id["pmsg_mark_004_old"].is_read is False
    assert by_id["pmsg_mark_005_other_role"].is_read is False
    # read_by receipt appended on the rows we touched
    assert (by_id["pmsg_mark_001"].read_by or [])[-1]["userId"] == "usr_test"
    assert (by_id["pmsg_mark_002"].read_by or [])[-1]["userId"] == "usr_test"
