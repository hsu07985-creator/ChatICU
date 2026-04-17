from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import JSON, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.medication import Medication
from app.models.message import PatientMessage
from app.models.patient import Patient
from app.models.user import User
from app.utils.response import success_response

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Total patients
    total_result = await db.execute(
        select(func.count(Patient.id)).where(Patient.archived == False)
    )
    total_patients = total_result.scalar() or 0

    # Intubated patients — count + bed numbers
    intubated_rows = await db.execute(
        select(Patient.bed_number)
        .where(Patient.archived == False)
        .where(Patient.intubated == True)
    )
    intubated_beds = [row[0] for row in intubated_rows.all()]
    intubated_count = len(intubated_beds)

    # SAN stats in 3 queries (was 7 separate queries)
    # All SAN queries join Patient and filter archived==False so that archiving
    # (soft-delete) a patient removes them from SAN stats immediately — archiving
    # leaves Medication rows with status='active', so without this join the
    # SAN counts keep including archived patients and can exceed total patients.
    # Query 1: distinct patients per SAN category (GROUP BY)
    san_patient_rows = await db.execute(
        select(Medication.san_category, func.count(func.distinct(Medication.patient_id)))
        .join(Patient, Patient.id == Medication.patient_id)
        .where(Patient.archived == False)
        .where(Medication.status == "active")
        .where(Medication.san_category.in_(["S", "A", "N"]))
        .group_by(Medication.san_category)
    )
    san_patient_map = dict(san_patient_rows.all())
    san_patient_counts = {
        "sedation": san_patient_map.get("S", 0),
        "analgesia": san_patient_map.get("A", 0),
        "nmb": san_patient_map.get("N", 0),
    }

    # Query 2: medication counts per SAN category (GROUP BY)
    san_med_rows = await db.execute(
        select(Medication.san_category, func.count(Medication.id))
        .join(Patient, Patient.id == Medication.patient_id)
        .where(Patient.archived == False)
        .where(Medication.status == "active")
        .where(Medication.san_category.in_(["S", "A", "N"]))
        .group_by(Medication.san_category)
    )
    san_med_map = dict(san_med_rows.all())
    san_counts = {
        "S": san_med_map.get("S", 0),
        "A": san_med_map.get("A", 0),
        "N": san_med_map.get("N", 0),
    }
    total_active_meds = san_counts["S"] + san_counts["A"] + san_counts["N"]

    # Query 3: distinct patients with any SAN (cross-category dedup)
    san_distinct_result = await db.execute(
        select(func.count(func.distinct(Medication.patient_id)))
        .join(Patient, Patient.id == Medication.patient_id)
        .where(Patient.archived == False)
        .where(Medication.status == "active")
        .where(Medication.san_category.in_(["S", "A", "N"]))
    )
    with_san = san_distinct_result.scalar() or 0

    # Unread messages
    unread_result = await db.execute(
        select(func.count(PatientMessage.id))
        .where(PatientMessage.is_read == False)
    )
    unread_messages = unread_result.scalar() or 0

    # Today's messages
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_result = await db.execute(
        select(func.count(PatientMessage.id))
        .where(PatientMessage.timestamp >= today_start)
    )
    today_messages = today_result.scalar() or 0

    # Alerts count — aggregate in DB instead of loading full Patient objects.
    # Patient.alerts is JSONB in PostgreSQL; json_array_length(jsonb) does not
    # exist in Postgres, so we must cast jsonb→json. SQLite has no distinct JSON
    # type and stores JSON as TEXT — wrapping with CAST AS JSON silently breaks
    # json_array_length there (returns 0). So pick the expression by dialect.
    dialect_name = db.bind.dialect.name if db.bind is not None else "sqlite"
    if dialect_name == "postgresql":
        alerts_arr = cast(Patient.alerts, JSON)
    else:
        alerts_arr = Patient.alerts
    alert_result = await db.execute(
        select(func.coalesce(func.sum(func.json_array_length(alerts_arr)), 0))
        .where(Patient.archived == False)
        .where(Patient.alerts != None)
    )
    alert_count = alert_result.scalar() or 0

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
