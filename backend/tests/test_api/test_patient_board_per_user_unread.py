"""Tests for TC-FU-T1: patient-board mention/alert/unread per-user.

W3-T1 fixed the team_chat side of F-02 (per-user mention unread); this
suite locks the same contract on the patient-board side. Pre-fix, every
PatientMessage had a single global ``is_read`` flag that was flipped by
the first reader, silently zeroing every other user's badge across:

- /notifications/summary (mentions + alerts)
- /patients (列表頁紅點)
- /dashboard/stats (messages.unread)
- /patients/messages/my-mentions

After TC-FU-T1, "unread for me" = my user_id is NOT in ``read_by``,
gated by ``users.last_chat_visit_at`` so the model switch doesn't
retroactively flood badges.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.middleware.auth import get_current_user
from app.main import app
from app.models.message import PatientMessage
from app.models.user import User


def _user_override(user_id: str, name: str, role: str, unit: str = "ICU"):
    """Mirror of test_team_chat._user_override — swap the mocked
    current user mid-test so per-user assertions can flip identities."""
    async def _inner():
        return User(
            id=user_id,
            name=name,
            username=user_id,
            password_hash="",
            email=f"{user_id}@hospital.com",
            role=role,
            unit=unit,
            active=True,
        )
    return _inner


async def _seed_visit_baseline_in_past(seeded_db, user_id="usr_test", hours_ago=1):
    """Same baseline-seeding pattern as test_team_chat. The PB unread
    model also gates on ``last_chat_visit_at`` (TC-FU-T1 option C —
    unified PB+TC baseline) so tests that send fresh messages need a
    baseline strictly older than those messages."""
    db_user = await seeded_db.get(User, user_id)
    db_user.last_chat_visit_at = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    await seeded_db.commit()


async def _seed_two_admins(seeded_db, hours_ago=1):
    """Insert a second admin user (Admin B) and baseline both. Both
    admins are role=admin so a mention of ``mentioned_roles=["admin"]``
    targets both."""
    other = User(
        id="usr_admin_b",
        name="Admin B",
        username="adminb",
        password_hash="",
        email="adminb@hospital.com",
        role="admin",
        unit="ICU",
        active=True,
        last_chat_visit_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
    )
    seeded_db.add(other)
    await _seed_visit_baseline_in_past(seeded_db, user_id="usr_test", hours_ago=hours_ago)


# ── /notifications/summary ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pb_mention_per_user_isolation(client, seeded_db):
    """A's mark-read for a PB mention must NOT clear B's mention count."""
    await _seed_two_admins(seeded_db)

    # Seed a single PB mention targeting role=admin
    now = datetime.now(timezone.utc)
    seeded_db.add(PatientMessage(
        id="pmsg_pb_mention_1",
        patient_id="pat_001",
        author_id="usr_other",
        author_name="Other",
        author_role="nurse",
        message_type="general",
        content="@admin urgent",
        timestamp=now,
        is_read=False,
        mentioned_roles=["admin"],
        read_by=[],
    ))
    await seeded_db.commit()

    # Admin A sees the mention
    summary_a_pre = (await client.get("/notifications/summary")).json()["data"]
    assert summary_a_pre["mentions"] == 1

    # Admin A marks-read via the per-message endpoint (matches FE behaviour)
    resp = await client.patch("/patients/pat_001/messages/pmsg_pb_mention_1/read")
    assert resp.status_code == 200

    # Admin A's count drops to 0
    summary_a_post = (await client.get("/notifications/summary")).json()["data"]
    assert summary_a_post["mentions"] == 0

    # Switch to Admin B — their count must still be 1
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_admin_b", "Admin B", role="admin",
    )
    try:
        summary_b = (await client.get("/notifications/summary")).json()["data"]
        assert summary_b["mentions"] == 1, (
            "Admin B's PB mention badge should NOT be cleared by Admin A's "
            "mark-read action — that was the F-02 PB bug."
        )
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_pb_alert_per_user_isolation(client, seeded_db):
    """A's mark-read for a PB alert must NOT clear B's alert count."""
    await _seed_two_admins(seeded_db)

    now = datetime.now(timezone.utc)
    seeded_db.add(PatientMessage(
        id="pmsg_pb_alert_1",
        patient_id="pat_001",
        author_id="usr_other",
        author_name="Other",
        author_role="nurse",
        message_type="alert",
        content="critical BP",
        timestamp=now,
        is_read=False,
        read_by=[],
    ))
    await seeded_db.commit()

    summary_a_pre = (await client.get("/notifications/summary")).json()["data"]
    assert summary_a_pre["alerts"] == 1

    resp = await client.patch("/patients/pat_001/messages/pmsg_pb_alert_1/read")
    assert resp.status_code == 200

    summary_a_post = (await client.get("/notifications/summary")).json()["data"]
    assert summary_a_post["alerts"] == 0

    app.dependency_overrides[get_current_user] = _user_override(
        "usr_admin_b", "Admin B", role="admin",
    )
    try:
        summary_b = (await client.get("/notifications/summary")).json()["data"]
        assert summary_b["alerts"] == 1, (
            "Admin B's PB alert badge should NOT be cleared by Admin A's "
            "mark-read action."
        )
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


# ── /patients (list with hasUnreadMessages) ────────────────────────────


@pytest.mark.asyncio
async def test_patient_list_unread_per_user(client, seeded_db):
    """Patient-list ``hasUnreadMessages`` is per-user: B still sees it
    after A reads."""
    await _seed_two_admins(seeded_db)

    now = datetime.now(timezone.utc)
    seeded_db.add(PatientMessage(
        id="pmsg_list_unread_1",
        patient_id="pat_001",
        author_id="usr_other",
        author_name="Other",
        author_role="nurse",
        message_type="general",
        content="hello",
        timestamp=now,
        is_read=False,
        read_by=[],
    ))
    await seeded_db.commit()

    # Admin A sees the dot
    list_a_pre = (await client.get("/patients")).json()["data"]["patients"]
    pat_a_pre = next(p for p in list_a_pre if p["id"] == "pat_001")
    assert pat_a_pre["hasUnreadMessages"] is True

    # Admin A marks-read
    resp = await client.patch("/patients/pat_001/messages/pmsg_list_unread_1/read")
    assert resp.status_code == 200

    # Admin A's dot is gone
    list_a_post = (await client.get("/patients")).json()["data"]["patients"]
    pat_a_post = next(p for p in list_a_post if p["id"] == "pat_001")
    assert pat_a_post["hasUnreadMessages"] is False

    # Switch to Admin B — dot must still be there
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_admin_b", "Admin B", role="admin",
    )
    try:
        list_b = (await client.get("/patients")).json()["data"]["patients"]
        pat_b = next(p for p in list_b if p["id"] == "pat_001")
        assert pat_b["hasUnreadMessages"] is True, (
            "Admin B's patient-list red dot should NOT be cleared by "
            "Admin A's mark-read action — that was the F-02 PB bug "
            "in /patients (Agent 3 cross-page coverage)."
        )
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


# ── /dashboard/stats (messages.unread) ─────────────────────────────────


@pytest.mark.asyncio
async def test_dashboard_unread_per_user(client, seeded_db):
    """``dashboard.messages.unread`` is per-user; A reads → B unaffected."""
    await _seed_two_admins(seeded_db)

    now = datetime.now(timezone.utc)
    seeded_db.add(PatientMessage(
        id="pmsg_dash_1",
        patient_id="pat_001",
        author_id="usr_other",
        author_name="Other",
        author_role="nurse",
        message_type="general",
        content="ping",
        timestamp=now,
        is_read=False,
        read_by=[],
    ))
    await seeded_db.commit()

    dash_a_pre = (await client.get("/dashboard/stats")).json()["data"]
    assert dash_a_pre["messages"]["unread"] == 1

    await client.patch("/patients/pat_001/messages/pmsg_dash_1/read")
    dash_a_post = (await client.get("/dashboard/stats")).json()["data"]
    assert dash_a_post["messages"]["unread"] == 0

    app.dependency_overrides[get_current_user] = _user_override(
        "usr_admin_b", "Admin B", role="admin",
    )
    try:
        dash_b = (await client.get("/dashboard/stats")).json()["data"]
        assert dash_b["messages"]["unread"] == 1, (
            "Dashboard unread count must be per-user."
        )
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


# ── /patients/messages/my-mentions (unread_only filter) ────────────────


@pytest.mark.asyncio
async def test_my_mentions_unread_per_user(client, seeded_db):
    """``my-mentions?unread_only=true`` is per-user; A reads → B still sees."""
    await _seed_two_admins(seeded_db)

    now = datetime.now(timezone.utc)
    seeded_db.add(PatientMessage(
        id="pmsg_mymentions_1",
        patient_id="pat_001",
        author_id="usr_other",
        author_name="Other",
        author_role="nurse",
        message_type="general",
        content="@admin look",
        timestamp=now,
        is_read=False,
        mentioned_roles=["admin"],
        read_by=[],
    ))
    await seeded_db.commit()

    # Admin A sees it in unread_only=true
    a_pre = (await client.get(
        "/patients/messages/my-mentions?unread_only=true"
    )).json()["data"]
    assert a_pre["totalMentions"] == 1

    await client.patch("/patients/pat_001/messages/pmsg_mymentions_1/read")

    # Admin A no longer sees it
    a_post = (await client.get(
        "/patients/messages/my-mentions?unread_only=true"
    )).json()["data"]
    assert a_post["totalMentions"] == 0

    # Admin B still sees it
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_admin_b", "Admin B", role="admin",
    )
    try:
        b_view = (await client.get(
            "/patients/messages/my-mentions?unread_only=true"
        )).json()["data"]
        assert b_view["totalMentions"] == 1, (
            "Admin B's my-mentions unread filter must NOT be affected "
            "by Admin A's mark-read action."
        )
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )
