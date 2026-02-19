"""
Seed script to populate the database with mock data from datamock/ JSON files.
Run: python -m seeds.seed_data
"""
import asyncio
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
from seeds.datamock_source import get_datamock_dir, load_json, unwrap_list
from seeds.validate_datamock import validate_datamock


from typing import Optional


def parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    for fmt in ["%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"]:
        try:
            return datetime.strptime(dt_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        pass
    return None


def parse_date(date_str: Optional[str]):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None


SEED_PASSWORD_STRATEGY = os.environ.get("SEED_PASSWORD_STRATEGY", "default").strip().lower()
SEED_DEFAULT_PASSWORD = os.environ.get("SEED_DEFAULT_PASSWORD", "")

if SEED_PASSWORD_STRATEGY not in ("default", "username"):
    print("  ERROR: invalid SEED_PASSWORD_STRATEGY.")
    print("  Allowed: default | username")
    sys.exit(1)

if SEED_PASSWORD_STRATEGY == "default" and not SEED_DEFAULT_PASSWORD:
    # Seed password MUST be set via environment variable — no plaintext fallback
    print("  ERROR: SEED_DEFAULT_PASSWORD environment variable is required.")
    print("  Set it before running: export SEED_DEFAULT_PASSWORD='YourSecurePassword!'")
    print("  Or use username-based dev passwords: export SEED_PASSWORD_STRATEGY='username'")
    sys.exit(1)


async def seed_users(session: AsyncSession):
    print("Seeding users...")
    users_data = unwrap_list(load_json("users.json"), "users")
    if not users_data:
        return

    now = datetime.now(timezone.utc)
    for u in users_data:
        if SEED_PASSWORD_STRATEGY == "username":
            raw_password = u["username"]
        else:
            raw_password = SEED_DEFAULT_PASSWORD
        user = User(
            id=u["id"],
            name=u["name"],
            username=u["username"],
            password_hash=hash_password(raw_password),
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
    patients_data = unwrap_list(load_json("patients.json"), "patients")
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
            unit=p.get("unit") or "加護病房一",
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
    meds_data = unwrap_list(load_json("medications.json"), "medications")
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


async def seed_medication_administrations(session: AsyncSession):
    print("Seeding medication administrations...")
    administrations = unwrap_list(
        load_json("medicationAdministrations.json"),
        "medicationAdministrations",
    )
    if not administrations:
        return

    for row in administrations:
        administration = MedicationAdministration(
            id=row["id"],
            medication_id=row["medicationId"],
            patient_id=row["patientId"],
            scheduled_time=parse_datetime(row.get("scheduledTime")) or datetime.now(timezone.utc),
            administered_time=parse_datetime(row.get("administeredTime")),
            status=row.get("status", "scheduled"),
            dose=row.get("dose"),
            route=row.get("route"),
            administered_by=row.get("administeredBy"),
            notes=row.get("notes"),
        )
        session.add(administration)

    await session.flush()
    print(f"  Added {len(administrations)} medication administrations")


async def seed_lab_data(session: AsyncSession):
    print("Seeding lab data...")
    lab_data = unwrap_list(load_json("labData.json"), "labData")
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
    raw = load_json("messages.json")
    patient_messages = []
    team_messages = []

    if isinstance(raw, dict):
        patient_messages = unwrap_list(raw, "patientMessages")
        team_messages = unwrap_list(raw, "teamChatMessages")
    else:
        messages_data = raw if isinstance(raw, list) else []
        for m in messages_data:
            if m["id"].startswith("pmsg"):
                patient_messages.append(m)
            elif m["id"].startswith("tchat"):
                team_messages.append(m)

    if not patient_messages and not team_messages:
        return

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



async def seed_vital_signs(session: AsyncSession):
    print("Seeding vital signs...")
    raw = load_json("vitalSigns.json", required=False)
    if not raw:
        print("  vitalSigns.json not found — skipping")
        return
    records = unwrap_list(raw, "vitalSigns")
    if not records:
        return

    for v in records:
        vs = VitalSign(
            id=v["id"],
            patient_id=v["patientId"],
            timestamp=parse_datetime(v.get("timestamp")) or datetime.now(timezone.utc),
            heart_rate=v.get("heartRate"),
            systolic_bp=v.get("systolicBP"),
            diastolic_bp=v.get("diastolicBP"),
            mean_bp=v.get("meanBP"),
            respiratory_rate=v.get("respiratoryRate"),
            spo2=v.get("spo2"),
            temperature=v.get("temperature"),
        )
        session.add(vs)
    await session.flush()
    print(f"  Added {len(records)} vital sign records")


async def seed_ventilator_settings(session: AsyncSession):
    print("Seeding ventilator settings...")
    raw = load_json("ventilatorSettings.json", required=False)
    if not raw:
        print("  ventilatorSettings.json not found — skipping")
        return
    records = unwrap_list(raw, "ventilatorSettings")
    if not records:
        return

    for v in records:
        vs = VentilatorSetting(
            id=v["id"],
            patient_id=v["patientId"],
            timestamp=parse_datetime(v.get("timestamp")) or datetime.now(timezone.utc),
            mode=v.get("mode"),
            fio2=v.get("fio2"),
            peep=v.get("peep"),
            tidal_volume=v.get("tidalVolume"),
            respiratory_rate=v.get("respiratoryRate"),
            inspiratory_pressure=v.get("inspiratoryPressure"),
            pressure_support=v.get("pressureSupport"),
            ie_ratio=v.get("ieRatio"),
            pip=v.get("pip"),
            plateau=v.get("plateau"),
            compliance=v.get("compliance"),
            resistance=v.get("resistance"),
        )
        session.add(vs)
    await session.flush()
    print(f"  Added {len(records)} ventilator setting records")

async def seed_drug_interactions(session: AsyncSession):
    print("Seeding drug interactions...")
    raw = load_json("drugInteractions.json")
    if not raw:
        return

    if isinstance(raw, list):
        interactions = raw
        compatibilities = []
    else:
        # Supports both legacy keys and current datamock keys.
        interactions = (
            unwrap_list(raw, "drugInteractions")
            or unwrap_list(raw, "interactions")
        )
        compatibilities = (
            unwrap_list(raw, "ivCompatibility")
            or unwrap_list(raw, "compatibilities")
        )

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
    datamock_dir = get_datamock_dir()
    print(f"Database: {settings.DATABASE_URL}")
    print(f"Mock data dir: {datamock_dir}")
    print()

    # Validate JSON structure before seeding so failures are explicit and early.
    validation_report = validate_datamock(raise_on_error=True)
    print(f"Datamock validation summary: {validation_report}")
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
            await seed_medication_administrations(session)
            await seed_lab_data(session)
            await seed_vital_signs(session)
            await seed_ventilator_settings(session)
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
