from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.medication import Medication
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.user import User
from app.utils.jsonb_compat import array_contains_user_receipt, to_utc_aware
from app.utils.response import success_response

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_result = await db.execute(
        select(Patient.bed_number, Patient.intubated, Patient.alerts)
        .where(Patient.archived == False)
    )
    patient_rows = patient_result.all()
    total_patients = len(patient_rows)
    intubated_beds = [row.bed_number for row in patient_rows if row.intubated]
    intubated_count = len(intubated_beds)
    alert_count = sum(len(row.alerts or []) for row in patient_rows)

    san_result = await db.execute(
        select(
            Medication.san_category,
            Medication.patient_id,
            func.count(Medication.id),
        )
        .join(Patient, Patient.id == Medication.patient_id)
        .where(Patient.archived == False)
        .where(Medication.status == "active")
        .where(Medication.san_category.in_(["S", "A", "N"]))
        .group_by(Medication.san_category, Medication.patient_id)
    )
    san_counts = {"S": 0, "A": 0, "N": 0}
    san_patient_ids = {"S": set(), "A": set(), "N": set()}
    for category, patient_id, medication_count in san_result:
        san_counts[category] += medication_count
        san_patient_ids[category].add(patient_id)
    san_patient_counts = {
        "sedation": len(san_patient_ids["S"]),
        "analgesia": len(san_patient_ids["A"]),
        "nmb": len(san_patient_ids["N"]),
    }
    total_active_meds = san_counts["S"] + san_counts["A"] + san_counts["N"]
    with_san = len(set().union(*san_patient_ids.values()))

    # Per-user unread messages (TC-FU-T1) — was global ``is_read==False``
    # which let any reader silently zero everyone else's dashboard count.
    cutoff = datetime.now(timezone.utc) - timedelta(hours=168)
    db_user = await db.get(User, user.id)
    last_visit = to_utc_aware(
        db_user.last_chat_visit_at if db_user is not None else None
    )
    baseline_at = max(cutoff, last_visit) if last_visit is not None else None
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    dialect_name = db.bind.dialect.name if db.bind is not None else "sqlite"
    already_read = array_contains_user_receipt(PatientMessage.read_by, user.id, dialect_name)
    unread_count = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= baseline_at)
        .where(~already_read)
        .scalar_subquery()
        if baseline_at is not None
        else literal(0)
    )
    today_count = (
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= today_start)
        .scalar_subquery()
    )
    message_result = await db.execute(
        select(today_count, unread_count)
    )
    today_messages, unread_messages = message_result.one()

    # Response matches frontend DashboardStats interface (F09)
    return success_response(data={
        "patients": {
            "total": total_patients,
            "intubated": intubated_count,
            "intubatedBeds": intubated_beds,
            "withSAN": with_san,
            "sanByCategory": san_patient_counts,
        },
        "alerts": {
            "total": alert_count,
        },
        "medications": {
            "active": total_active_meds,
            "sedation": san_counts["S"],
            "analgesia": san_counts["A"],
            "nmb": san_counts["N"],
        },
        "messages": {
            "today": today_messages,
            "unread": unread_messages,
        },
        "timestamp": now.isoformat(),
    })
