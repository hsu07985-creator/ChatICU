"""Lightweight notification summary for sidebar bell polling.

Returns only counts (no message content) so it can be polled every 60s cheaply.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.message import PatientMessage
from app.models.user import User
from app.utils.response import success_response

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Look-back window for counts (matches team-chat mentions default of 168h)
_WINDOW_HOURS = 168

# Message types that count as "alert" notifications
_ALERT_TYPES = ("alert", "urgent")


@router.get("/summary")
async def get_notification_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return unread notification counts for the current user.

    - mentions: unread messages whose `mentioned_roles` contains the user's role
    - alerts: unread messages whose `message_type` is 'alert' or 'urgent'
    - total: mentions + alerts (not deduplicated — a message can count in both)
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_WINDOW_HOURS)

    mentions_stmt = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.is_read == False)  # noqa: E712
        .where(PatientMessage.mentioned_roles.isnot(None))
        .where(cast(PatientMessage.mentioned_roles, String).contains(f'"{user.role}"'))
    )
    alerts_stmt = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.is_read == False)  # noqa: E712
        .where(PatientMessage.message_type.in_(_ALERT_TYPES))
    )

    mentions_count = (await db.execute(mentions_stmt)).scalar_one() or 0
    alerts_count = (await db.execute(alerts_stmt)).scalar_one() or 0

    return success_response(data={
        "mentions": int(mentions_count),
        "alerts": int(alerts_count),
        "total": int(mentions_count) + int(alerts_count),
        "windowHours": _WINDOW_HOURS,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    })
