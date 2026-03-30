"""Seed culture_results for demo patients.

Usage:
    cd backend && python3 -m seeds.seed_culture_results
"""
import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

CULTURES = [
    # pat_001 張三 — 重度肺炎: sputum cultures with S. maltophilia
    {
        "patient_id": "pat_001",
        "sheet_number": "M11411L014001",
        "specimen": "Sputum",
        "specimen_code": "SP01",
        "department": "加護病房一",
        "collected_at": "2025-11-10T08:30:00+08:00",
        "reported_at": "2025-11-13T14:00:00+08:00",
        "isolates": [{"code": "XORG1", "organism": "Stenotrophomonas maltophilia"}],
        "susceptibility": [
            {"antibiotic": "Levofloxacin", "code": "LVX", "result": "S"},
            {"antibiotic": "Trimethoprim/Sulfamethoxazole", "code": "SXT", "result": "S"},
        ],
    },
    {
        "patient_id": "pat_001",
        "sheet_number": "M11411L014002",
        "specimen": "Sputum",
        "specimen_code": "SP01",
        "department": "加護病房一",
        "collected_at": "2025-11-05T06:15:00+08:00",
        "reported_at": "2025-11-08T10:30:00+08:00",
        "isolates": [{"code": "XORG2", "organism": "Klebsiella pneumoniae"}],
        "susceptibility": [
            {"antibiotic": "Meropenem", "code": "MEM", "result": "S"},
            {"antibiotic": "Ceftazidime", "code": "CAZ", "result": "R"},
            {"antibiotic": "Piperacillin/Tazobactam", "code": "TZP", "result": "I"},
            {"antibiotic": "Amikacin", "code": "AMK", "result": "S"},
        ],
    },
    {
        "patient_id": "pat_001",
        "sheet_number": "M11410L036001",
        "specimen": "Blood",
        "specimen_code": "BL01",
        "department": "加護病房一",
        "collected_at": "2025-10-28T17:00:00+08:00",
        "reported_at": "2025-10-31T13:00:00+08:00",
        "isolates": [],
        "susceptibility": [],
    },
    {
        "patient_id": "pat_001",
        "sheet_number": "M11410L036002",
        "specimen": "Sputum",
        "specimen_code": "SP03",
        "department": "加護病房一",
        "collected_at": "2025-10-25T09:00:00+08:00",
        "reported_at": "2025-10-28T11:00:00+08:00",
        "isolates": [],
        "susceptibility": [],
    },
    # pat_002 李四 — 敗血性休克: blood + urine cultures
    {
        "patient_id": "pat_002",
        "sheet_number": "M11411L020001",
        "specimen": "Blood",
        "specimen_code": "BL01",
        "department": "加護病房一",
        "collected_at": "2025-11-12T03:00:00+08:00",
        "reported_at": "2025-11-15T09:30:00+08:00",
        "isolates": [
            {"code": "XORG1", "organism": "Escherichia coli"},
            {"code": "XORG2", "organism": "Enterococcus faecalis"},
        ],
        "susceptibility": [
            {"antibiotic": "Ampicillin", "code": "AMP", "result": "R"},
            {"antibiotic": "Ceftriaxone", "code": "CRO", "result": "S"},
            {"antibiotic": "Ciprofloxacin", "code": "CIP", "result": "R"},
            {"antibiotic": "Meropenem", "code": "MEM", "result": "S"},
            {"antibiotic": "Vancomycin", "code": "VAN", "result": "S"},
        ],
    },
    {
        "patient_id": "pat_002",
        "sheet_number": "M11411L020002",
        "specimen": "Urine(導尿)",
        "specimen_code": "UR024",
        "department": "加護病房一",
        "collected_at": "2025-11-12T03:10:00+08:00",
        "reported_at": "2025-11-14T16:00:00+08:00",
        "isolates": [{"code": "XORG1", "organism": "Escherichia coli"}],
        "susceptibility": [
            {"antibiotic": "Ampicillin", "code": "AMP", "result": "R"},
            {"antibiotic": "Ceftriaxone", "code": "CRO", "result": "S"},
            {"antibiotic": "Ciprofloxacin", "code": "CIP", "result": "R"},
            {"antibiotic": "Nitrofurantoin", "code": "NIT", "result": "S"},
        ],
    },
    {
        "patient_id": "pat_002",
        "sheet_number": "M11411L020003",
        "specimen": "Blood",
        "specimen_code": "BL01",
        "department": "加護病房一",
        "collected_at": "2025-11-08T22:00:00+08:00",
        "reported_at": "2025-11-11T14:00:00+08:00",
        "isolates": [],
        "susceptibility": [],
    },
    # pat_003 王五 — 急性腎衰竭: urine culture with Candida
    {
        "patient_id": "pat_003",
        "sheet_number": "M11411L025001",
        "specimen": "Urine(導尿)",
        "specimen_code": "UR024",
        "department": "加護病房一",
        "collected_at": "2025-11-14T10:00:00+08:00",
        "reported_at": "2025-11-17T11:00:00+08:00",
        "isolates": [{"code": "XORG1", "organism": "Candida albicans"}],
        "susceptibility": [
            {"antibiotic": "Fluconazole", "code": "FCA", "result": "S"},
            {"antibiotic": "Amphotericin B", "code": "AMB", "result": "S"},
            {"antibiotic": "Caspofungin", "code": "CAS", "result": "S"},
        ],
    },
    {
        "patient_id": "pat_003",
        "sheet_number": "M11411L025002",
        "specimen": "Blood",
        "specimen_code": "BL01",
        "department": "加護病房一",
        "collected_at": "2025-11-14T10:05:00+08:00",
        "reported_at": "2025-11-17T15:00:00+08:00",
        "isolates": [],
        "susceptibility": [],
    },
    {
        "patient_id": "pat_003",
        "sheet_number": "M11411L025003",
        "specimen": "Urine(導尿)",
        "specimen_code": "UR024",
        "department": "加護病房一",
        "collected_at": "2025-11-08T08:00:00+08:00",
        "reported_at": "2025-11-10T14:00:00+08:00",
        "isolates": [],
        "susceptibility": [],
    },
    # pat_004 趙六 — 創傷性腦損傷: wound + CSF cultures
    {
        "patient_id": "pat_004",
        "sheet_number": "M11411L030001",
        "specimen": "Wound",
        "specimen_code": "WD01",
        "department": "加護病房一",
        "collected_at": "2025-11-15T14:00:00+08:00",
        "reported_at": "2025-11-18T10:00:00+08:00",
        "isolates": [{"code": "XORG1", "organism": "Staphylococcus aureus (MSSA)"}],
        "susceptibility": [
            {"antibiotic": "Oxacillin", "code": "OXA", "result": "S"},
            {"antibiotic": "Vancomycin", "code": "VAN", "result": "S"},
            {"antibiotic": "Clindamycin", "code": "CLI", "result": "S"},
            {"antibiotic": "Trimethoprim/Sulfamethoxazole", "code": "SXT", "result": "S"},
        ],
    },
    {
        "patient_id": "pat_004",
        "sheet_number": "M11411L030002",
        "specimen": "CSF",
        "specimen_code": "CS01",
        "department": "加護病房一",
        "collected_at": "2025-11-15T14:30:00+08:00",
        "reported_at": "2025-11-18T16:00:00+08:00",
        "isolates": [],
        "susceptibility": [],
    },
]


async def main() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Clear existing culture_results
        await session.execute(text("DELETE FROM culture_results"))

        for c in CULTURES:
            cid = f"culture_{uuid.uuid4().hex[:12]}"
            collected = datetime.fromisoformat(c["collected_at"]) if c.get("collected_at") else None
            reported = datetime.fromisoformat(c["reported_at"]) if c.get("reported_at") else None
            await session.execute(
                text("""
                    INSERT INTO culture_results
                        (id, patient_id, sheet_number, specimen, specimen_code,
                         department, collected_at, reported_at, isolates, susceptibility,
                         created_at, updated_at)
                    VALUES
                        (:id, :patient_id, :sheet_number, :specimen, :specimen_code,
                         :department, :collected_at, :reported_at,
                         :isolates::jsonb, :susceptibility::jsonb,
                         NOW(), NOW())
                """),
                {
                    "id": cid,
                    "patient_id": c["patient_id"],
                    "sheet_number": c["sheet_number"],
                    "specimen": c["specimen"],
                    "specimen_code": c["specimen_code"],
                    "department": c["department"],
                    "collected_at": collected,
                    "reported_at": reported,
                    "isolates": __import__("json").dumps(c["isolates"]),
                    "susceptibility": __import__("json").dumps(c["susceptibility"]),
                },
            )
            print(f"  Inserted: {c['patient_id']} / {c['specimen']} ({c['sheet_number']})")

        await session.commit()
        print(f"\nSeeded {len(CULTURES)} culture results for 4 patients.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
