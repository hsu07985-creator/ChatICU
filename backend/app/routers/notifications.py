"""Lightweight notification summary for top-right bell polling.

Two endpoints:
- GET /notifications/summary — counts only (60s poll-friendly)
- GET /notifications/recent  — merged feed (patient board + team chat) for the dropdown
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.chat_message import TeamChatMessage
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.user import User
from app.utils.jsonb_compat import array_contains_user_receipt, array_contains_value, to_utc_aware
from app.utils.read_receipt import append_read_receipt
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
    """Match team-chat rows where the current user is @-ed by role OR by user_id OR by @所有人.

    Uses ``array_contains_value`` so the predicate is GIN-index-friendly
    on PostgreSQL (via ``@>``) and still correct on SQLite tests (via
    quoted-substring LIKE). TC-B02 replaced the prior ad-hoc text-cast
    that risked prefix collisions on role names like ``"all"``.

    @所有人 path uses the dedicated ``mentions_all`` boolean column
    (migration 080) and excludes the author so the sender doesn't
    bell-notify themselves.
    """
    return or_(
        array_contains_value(TeamChatMessage.mentioned_roles, user.role, dialect_name),
        array_contains_value(TeamChatMessage.mentioned_user_ids, user.id, dialect_name),
        and_(
            TeamChatMessage.mentions_all == True,  # noqa: E712
            TeamChatMessage.user_id != user.id,
        ),
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

    Both team-chat and patient-board unread are per-user (TC-W3-T1 +
    TC-FU-T1): a message is unread for me iff I am not in its
    ``read_by`` array AND its timestamp is after my baseline. The old
    global ``is_read`` flag let any reader silently zero everyone's
    mention/alert badge — F-02 in the audit.

    Baseline is unified across PB+TC via ``users.last_chat_visit_at``
    (TC-FU-T1 option C): the same "first-visit" gate prevents a flood
    of historical mentions/alerts when the model switch lands. The
    168h window is also retained as a hard cap so a user who never
    visits chat doesn't accumulate ancient items forever.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_WINDOW_HOURS)
    dialect_name = db.bind.dialect.name

    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(db_user.last_chat_visit_at if db_user is not None else None)
    # Unified baseline: chat visit gates both team-chat AND patient-board
    # since the same user activity invalidates "舊資料視為已讀" for both.
    baseline_at = max(cutoff, last_visit) if last_visit is not None else None
    tc_already_read = array_contains_user_receipt(
        TeamChatMessage.read_by, user.id, dialect_name,
    )
    pb_already_read = array_contains_user_receipt(
        PatientMessage.read_by, user.id, dialect_name,
    )

    if baseline_at is None:
        # New user with no last_chat_visit_at — show 0 PB mentions/alerts
        # AND 0 team-chat mentions until their first chat visit. Matches
        # /team/chat/unread-count's first-visit behavior; prevents the
        # per-user model switch from retroactively flooding badges.
        pb_mentions_stmt = select(func.count(PatientMessage.id)).where(False)
        tc_mentions_stmt = select(func.count(TeamChatMessage.id)).where(False)
        alerts_stmt = select(func.count(PatientMessage.id)).where(False)
    else:
        pb_mentions_stmt = (
            select(func.count(PatientMessage.id))
            .where(PatientMessage.timestamp >= baseline_at)
            .where(~pb_already_read)
            .where(_patient_board_mention_predicate(user, dialect_name))
        )
        tc_mentions_stmt = (
            select(func.count(TeamChatMessage.id))
            .where(TeamChatMessage.timestamp > baseline_at)
            .where(TeamChatMessage.deleted_at.is_(None))
            .where(~tc_already_read)
            .where(_team_chat_mention_predicate(user, dialect_name))
        )
        alerts_stmt = (
            select(func.count(PatientMessage.id))
            .where(PatientMessage.timestamp >= baseline_at)
            .where(~pb_already_read)
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

    # Per-user read state (TC-W3-T1 + TC-FU-T1) — same model as /summary.
    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(db_user.last_chat_visit_at if db_user is not None else None)
    baseline_at = max(cutoff, last_visit) if last_visit is not None else None

    # ── Patient board mentions ─────────────────────────────────────────
    # Recent feed retains the 168h cutoff (not the per-user baseline) so
    # a user who hasn't visited chat in a while can still scroll back
    # and see what they missed. ``isRead`` is computed per-user inline
    # rather than from the legacy global ``is_read`` flag.
    pb_stmt = (
        select(PatientMessage, Patient.bed_number, Patient.name)
        .join(Patient, Patient.id == PatientMessage.patient_id, isouter=True)
        .where(PatientMessage.timestamp >= cutoff)
        .where(_patient_board_mention_predicate(user, dialect_name))
        .order_by(PatientMessage.timestamp.desc())
        .limit(limit)
    )
    pb_rows = (await db.execute(pb_stmt)).all()

    # Compute per-user read state inline since SQL predicate is dialect-aware
    # and we already have the rows loaded.
    def _pb_is_read_by_me(m: PatientMessage) -> bool:
        for entry in (m.read_by or []):
            if isinstance(entry, dict) and entry.get("userId") == user.id:
                return True
        return False

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
            "isRead": _pb_is_read_by_me(m),
            "deepLink": f"/patient/{m.patient_id}?tab=messages",
        }
        for (m, bed, pname) in pb_rows
    ]

    # ── Team chat mentions ─────────────────────────────────────────────
    if baseline_at is None:
        tc_msgs = []
    else:
        tc_stmt = (
            select(TeamChatMessage)
            .where(TeamChatMessage.timestamp > baseline_at)
            .where(TeamChatMessage.deleted_at.is_(None))
            .where(_team_chat_mention_predicate(user, dialect_name))
            .order_by(TeamChatMessage.timestamp.desc())
            .limit(limit)
        )
        tc_msgs = (await db.execute(tc_stmt)).scalars().all()

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
    inside the look-back window. Appends a per-user read receipt to
    ``read_by`` so other users' badges are unaffected (TC-FU-T1 / TC-W3-T1).
    The legacy ``is_read=True`` flag is kept in sync for backward compat with
    other surfaces that still surface it (e.g. ``msg_to_dict``), but no
    predicate consults it for unread calculation any more.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_WINDOW_HOURS)
    now = datetime.now(timezone.utc)
    dialect_name = db.bind.dialect.name

    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(db_user.last_chat_visit_at if db_user is not None else None)
    baseline_at = max(cutoff, last_visit) if last_visit is not None else None
    tc_already_read = array_contains_user_receipt(
        TeamChatMessage.read_by, user.id, dialect_name,
    )
    pb_already_read = array_contains_user_receipt(
        PatientMessage.read_by, user.id, dialect_name,
    )

    if baseline_at is None:
        # Pre-first-visit users have empty badges to begin with —
        # nothing to mark.
        pb_msgs = []
        tc_msgs = []
    else:
        pb_stmt = select(PatientMessage).where(
            PatientMessage.timestamp >= baseline_at,
            ~pb_already_read,
            or_(
                _patient_board_mention_predicate(user, dialect_name),
                PatientMessage.message_type.in_(_ALERT_TYPES),
            ),
        )
        pb_msgs = (await db.execute(pb_stmt)).scalars().all()

        tc_stmt = select(TeamChatMessage).where(
            TeamChatMessage.timestamp > baseline_at,
            TeamChatMessage.deleted_at.is_(None),
            ~tc_already_read,
            _team_chat_mention_predicate(user, dialect_name),
        )
        tc_msgs = (await db.execute(tc_stmt)).scalars().all()

    for m in pb_msgs:
        # is_read kept for backward compat; per-user state is read_by.
        m.is_read = True
        m.read_by = append_read_receipt(m.read_by, user.id, user.name, when=now)

    for m in tc_msgs:
        m.is_read = True
        m.read_by = append_read_receipt(m.read_by, user.id, user.name, when=now)

    await db.commit()

    return success_response(data={
        "markedPatientBoard": len(pb_msgs),
        "markedTeamChat": len(tc_msgs),
        "total": len(pb_msgs) + len(tc_msgs),
        "generatedAt": now.isoformat(),
    })
