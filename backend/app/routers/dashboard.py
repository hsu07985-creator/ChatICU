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

    # Intubated count
    intubated_result = await db.execute(
        select(func.count(Patient.id))
        .where(Patient.archived == False)
        .where(Patient.intubated == True)
    )
    intubated_count = intubated_result.scalar() or 0

    # Active medications by SAN category
    san_counts = {"S": 0, "A": 0, "N": 0}
    for cat in ["S", "A", "N"]:
        cat_result = await db.execute(
            select(func.count(Medication.id))
            .where(Medication.status == "active")
            .where(Medication.san_category == cat)
        )
        san_counts[cat] = cat_result.scalar() or 0

    # Unread messages
    unread_result = await db.execute(
        select(func.count(PatientMessage.id))
        .where(PatientMessage.is_read == False)
    )
    unread_messages = unread_result.scalar() or 0

    # Alerts count
    alert_patients = await db.execute(
        select(Patient)
        .where(Patient.archived == False)
        .where(Patient.alerts != None)
    )
    alert_count = sum(
        len(p.alerts) for p in alert_patients.scalars() if p.alerts
    )

    return success_response(data={
        "totalPatients": total_patients,
        "intubatedCount": intubated_count,
        "sanUsage": san_counts,
        "alertCount": alert_count,
        "unreadMessages": unread_messages,
        "activeMedications": {
            "sedation": san_counts["S"],
            "analgesia": san_counts["A"],
            "neuromuscularBlocker": san_counts["N"],
        },
    })
