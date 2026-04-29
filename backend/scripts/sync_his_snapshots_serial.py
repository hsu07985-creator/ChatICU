#!/usr/bin/env python3
"""Serial-mode HIS snapshot sync — drop-in replacement for sync_his_snapshots.py
when its async-task machinery silently drops INSERTs against Supabase pooler.

Each patient is processed inside its own ``async with session_factory()`` block
without create_task / Semaphore wrapping — this matches the pattern that
verifiably persists rows on Supabase 6543 transaction-mode pooler.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.fhir.snapshot_resolver import discover_patient_roots, resolve_patient_snapshot
from app.fhir.snapshot_sync import sync_snapshot_into_session, upsert_global_sync_status

PATIENT_BASE = Path(__file__).resolve().parent.parent.parent / "patient"
STATE_FILE = Path(__file__).resolve().parent.parent / ".state" / "his_snapshot_sync_state.json"


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url
    env_path = Path(__file__).resolve().parent.parent / ".env.his-sync"
    if not env_path.exists():
        env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if url.startswith("postgresql://"):
                    url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
                return url
    raise RuntimeError("DATABASE_URL not found in environment or .env.his-sync / .env")


def load_state(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return {}
    return json.loads(raw)


def save_state(path: Path, state: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def classify(prev: dict | None, snapshot_id: str, normalized_hash: str, force: bool) -> str:
    if force:
        return "forced"
    if prev is None:
        return "new"
    if prev.get("normalized_hash") == normalized_hash:
        return "unchanged" if prev.get("snapshot_id") == snapshot_id else "timestamp-only"
    return "changed"


async def main(patient_filter: str | None, force: bool) -> int:
    base = PATIENT_BASE
    state = load_state(STATE_FILE)
    db_url = get_database_url()

    engine = create_async_engine(
        db_url,
        echo=False,
        pool_size=1,
        max_overflow=0,
        connect_args={
            "prepared_statement_cache_size": 0,
            "statement_cache_size": 0,
            "command_timeout": 120,
        },
    )
    sf = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    roots = discover_patient_roots(base, patient_filter)
    print(f"=== HIS SERIAL SYNC: {len(roots)} patients ===")
    print(f"patient dir: {base}")
    print(f"state file : {STATE_FILE}")
    print()

    counts = {"forced": 0, "new": 0, "changed": 0, "unchanged": 0, "timestamp-only": 0, "synced": 0}
    errors = 0

    for root in roots:
        try:
            snap = resolve_patient_snapshot(root)
        except Exception as exc:
            print(f"{root.name}\n  resolve error: {exc}\n")
            errors += 1
            continue

        prev = state.get(snap.mrn)
        action = classify(prev, snap.snapshot_id, snap.normalized_hash, force=force)
        counts[action] += 1

        if action in {"unchanged", "timestamp-only"}:
            print(f"{snap.mrn}\n  action        : {action}\n  sync          : skipped\n")
            continue

        async with sf() as session:
            try:
                summary = await sync_snapshot_into_session(session, snap)
                await upsert_global_sync_status(session, summary)
                await session.commit()
            except Exception as exc:
                await session.rollback()
                print(f"{snap.mrn}\n  action        : {action}\n  error         : {type(exc).__name__}: {exc}\n")
                errors += 1
                continue

        meds = summary["medications"]
        print(f"{snap.mrn}\n  action        : {action}")
        print(f"  patient_id    : {summary['patient_id']}")
        print(
            "  synced        : "
            f"med_upserted={meds['upserted']} med_added={meds.get('added', 0)} "
            f"med_deleted={meds['deleted']} labs={summary['lab_data']} "
            f"cultures={summary['culture_results']} reports={summary['diagnostic_reports']}"
        )
        print()

        state[snap.mrn] = {
            "snapshot_id": snap.snapshot_id,
            "snapshot_dir": str(snap.snapshot_dir),
            "normalized_hash": snap.normalized_hash,
            "last_imported_at": summary["synced_at"],
            "patient_id": summary["patient_id"],
            "patient_name": summary["patient_name"],
        }
        save_state(STATE_FILE, state)
        counts["synced"] += 1

    await engine.dispose()

    print("--- Summary ---")
    print("  " + ", ".join(f"{k}={counts[k]}" for k in ("forced", "new", "changed", "timestamp-only", "unchanged", "synced")))
    print(f"  errors={errors}")
    return 1 if errors else 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("-p", "--patient", help="Sync one chart number")
    p.add_argument("--force", action="store_true", help="Force sync even when hash matches")
    args = p.parse_args()
    raise SystemExit(asyncio.run(main(args.patient, args.force)))
