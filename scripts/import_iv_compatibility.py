#!/usr/bin/env python3
"""
Batch import Y-Site IV compatibility data into PostgreSQL (Supabase).

Usage:
    # Remote (Supabase):
    REMOTE_DATABASE_URL="postgresql+asyncpg://user:pass@host:6543/postgres" \  # pragma: allowlist secret
        python3 scripts/import_iv_compatibility.py

    # Local:
    cd backend && python3 ../scripts/import_iv_compatibility.py

Reads 2_藥物交互作用＋相容性/DrugData/icu_y_site_compatibility_v2_lookup.json
and batch-inserts into the iv_compatibilities table.
"""

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[0].parent / "backend"
DATA_FILE = Path(__file__).resolve().parents[0].parent / "2_藥物交互作用＋相容性" / "DrugData" / "icu_y_site_compatibility_v2_lookup.json"

sys.path.insert(0, str(BACKEND_DIR))


def build_rows(data: dict) -> list:
    """Flatten lookup JSON into iv_compatibilities rows."""
    rows = []
    seen = set()

    for sheet_name, sheet in data["sheets"].items():
        compat = sheet["compatibility"]
        for drug1, partners in compat.items():
            for drug2, code in partners.items():
                if code not in ("C", "I"):
                    continue  # Skip "-" (no data)

                # Deduplicate symmetric pairs per sheet
                pair_key = "||".join(sorted([drug1.lower(), drug2.lower()])) + f"||{sheet_name}"
                if pair_key in seen:
                    continue
                seen.add(pair_key)

                row_id = "ivc_" + hashlib.sha1(pair_key.encode()).hexdigest()[:12]
                rows.append({
                    "id": row_id,
                    "drug1": drug1,
                    "drug2": drug2,
                    "solution": "Y-site",
                    "compatible": code == "C",
                    "time_stability": None,
                    "notes": f"科別：{sheet_name}",
                    "references": "陽明院區 Y-site compatibility 資料整理",
                })

    return rows


async def main():
    if not DATA_FILE.exists():
        print(f"ERROR: Data file not found: {DATA_FILE}")
        sys.exit(1)

    print(f"Loading {DATA_FILE}...")
    data = json.loads(DATA_FILE.read_text("utf-8"))
    rows = build_rows(data)
    print(f"Built {len(rows)} compatibility rows (C + I only, deduplicated)")

    remote_url = os.environ.get("REMOTE_DATABASE_URL")
    if remote_url:
        from sqlalchemy.ext.asyncio import create_async_engine
        engine = create_async_engine(
            remote_url, echo=False,
            connect_args={
                "command_timeout": 300,
                "server_settings": {"statement_timeout": "300000"},
                "statement_cache_size": 0,
            },
        )
        print(f"Using REMOTE_DATABASE_URL: {remote_url[:40]}...")
    else:
        from app.database import engine

    from sqlalchemy import text

    # Batch insert
    BATCH_SIZE = 200
    inserted = 0
    skipped = 0

    for batch_start in range(0, len(rows), BATCH_SIZE):
        batch = rows[batch_start:batch_start + BATCH_SIZE]
        async with engine.begin() as conn:
            stmt = text(
                "INSERT INTO iv_compatibilities (id, drug1, drug2, solution, compatible, time_stability, notes, \"references\") "
                "VALUES (:id, :drug1, :drug2, :solution, :compatible, :time_stability, :notes, :references) "
                "ON CONFLICT (id) DO UPDATE SET "
                "compatible = EXCLUDED.compatible, notes = EXCLUDED.notes, \"references\" = EXCLUDED.\"references\""
            )
            for row in batch:
                result = await conn.execute(stmt.bindparams(**row))
                if result.rowcount > 0:
                    inserted += 1
                else:
                    skipped += 1

        print(f"  Progress: {batch_start + len(batch)}/{len(rows)} (inserted={inserted}, skipped={skipped})...", end="\r")

    print(f"\nDone! Inserted/updated {inserted}, skipped {skipped}")

    # Verify
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT COUNT(*) FROM iv_compatibilities"))
        count = result.scalar()
        print(f"Verification: {count} rows in iv_compatibilities table")

        # Show breakdown
        result = await conn.execute(text(
            "SELECT compatible, COUNT(*) FROM iv_compatibilities GROUP BY compatible"
        ))
        for row in result:
            label = "Compatible" if row[0] else "Incompatible"
            print(f"  {label}: {row[1]}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
