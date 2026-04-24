"""Lightweight notification summary for top-right bell polling.

Two endpoints:
- GET /notifications/summary — counts only (60s poll-friendly)
- GET /notifications/recent  — merged feed (patient board + team chat) for the dropdown
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.chat_message import TeamChatMessage
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.user import User
from app.utils.response import success_response

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Look-back window for counts (matches team-chat mentions default of 168h)
_WINDOW_HOURS = 168

# Message types that count as "alert" notifications
_ALERT_TYPES = ("alert", "urgent")


def _team_chat_mention_predicate(user: User):
    """Match team-chat rows where the current user is @-ed by role OR by user_id."""
    return or_(
        cast(TeamChatMessage.mentioned_roles, String).contains(f'"{user.role}"'),
        cast(TeamChatMessage.mentioned_user_ids, String).contains(f'"{user.id}"'),
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
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_WINDOW_HOURS)

    pb_mentions_stmt = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.is_read == False)  # noqa: E712
        .where(PatientMessage.mentioned_roles.isnot(None))
        .where(cast(PatientMessage.mentioned_roles, String).contains(f'"{user.role}"'))
    )
    tc_mentions_stmt = (
        select(func.count(TeamChatMessage.id))
        .where(TeamChatMessage.timestamp >= cutoff)
        .where(TeamChatMessage.is_read == False)  # noqa: E712
        .where(_team_chat_mention_predicate(user))
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

    # ── Patient board mentions ─────────────────────────────────────────
    pb_stmt = (
        select(PatientMessage, Patient.bed_number, Patient.name)
        .join(Patient, Patient.id == PatientMessage.patient_id, isouter=True)
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.mentioned_roles.isnot(None))
        .where(cast(PatientMessage.mentioned_roles, String).contains(f'"{user.role}"'))
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
    tc_stmt = (
        select(TeamChatMessage)
        .where(TeamChatMessage.timestamp >= cutoff)
        .where(_team_chat_mention_predicate(user))
        .order_by(TeamChatMessage.timestamp.desc())
        .limit(limit)
    )
    tc_msgs = (await db.execute(tc_stmt)).scalars().all()

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
            "isRead": bool(m.is_read),
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
