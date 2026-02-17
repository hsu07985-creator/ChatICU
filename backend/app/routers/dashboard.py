from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
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

    # Patients with at least one active SAN medication
    san_patient_result = await db.execute(
        select(func.count(func.distinct(Medication.patient_id)))
        .where(Medication.status == "active")
        .where(Medication.san_category.in_(["S", "A", "N"]))
    )
    with_san = san_patient_result.scalar() or 0

    # Active medications by SAN category
    san_counts = {"S": 0, "A": 0, "N": 0}
    for cat in ["S", "A", "N"]:
        cat_result = await db.execute(
            select(func.count(Medication.id))
            .where(Medication.status == "active")
            .where(Medication.san_category == cat)
        )
        san_counts[cat] = cat_result.scalar() or 0
    total_active_meds = san_counts["S"] + san_counts["A"] + san_counts["N"]

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

    # Alerts count
    alert_patients = await db.execute(
        select(Patient)
        .where(Patient.archived == False)
        .where(Patient.alerts != None)
    )
    alert_count = sum(
        len(p.alerts) for p in alert_patients.scalars() if p.alerts
    )

    # Response matches frontend DashboardStats interface (F09)
    return success_response(data={
        "patients": {
            "total": total_patients,
            "intubated": intubated_count,
            "intubatedBeds": intubated_beds,
            "withSAN": with_san,
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
