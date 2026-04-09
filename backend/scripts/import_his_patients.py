#!/usr/bin/env python3
"""Import HIS patient data → ChatICU Supabase DB (upsert).

Reads from patient/*/ directories, converts via HISConverter, and upserts
into the PostgreSQL database. Idempotent — safe to re-run.

Usage:
    cd backend
    python3 scripts/import_his_patients.py                       # import all
    python3 scripts/import_his_patients.py --patient 50045203    # one patient
    python3 scripts/import_his_patients.py --dry-run             # preview only
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add backend/ to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.fhir.his_converter import HISConverter


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_database_url() -> str:
    """Get DATABASE_URL from env or .env file."""
    url = os.environ.get("DATABASE_URL")
    if url:
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if url.startswith("postgresql://"):
                    url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
                return url

    print("ERROR: DATABASE_URL not found in environment or .env file")
    sys.exit(1)


def _serialize(val: Any) -> Any:
    """Serialize Python objects for SQL insertion.

    asyncpg requires native date/datetime objects, but list/dict must be JSON strings.
    """
    if isinstance(val, (date, datetime)):
        return val  # asyncpg handles native date/datetime
    if isinstance(val, (list, dict)):
        return json.dumps(val, ensure_ascii=False, default=str)
    return val


# ---------------------------------------------------------------------------
# Upsert functions
# ---------------------------------------------------------------------------

async def upsert_patient(session: Any, data: Dict) -> None:
    """Upsert one patient record."""
    from sqlalchemy import text

    # Check if exists
    row = await session.execute(
        text("SELECT id FROM patients WHERE id = :id"),
        {"id": data["id"]},
    )
    exists = row.scalar() is not None

    if exists:
        # Update
        sets = []
        params = {"id": data["id"]}
        skip = {"id", "created_at"}
        for k, v in data.items():
            if k in skip:
                continue
            sets.append(f"{k} = :{k}")
            params[k] = _serialize(v)
        if sets:
            sql = f"UPDATE patients SET {', '.join(sets)}, updated_at = NOW() WHERE id = :id"
            await session.execute(text(sql), params)
    else:
        # Insert
        cols = [k for k in data.keys() if k != "created_at"]
        placeholders = [f":{k}" for k in cols]
        params = {k: _serialize(data[k]) for k in cols}
        sql = f"INSERT INTO patients ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
        await session.execute(text(sql), params)


async def upsert_records(session: Any, table: str, records: List[Dict]) -> int:
    """Upsert records into a table by id. Returns count."""
    from sqlalchemy import text

    count = 0
    for rec in records:
        rec_id = rec.get("id")
        if not rec_id:
            continue

        row = await session.execute(
            text(f"SELECT id FROM {table} WHERE id = :id"),
            {"id": rec_id},
        )
        exists = row.scalar() is not None

        cols = [k for k in rec.keys() if k not in ("created_at", "updated_at")]
        params = {k: _serialize(rec[k]) for k in cols}

        if exists:
            sets = [f"{k} = :{k}" for k in cols if k != "id"]
            if sets:
                sql = f"UPDATE {table} SET {', '.join(sets)}, updated_at = NOW() WHERE id = :id"
                await session.execute(text(sql), params)
        else:
            placeholders = [f":{k}" for k in cols]
            sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
            await session.execute(text(sql), params)
        count += 1
    return count


# ---------------------------------------------------------------------------
# Main import logic
# ---------------------------------------------------------------------------

PATIENT_BASE = Path(__file__).resolve().parent.parent.parent / "patient"


def discover_patients(base: Path, patient_filter: Optional[str] = None) -> List[Path]:
    """Discover patient directories."""
    if not base.exists():
        print(f"ERROR: patient directory not found: {base}")
        sys.exit(1)

    dirs = sorted([
        base / d for d in os.listdir(base)
        if (base / d).is_dir() and d[0].isdigit()
    ])

    if patient_filter:
        dirs = [d for d in dirs if d.name == patient_filter]
        if not dirs:
            print(f"ERROR: patient {patient_filter} not found in {base}")
            sys.exit(1)

    return dirs


def dry_run(patient_dirs: List[Path]) -> None:
    """Preview mode — convert and print summary without DB writes."""
    print(f"=== DRY RUN: {len(patient_dirs)} patients ===\n")

    for d in patient_dirs:
        converter = HISConverter(str(d))
        result = converter.convert_all()
        if "error" in result:
            print(f"  {d.name}: ERROR - {result['error']}")
            continue

        s = result["summary"]
        p = result["patient"]
        print(f"  {d.name} ({s['patient_name']})")
        print(f"    Meds: {s['medications_count']}, Labs: {s['lab_records_count']}, "
              f"Cultures: {s['culture_results_count']}, Reports: {s['diagnostic_reports_count']}")
        print(f"    SAN: S={s['sedation_drugs']}, A={s['analgesia_drugs']}, N={s['nmb_drugs']}")
        print(f"    Vent days: {s['ventilator_days']}, Consent: {s['consent_status']}")
        if p.get("alerts"):
            print(f"    Alerts: {p['alerts']}")
        print()

    print("=== DRY RUN complete (no DB writes) ===")


async def import_patients(patient_dirs: List[Path]) -> None:
    """Import patients into the database."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    db_url = get_database_url()
    engine = create_async_engine(
        db_url, echo=False,
        # Supabase uses PgBouncer in transaction mode — disable prepared statements
        connect_args={"prepared_statement_cache_size": 0,
                      "statement_cache_size": 0,
                      "command_timeout": 120},
    )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print(f"=== IMPORTING {len(patient_dirs)} patients ===\n")

    async with session_factory() as session:
        for d in patient_dirs:
            converter = HISConverter(str(d))
            result = converter.convert_all()
            if "error" in result:
                print(f"  {d.name}: SKIP - {result['error']}")
                continue

            s = result["summary"]
            print(f"  {d.name} ({s['patient_name']}) ... ", end="", flush=True)

            try:
                await upsert_patient(session, result["patient"])
                med_n = await upsert_records(session, "medications", result["medications"])
                lab_n = await upsert_records(session, "lab_data", result["lab_data"])
                cul_n = await upsert_records(session, "culture_results", result["culture_results"])
                rep_n = await upsert_records(session, "diagnostic_reports", result["diagnostic_reports"])

                await session.commit()
                print(f"OK (meds:{med_n} labs:{lab_n} cult:{cul_n} diag:{rep_n})")

            except Exception as e:
                await session.rollback()
                print(f"ERROR: {e}")

    await engine.dispose()
    print(f"\n=== IMPORT complete ===")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Import HIS patient data into ChatICU database"
    )
    parser.add_argument("--patient", "-p",
                        help="Import single patient by chart number (e.g. 50045203)")
    parser.add_argument("--dry-run", "-n", action="store_true",
                        help="Preview only, no database writes")
    parser.add_argument("--patient-dir", "-d",
                        help=f"Patient data base directory (default: {PATIENT_BASE})")
    args = parser.parse_args()

    base = Path(args.patient_dir) if args.patient_dir else PATIENT_BASE
    patient_dirs = discover_patients(base, args.patient)

    if not patient_dirs:
        print("No patients found.")
        return

    if args.dry_run:
        dry_run(patient_dirs)
    else:
        asyncio.run(import_patients(patient_dirs))


if __name__ == "__main__":
    main()
