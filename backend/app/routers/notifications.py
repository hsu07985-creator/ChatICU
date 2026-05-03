"""Lightweight notification summary for top-right bell polling.

Two endpoints:
- GET /notifications/summary — counts only (60s poll-friendly)
- GET /notifications/recent  — merged feed (patient board + team chat) for the dropdown
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.chat_message import TeamChatMessage
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.user import User
from app.utils.jsonb_compat import array_contains_user_receipt, array_contains_value, to_utc_aware
from app.utils.response import success_response

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Look-back window for mention/alert counts. Public so team-chat router
# can import the same value — TC-B04 aligned the team-chat mentions/count
# endpoint with this window so the bell number matches the chat sidebar.
MENTION_LOOKBACK_HOURS = 168
_WINDOW_HOURS = MENTION_LOOKBACK_HOURS  # backward-compat alias for in-file refs

# Message types that count as "alert" notifications
_ALERT_TYPES = ("alert", "urgent")


def _team_chat_mention_predicate(user: User, dialect_name: str):
    """Match team-chat rows where the current user is @-ed by role OR by user_id.

    Uses ``array_contains_value`` so the predicate is GIN-index-friendly
    on PostgreSQL (via ``@>``) and still correct on SQLite tests (via
    quoted-substring LIKE). TC-B02 replaced the prior ad-hoc text-cast
    that risked prefix collisions on role names like ``"all"``.
    """
    return or_(
        array_contains_value(TeamChatMessage.mentioned_roles, user.role, dialect_name),
        array_contains_value(TeamChatMessage.mentioned_user_ids, user.id, dialect_name),
    )


def _patient_board_mention_predicate(user: User, dialect_name: str):
    """Match patient-board rows where the current user is @-ed by role, by user_id, or by "all"."""
    return or_(
        array_contains_value(PatientMessage.mentioned_roles, user.role, dialect_name),
        array_contains_value(PatientMessage.mentioned_roles, "all", dialect_name),
        array_contains_value(PatientMessage.mentioned_user_ids, user.id, dialect_name),
    )


@router.get("/summary")
async def get_notification_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return unread notification counts for the current user.

    - mentions: unread patient-board messages whose `mentioned_roles` contains
      the user's role + unread team-chat messages where the user is @-ed by
      role OR by user_id (Path B)
    - alerts: unread patient-board messages whose `message_type` is 'alert'/'urgent'
    - total: mentions + alerts (not deduplicated)

    Team-chat unread is per-user (TC-W3-T1): a message is unread for me
    iff I am not in its ``read_by`` array AND its timestamp is after my
    ``last_chat_visit_at``. The previous global ``is_read`` flag let any
    reader silently zero everyone's mention badge.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_WINDOW_HOURS)
    dialect_name = db.bind.dialect.name

    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(db_user.last_chat_visit_at if db_user is not None else None)
    tc_baseline = max(cutoff, last_visit) if last_visit is not None else None
    tc_already_read = array_contains_user_receipt(
        TeamChatMessage.read_by, user.id, dialect_name,
    )

    pb_mentions_stmt = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.is_read == False)  # noqa: E712
        .where(_patient_board_mention_predicate(user, dialect_name))
    )
    if tc_baseline is None:
        # New user with no last_chat_visit_at — show 0 team-chat mentions
        # until their first chat visit (matches /team/chat/unread-count).
        tc_mentions_stmt = select(func.count(TeamChatMessage.id)).where(False)
    else:
        tc_mentions_stmt = (
            select(func.count(TeamChatMessage.id))
            .where(TeamChatMessage.timestamp > tc_baseline)
            .where(~tc_already_read)
            .where(_team_chat_mention_predicate(user, dialect_name))
        )
    alerts_stmt = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.is_read == False)  # noqa: E712
        .where(PatientMessage.message_type.in_(_ALERT_TYPES))
    )

    pb_mentions = (await db.execute(pb_mentions_stmt)).scalar_one() or 0
    tc_mentions = (await db.execute(tc_mentions_stmt)).scalar_one() or 0
    alerts_count = (await db.execute(alerts_stmt)).scalar_one() or 0

    mentions_count = int(pb_mentions) + int(tc_mentions)

    return success_response(data={
        "mentions": mentions_count,
        "alerts": int(alerts_count),
        "total": mentions_count + int(alerts_count),
        "windowHours": _WINDOW_HOURS,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    })


@router.get("/recent")
async def get_recent_notifications(
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Merged recent feed (patient board mentions + team chat mentions).

    Each item carries a `deepLink` so the bell dropdown can navigate without
    extra logic. Sorted by timestamp DESC, capped at `limit`.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_WINDOW_HOURS)
    dialect_name = db.bind.dialect.name

    # Per-user team-chat read state (TC-W3-T1) — same model as /summary.
    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(db_user.last_chat_visit_at if db_user is not None else None)
    tc_baseline = max(cutoff, last_visit) if last_visit is not None else None

    # ── Patient board mentions ─────────────────────────────────────────
    pb_stmt = (
        select(PatientMessage, Patient.bed_number, Patient.name)
        .join(Patient, Patient.id == PatientMessage.patient_id, isouter=True)
        .where(PatientMessage.timestamp >= cutoff)
        .where(_patient_board_mention_predicate(user, dialect_name))
        .order_by(PatientMessage.timestamp.desc())
        .limit(limit)
    )
    pb_rows = (await db.execute(pb_stmt)).all()

    pb_items = [
        {
            "id": f"pb_{m.id}",
            "source": "patient_board",
            "messageId": m.id,
            "patientId": m.patient_id,
            "patientName": pname,
            "bedNumber": bed,
            "authorName": m.author_name,
            "authorRole": m.author_role,
            "preview": (m.content or "")[:140],
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            "isRead": bool(m.is_read),
            "deepLink": f"/patient/{m.patient_id}?tab=messages",
        }
        for (m, bed, pname) in pb_rows
    ]

    # ── Team chat mentions ─────────────────────────────────────────────
    if tc_baseline is None:
        tc_msgs = []
    else:
        tc_stmt = (
            select(TeamChatMessage)
            .where(TeamChatMessage.timestamp > tc_baseline)
            .where(_team_chat_mention_predicate(user, dialect_name))
            .order_by(TeamChatMessage.timestamp.desc())
            .limit(limit)
        )
        tc_msgs = (await db.execute(tc_stmt)).scalars().all()

    # Compute per-user read state inline since SQL predicate is dialect-aware
    # and we already have the rows loaded.
    def _tc_is_read_by_me(m: TeamChatMessage) -> bool:
        for entry in (m.read_by or []):
            if isinstance(entry, dict) and entry.get("userId") == user.id:
                return True
        return False

    tc_items = [
        {
            "id": f"tc_{m.id}",
            "source": "team_chat",
            "messageId": m.id,
            "patientId": None,
            "patientName": None,
            "bedNumber": None,
            "authorName": m.user_name,
            "authorRole": m.user_role,
            "preview": (m.content or "")[:140],
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            "isRead": _tc_is_read_by_me(m),
            "deepLink": "/chat",
        }
        for m in tc_msgs
    ]

    merged = pb_items + tc_items
    merged.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    merged = merged[:limit]

    return success_response(data={
        "items": merged,
        "windowHours": _WINDOW_HOURS,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    })


@router.post("/mark-read")
async def mark_all_notifications_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark every unread message that contributes to this user's bell count as read.

    Covers patient-board mentions, patient-board alerts, and team-chat mentions
    inside the look-back window. Sets `is_read=True` and appends a read receipt
    to `read_by` (matching the per-message endpoint at messages.py:602).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_WINDOW_HOURS)
    now = datetime.now(timezone.utc)
    receipt = {"userId": user.id, "userName": user.name, "readAt": now.isoformat()}
    dialect_name = db.bind.dialect.name

    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(db_user.last_chat_visit_at if db_user is not None else None)
    tc_baseline = max(cutoff, last_visit) if last_visit is not None else None
    tc_already_read = array_contains_user_receipt(
        TeamChatMessage.read_by, user.id, dialect_name,
    )

    pb_stmt = select(PatientMessage).where(
        PatientMessage.timestamp >= cutoff,
        PatientMessage.is_read == False,  # noqa: E712
        or_(
            _patient_board_mention_predicate(user, dialect_name),
            PatientMessage.message_type.in_(_ALERT_TYPES),
        ),
    )
    pb_msgs = (await db.execute(pb_stmt)).scalars().all()

    if tc_baseline is None:
        tc_msgs = []
    else:
        tc_stmt = select(TeamChatMessage).where(
            TeamChatMessage.timestamp > tc_baseline,
            ~tc_already_read,
            _team_chat_mention_predicate(user, dialect_name),
        )
        tc_msgs = (await db.execute(tc_stmt)).scalars().all()

    for m in pb_msgs:
        m.is_read = True
        rb = list(m.read_by or [])
        # Dedup: don't append a second receipt for the same user.
        if not any(isinstance(e, dict) and e.get("userId") == user.id for e in rb):
            rb.append(receipt)
        m.read_by = rb

    for m in tc_msgs:
        # is_read kept for backward compat; per-user state is read_by.
        m.is_read = True
        rb = list(m.read_by or [])
        if not any(isinstance(e, dict) and e.get("userId") == user.id for e in rb):
            rb.append(receipt)
        m.read_by = rb

    await db.commit()

    return success_response(data={
        "markedPatientBoard": len(pb_msgs),
        "markedTeamChat": len(tc_msgs),
        "total": len(pb_msgs) + len(tc_msgs),
        "generatedAt": now.isoformat(),
    })
