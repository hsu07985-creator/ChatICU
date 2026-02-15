"""
Seed script to populate the database with mock data from datamock/ JSON files.
Run: python -m seeds.seed_data
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add parent dir to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import Base, async_session, engine
from app.models import *  # noqa: F401, F403
from app.utils.security import hash_password

DATAMOCK_DIR = Path(__file__).parent.parent.parent / "datamock"


from typing import Optional, Union


def load_json(filename: str) -> Union[list, dict]:
    filepath = DATAMOCK_DIR / filename
    if not filepath.exists():
        print(f"  Warning: {filepath} not found, skipping")
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    for fmt in ["%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"]:
        try:
            return datetime.strptime(dt_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_date(date_str: Optional[str]):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None


# Seed password MUST be set via environment variable — no plaintext fallback
SEED_DEFAULT_PASSWORD = os.environ.get("SEED_DEFAULT_PASSWORD", "")
if not SEED_DEFAULT_PASSWORD:
    print("  ERROR: SEED_DEFAULT_PASSWORD environment variable is required.")
    print("  Set it before running: export SEED_DEFAULT_PASSWORD='YourSecurePassword!'")
    sys.exit(1)


async def seed_users(session: AsyncSession):
    print("Seeding users...")
    raw = load_json("users.json")
    # users.json wraps the array: {"users": [...]}
    users_data = raw.get("users", raw) if isinstance(raw, dict) else raw
    if not users_data:
        return

    now = datetime.now(timezone.utc)
    for u in users_data:
        user = User(
            id=u["id"],
            name=u["name"],
            username=u["username"],
            password_hash=hash_password(SEED_DEFAULT_PASSWORD),
            email=u.get("email", f"{u['username']}@hospital.com"),
            role=u["role"],
            unit=u.get("unit", "加護病房一"),
            active=u.get("active", True),
            last_login=parse_datetime(u.get("lastLogin")),
            password_changed_at=now,
            created_at=parse_datetime(u.get("createdAt")) or now,
        )
        session.add(user)
    await session.flush()
    print(f"  Added {len(users_data)} users")


async def seed_patients(session: AsyncSession):
    print("Seeding patients...")
    patients_data = load_json("patients.json")
    if not patients_data:
        return

    for p in patients_data:
        patient = Patient(
            id=p["id"],
            name=p["name"],
            bed_number=p.get("bedNumber", ""),
            medical_record_number=p.get("medicalRecordNumber", ""),
            age=p.get("age", 0),
            gender=p.get("gender", ""),
            height=p.get("height"),
            weight=p.get("weight"),
            bmi=p.get("bmi"),
            diagnosis=p.get("diagnosis", ""),
            symptoms=p.get("symptoms"),
            intubated=p.get("intubated", False),
            critical_status=p.get("criticalStatus"),
            sedation=p.get("sedation"),
            analgesia=p.get("analgesia"),
            nmb=p.get("nmb"),
            admission_date=parse_date(p.get("admissionDate")),
            icu_admission_date=parse_date(p.get("icuAdmissionDate")),
            ventilator_days=p.get("ventilatorDays", 0),
            attending_physician=p.get("attendingPhysician"),
            department=p.get("department"),
            alerts=p.get("alerts"),
            consent_status=p.get("consentStatus"),
            allergies=p.get("allergies"),
            blood_type=p.get("bloodType"),
            code_status=p.get("codeStatus"),
            has_dnr=p.get("hasDNR", False),
            is_isolated=p.get("isIsolated", False),
            last_update=parse_datetime(p.get("lastUpdate")) or datetime.now(timezone.utc),
        )
        session.add(patient)
    await session.flush()
    print(f"  Added {len(patients_data)} patients")


async def seed_medications(session: AsyncSession):
    print("Seeding medications...")
    meds_data = load_json("medications.json")
    if not meds_data:
        return

    for m in meds_data:
        med = Medication(
            id=m["id"],
            patient_id=m["patientId"],
            name=m["name"],
            generic_name=m.get("genericName"),
            category=m.get("category"),
            san_category=m.get("sanCategory"),
            dose=m.get("dose"),
            unit=m.get("unit"),
            frequency=m.get("frequency"),
            route=m.get("route"),
            prn=m.get("prn", False),
            indication=m.get("indication"),
            start_date=parse_date(m.get("startDate")),
            end_date=parse_date(m.get("endDate")),
            status=m.get("status", "active"),
            prescribed_by=m.get("prescribedBy"),
            warnings=m.get("warnings"),
        )
        session.add(med)
    await session.flush()
    print(f"  Added {len(meds_data)} medications")


async def seed_lab_data(session: AsyncSession):
    print("Seeding lab data...")
    lab_data = load_json("labData.json")
    if not lab_data:
        return

    for l in lab_data:
        lab = LabData(
            id=l["id"],
            patient_id=l["patientId"],
            timestamp=parse_datetime(l.get("timestamp")) or datetime.now(timezone.utc),
            biochemistry=l.get("biochemistry"),
            hematology=l.get("hematology"),
            blood_gas=l.get("bloodGas"),
            inflammatory=l.get("inflammatory"),
            coagulation=l.get("coagulation"),
        )
        session.add(lab)
    await session.flush()
    print(f"  Added {len(lab_data)} lab data records")


async def seed_messages(session: AsyncSession):
    print("Seeding messages...")
    messages_data = load_json("messages.json")
    if not messages_data:
        return

    patient_messages = []
    team_messages = []

    for m in messages_data:
        if m["id"].startswith("pmsg"):
            patient_messages.append(m)
        elif m["id"].startswith("tchat"):
            team_messages.append(m)

    for m in patient_messages:
        msg = PatientMessage(
            id=m["id"],
            patient_id=m["patientId"],
            author_id=m["authorId"],
            author_name=m["authorName"],
            author_role=m["authorRole"],
            message_type=m.get("messageType", "general"),
            content=m["content"],
            timestamp=parse_datetime(m.get("timestamp")) or datetime.now(timezone.utc),
            is_read=m.get("isRead", False),
            linked_medication=m.get("linkedMedication"),
            advice_code=m.get("adviceCode"),
            read_by=m.get("readBy"),
        )
        session.add(msg)

    for m in team_messages:
        msg = TeamChatMessage(
            id=m["id"],
            user_id=m["userId"],
            user_name=m["userName"],
            user_role=m["userRole"],
            content=m["content"],
            timestamp=parse_datetime(m.get("timestamp")) or datetime.now(timezone.utc),
            pinned=m.get("pinned", False),
            pinned_by=m.get("pinnedBy"),
            pinned_at=parse_datetime(m.get("pinnedAt")),
        )
        session.add(msg)

    await session.flush()
    print(f"  Added {len(patient_messages)} patient messages, {len(team_messages)} team messages")


async def seed_drug_interactions(session: AsyncSession):
    print("Seeding drug interactions...")
    data = load_json("drugInteractions.json")
    if not data:
        return

    interactions = data if isinstance(data, list) else data.get("interactions", [])
    compatibilities = [] if isinstance(data, list) else data.get("compatibilities", [])

    for d in interactions:
        interaction = DrugInteraction(
            id=d["id"],
            drug1=d["drug1"],
            drug2=d["drug2"],
            severity=d.get("severity", "moderate"),
            mechanism=d.get("mechanism"),
            clinical_effect=d.get("clinicalEffect"),
            management=d.get("management"),
            references=d.get("references"),
        )
        session.add(interaction)

    for c in compatibilities:
        compat = IVCompatibility(
            id=c["id"],
            drug1=c["drug1"],
            drug2=c["drug2"],
            solution=c.get("solution"),
            compatible=c.get("compatible", True),
            time_stability=c.get("timeStability"),
            notes=c.get("notes"),
            references=c.get("references"),
        )
        session.add(compat)

    await session.flush()
    print(f"  Added {len(interactions)} drug interactions, {len(compatibilities)} IV compatibilities")


async def main():
    print("=" * 50)
    print("ChatICU Database Seed Script")
    print("=" * 50)
    print(f"Database: {settings.DATABASE_URL}")
    print(f"Mock data dir: {DATAMOCK_DIR}")
    print()

    # Create all tables
    print("Creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  Tables created successfully")
    print()

    # Seed data
    async with async_session() as session:
        try:
            await seed_users(session)
            await seed_patients(session)
            await seed_medications(session)
            await seed_lab_data(session)
            await seed_messages(session)
            await seed_drug_interactions(session)
            await session.commit()
            print()
            print("Seed completed successfully!")
        except Exception as e:
            await session.rollback()
            print(f"\nError during seeding: {e}")
            raise
        finally:
            await session.close()

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
