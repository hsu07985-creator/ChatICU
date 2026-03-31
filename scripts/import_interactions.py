#!/usr/bin/env python3
"""
One-time batch import of drug interactions into PostgreSQL.

Usage:
    cd backend && python3 ../scripts/import_interactions.py

Reads backend/seeds/drug_interactions_full.json and batch-inserts into
the drug_interactions table. Replaces all existing rows.
"""

import asyncio
import hashlib
import json
import sys
from pathlib import Path

# Ensure backend is on the path
BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))


async def main():
    # Try full seed first, fall back to ICU-only
    full_seed = BACKEND_DIR / "seeds" / "drug_interactions_full.json"
    icu_seed = BACKEND_DIR / "seeds" / "icu_drug_interactions.json"

    if full_seed.exists():
        seed_path = full_seed
    elif icu_seed.exists():
        seed_path = icu_seed
        print(f"WARNING: Full seed not found, using ICU-only seed ({icu_seed})")
    else:
        print("ERROR: No seed file found")
        sys.exit(1)

    print(f"Loading {seed_path}...")
    data = json.loads(seed_path.read_text("utf-8"))
    print(f"Loaded {len(data)} interactions")

    # Import database engine
    from app.database import engine
    from sqlalchemy import text

    async with engine.begin() as conn:
        # Clear existing data
        result = await conn.execute(text("DELETE FROM drug_interactions"))
        print(f"Deleted {result.rowcount} existing rows")

        # Ensure new columns exist (migration 028 fallback)
        for col, col_type in [
            ("dependencies", "TEXT"),
            ("dependency_types", "TEXT"),
            ("interacting_members", "TEXT"),
            ("pubmed_ids", "TEXT"),
            ("dedup_key", "VARCHAR(300)"),
            ("body_hash", "VARCHAR(32)"),
        ]:
            try:
                await conn.execute(text(
                    f"ALTER TABLE drug_interactions ADD COLUMN IF NOT EXISTS {col} {col_type}"
                ))
            except Exception:
                pass

        # Batch insert in chunks of 500
        BATCH_SIZE = 500
        inserted = 0

        for batch_start in range(0, len(data), BATCH_SIZE):
            batch = data[batch_start:batch_start + BATCH_SIZE]
            rows = []
            for ix in batch:
                dedup_key = ix.get("dedup_key", "")
                if not dedup_key:
                    dedup_key = "||".join(sorted([
                        ix["drug1"].lower(), ix["drug2"].lower()
                    ]))
                _id = "ddi_" + hashlib.sha1(dedup_key.encode()).hexdigest()[:12]

                rows.append({
                    "id": _id,
                    "drug1": ix["drug1"],
                    "drug2": ix["drug2"],
                    "severity": ix["severity"],
                    "mechanism": ix.get("mechanism", ""),
                    "clinical_effect": ix.get("clinical_effect", ""),
                    "management": ix.get("management", ""),
                    "references": ix.get("references", ""),
                    "risk_rating": ix.get("risk_rating", ""),
                    "risk_rating_description": ix.get("risk_rating_description", ""),
                    "severity_label": ix.get("severity_label", ""),
                    "reliability_rating": ix.get("reliability_rating", ""),
                    "route_dependency": ix.get("route_dependency", ""),
                    "discussion": ix.get("discussion", ""),
                    "footnotes": ix.get("footnotes", ""),
                    "dependencies": json.dumps(ix.get("dependencies", []), ensure_ascii=False) if ix.get("dependencies") else None,
                    "dependency_types": json.dumps(ix.get("dependency_types", []), ensure_ascii=False) if ix.get("dependency_types") else None,
                    "interacting_members": json.dumps(ix.get("interacting_members", []), ensure_ascii=False) if ix.get("interacting_members") else None,
                    "pubmed_ids": json.dumps(ix.get("pubmed_ids", []), ensure_ascii=False) if ix.get("pubmed_ids") else None,
                    "dedup_key": dedup_key,
                    "body_hash": ix.get("body_hash", ""),
                })

            # Use executemany-style insert
            if rows:
                cols = list(rows[0].keys())
                placeholders = ", ".join(f":{c}" for c in cols)
                col_names = ", ".join(f'"{c}"' for c in cols)
                stmt = text(
                    f"INSERT INTO drug_interactions ({col_names}) VALUES ({placeholders}) "
                    f"ON CONFLICT (id) DO NOTHING"
                )
                for row in rows:
                    await conn.execute(stmt.bindparams(**row))
                inserted += len(rows)

            print(f"  Inserted {inserted}/{len(data)}...", end="\r")

        print(f"\nDone! Inserted {inserted} rows into drug_interactions")

    # Verify
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT COUNT(*) FROM drug_interactions"))
        count = result.scalar()
        print(f"Verification: {count} rows in drug_interactions table")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
