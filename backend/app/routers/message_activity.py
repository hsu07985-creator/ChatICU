"""Aggregated patient message activity for the team chat hub."""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.user import User
from app.utils.response import success_response

router = APIRouter(prefix="/patients/messages", tags=["message-activity"])


@router.get("/tagged-activity")
async def get_tagged_activity(
    hours_back: int = Query(24, ge=1, le=168),
    tag: Optional[str] = Query(None, max_length=30),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return per-patient summary of tagged messages within the given time window."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_back)

    # Step 1: aggregate per patient_id
    agg_stmt = (
        select(
            PatientMessage.patient_id,
            func.count(PatientMessage.id).label("tagged_count"),
            func.sum(
                case((PatientMessage.is_read == False, 1), else_=0)  # noqa: E712
            ).label("unread_count"),
            func.max(PatientMessage.timestamp).label("latest_timestamp"),
        )
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.tags.isnot(None))
        .where(cast(PatientMessage.tags, String) != '[]')
        .group_by(PatientMessage.patient_id)
        .order_by(func.max(PatientMessage.timestamp).desc())
        .limit(limit)
    )
    agg_result = await db.execute(agg_stmt)
    rows = agg_result.all()

    if not rows:
        return success_response(data={
            "activity": [],
            "total": 0,
            "hoursBack": hours_back,
        })

    patient_ids: List[str] = [r.patient_id for r in rows]

    # Step 2: batch-fetch patient info
    patient_stmt = select(Patient).where(Patient.id.in_(patient_ids))
    patient_result = await db.execute(patient_stmt)
    patient_map: Dict[str, Patient] = {
        p.id: p for p in patient_result.scalars().all()
    }

    # Step 3: for each patient, fetch recent tagged messages for preview + tags
    activity: List[dict] = []
    for row in rows:
        pid = row.patient_id

        detail_stmt = (
            select(PatientMessage)
            .where(PatientMessage.patient_id == pid)
            .where(PatientMessage.timestamp >= cutoff)
            .where(PatientMessage.tags.isnot(None))
            .where(cast(PatientMessage.tags, String) != '[]')
            .order_by(PatientMessage.timestamp.desc())
        )
        detail_result = await db.execute(detail_stmt)
        tagged_msgs = detail_result.scalars().all()

        # Collect unique tags
        all_tags: Set[str] = set()
        for m in tagged_msgs:
            for t in (m.tags or []):
                all_tags.add(t)

        # Apply tag filter if specified
        if tag and tag not in all_tags:
            continue

        latest = tagged_msgs[0] if tagged_msgs else None
        pat = patient_map.get(pid)

        content_preview = ""
        if latest:
            content_preview = latest.content[:100] if latest.content else ""

        activity.append({
            "patientId": pid,
            "patientName": pat.name if pat else pid,
            "bedNumber": pat.bed_number if pat else "",
            "taggedCount": int(row.tagged_count),
            "unreadCount": int(row.unread_count),
            "latestTimestamp": row.latest_timestamp.isoformat() if row.latest_timestamp else None,
            "latestContent": content_preview,
            "tags": sorted(all_tags),
            "latestAuthorName": latest.author_name if latest else "",
            "latestAuthorRole": latest.author_role if latest else "",
        })

    return success_response(data={
        "activity": activity,
        "total": len(activity),
        "hoursBack": hours_back,
    })


@router.get("/my-mentions")
async def get_my_mentions(
    hours_back: int = Query(168, ge=1, le=720),
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return messages where the current user's role is mentioned, grouped by patient."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    role = user.role

    # Find messages that mention this user's role (JSONB contains)
    base_stmt = (
        select(PatientMessage)
        .where(PatientMessage.timestamp >= cutoff)
        .where(PatientMessage.mentioned_roles.isnot(None))
        .where(cast(PatientMessage.mentioned_roles, String).contains(f'"{role}"'))
    )
    if unread_only:
        base_stmt = base_stmt.where(PatientMessage.is_read == False)  # noqa: E712

    base_stmt = base_stmt.order_by(PatientMessage.timestamp.desc()).limit(limit)
    result = await db.execute(base_stmt)
    all_msgs = result.scalars().all()

    if not all_msgs:
        return success_response(data={"groups": [], "totalMentions": 0})

    # Group by patient_id
    grouped: Dict[str, List[PatientMessage]] = {}
    for m in all_msgs:
        grouped.setdefault(m.patient_id, []).append(m)

    # Fetch patient info
    patient_ids = list(grouped.keys())
    pat_result = await db.execute(select(Patient).where(Patient.id.in_(patient_ids)))
    pat_map: Dict[str, Patient] = {p.id: p for p in pat_result.scalars().all()}

    groups: List[dict] = []
    for pid, msgs in grouped.items():
        pat = pat_map.get(pid)
        unread = sum(1 for m in msgs if not m.is_read)
        groups.append({
            "patientId": pid,
            "patientName": pat.name if pat else pid,
            "bedNumber": pat.bed_number if pat else "",
            "unreadCount": unread,
            "totalCount": len(msgs),
            "messages": [
                {
                    "id": m.id,
                    "content": m.content[:200] if m.content else "",
                    "authorName": m.author_name,
                    "authorRole": m.author_role,
                    "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                    "isRead": m.is_read,
                    "mentionedRoles": m.mentioned_roles or [],
                    "tags": m.tags or [],
                }
                for m in msgs
            ],
        })

    # Sort groups: unread first, then by latest message time
    groups.sort(key=lambda g: (-g["unreadCount"], g["messages"][0]["timestamp"] or ""), reverse=False)
    # Actually sort by unread desc, then latest timestamp desc
    groups.sort(key=lambda g: (-g["unreadCount"], -(datetime.fromisoformat(g["messages"][0]["timestamp"]).timestamp() if g["messages"][0]["timestamp"] else 0)))

    total_mentions = sum(g["totalCount"] for g in groups)
    return success_response(data={"groups": groups, "totalMentions": total_mentions})
