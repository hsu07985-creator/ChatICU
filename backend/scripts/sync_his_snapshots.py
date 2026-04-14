#!/usr/bin/env python3
"""Scan HIS hourly patient snapshots and sync changed patients into the DB."""

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

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if url.startswith("postgresql://"):
                    url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
                return url

    raise RuntimeError("DATABASE_URL not found in environment or .env file")


def load_sync_state(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        return {}
    raw = json.loads(content)
    return raw if isinstance(raw, dict) else {}


def save_sync_state(path: Path, state: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def classify_action(
    previous: dict[str, Any] | None,
    snapshot_id: str,
    normalized_hash: str,
    force: bool = False,
) -> str:
    if force:
        return "forced"
    if previous is None:
        return "new"
    previous_hash = previous.get("normalized_hash")
    previous_snapshot_id = previous.get("snapshot_id")
    if previous_hash == normalized_hash:
        if previous_snapshot_id == snapshot_id:
            return "unchanged"
        return "timestamp-only"
    return "changed"


def preview(base: Path, patient_filter: str | None, state_path: Path, force: bool) -> int:
    patient_roots = discover_patient_roots(base, patient_filter)
    state = load_sync_state(state_path)

    print(f"=== HIS SNAPSHOT DRY RUN: {len(patient_roots)} patients ===")
    print(f"patient dir: {base}")
    print(f"state file : {state_path}")
    print()

    total_errors = 0
    counts = {"forced": 0, "new": 0, "changed": 0, "timestamp-only": 0, "unchanged": 0}

    for patient_root in patient_roots:
        try:
            snapshot = resolve_patient_snapshot(patient_root)
            previous = state.get(snapshot.mrn)
            action = classify_action(previous, snapshot.snapshot_id, snapshot.normalized_hash, force=force)
            counts[action] += 1

            print(f"{snapshot.mrn}")
            print(f"  action        : {action}")
            print(f"  format        : {snapshot.format_type}")
            print(f"  snapshot_id   : {snapshot.snapshot_id}")
            print(f"  snapshot_dir  : {snapshot.snapshot_dir}")
            print(f"  hash          : {snapshot.normalized_hash[:16]}")
            if previous:
                print(f"  prev_snapshot : {previous.get('snapshot_id')}")
                prev_hash = previous.get("normalized_hash", "")
                print(f"  prev_hash     : {str(prev_hash)[:16]}")
            print()
        except Exception as exc:
            total_errors += 1
            print(f"{patient_root.name}")
            print(f"  action        : error")
            print(f"  error         : {exc}")
            print()

    print("--- Summary ---")
    print(
        "  "
        + ", ".join(
            f"{label}={counts[label]}"
            for label in ("forced", "new", "changed", "timestamp-only", "unchanged")
        )
    )
    print(f"  errors={total_errors}")
    print()
    print("No database writes were performed in dry-run mode.")

    return 1 if total_errors else 0


async def sync(base: Path, patient_filter: str | None, state_path: Path, force: bool) -> int:
    patient_roots = discover_patient_roots(base, patient_filter)
    state = load_sync_state(state_path)
    db_url = get_database_url()

    engine_kwargs: dict[str, Any] = {"echo": False}
    if db_url.startswith("sqlite+"):
        engine = create_async_engine(db_url, **engine_kwargs)
    else:
        engine = create_async_engine(
            db_url,
            pool_size=1,
            max_overflow=0,
            connect_args={
                "prepared_statement_cache_size": 0,
                "statement_cache_size": 0,
                "command_timeout": 120,
            },
            **engine_kwargs,
        )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print(f"=== HIS SNAPSHOT SYNC: {len(patient_roots)} patients ===")
    print(f"patient dir: {base}")
    print(f"state file : {state_path}")
    print()

    total_errors = 0
    counts = {"forced": 0, "new": 0, "changed": 0, "timestamp-only": 0, "unchanged": 0, "synced": 0}

    async with session_factory() as session:
        for patient_root in patient_roots:
            try:
                snapshot = resolve_patient_snapshot(patient_root)
                previous = state.get(snapshot.mrn)
                action = classify_action(previous, snapshot.snapshot_id, snapshot.normalized_hash, force=force)
                counts[action] += 1

                print(f"{snapshot.mrn}")
                print(f"  action        : {action}")
                print(f"  snapshot_id   : {snapshot.snapshot_id}")

                if action in {"timestamp-only", "unchanged"}:
                    print("  sync          : skipped")
                    print()
                    continue

                try:
                    summary = await sync_snapshot_into_session(session, snapshot)
                    await upsert_global_sync_status(session, summary)
                    await session.commit()
                except Exception:
                    await session.rollback()
                    raise

                counts["synced"] += 1
                state[snapshot.mrn] = {
                    "snapshot_id": snapshot.snapshot_id,
                    "snapshot_dir": str(snapshot.snapshot_dir),
                    "normalized_hash": snapshot.normalized_hash,
                    "last_imported_at": summary["synced_at"],
                    "patient_id": summary["patient_id"],
                    "patient_name": summary["patient_name"],
                }
                save_sync_state(state_path, state)

                print(f"  patient_id    : {summary['patient_id']}")
                print(
                    "  synced        : "
                    f"med_upserted={summary['medications']['upserted']} "
                    f"med_deleted={summary['medications']['deleted']} "
                    f"med_protected={summary['medications']['protected']} "
                    f"labs={summary['lab_data']} "
                    f"cultures={summary['culture_results']} "
                    f"reports={summary['diagnostic_reports']}"
                )
                print()
            except Exception as exc:
                total_errors += 1
                print(f"{patient_root.name}")
                print("  action        : error")
                print(f"  error         : {exc}")
                print()

    await engine.dispose()

    print("--- Summary ---")
    print(
        "  "
        + ", ".join(
            f"{label}={counts[label]}"
            for label in ("forced", "new", "changed", "timestamp-only", "unchanged", "synced")
        )
    )
    print(f"  errors={total_errors}")

    return 1 if total_errors else 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Resolve HIS hourly snapshots and sync changed patients into the DB"
    )
    parser.add_argument(
        "--patient",
        "-p",
        help="Sync one patient by chart number (e.g. 16312169)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview sync decisions without database writes",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force sync even when hash and snapshot_id match",
    )
    parser.add_argument(
        "--patient-dir",
        "-d",
        help=f"Patient data base directory (default: {PATIENT_BASE})",
    )
    parser.add_argument(
        "--state-file",
        help=f"Sync state file path (default: {STATE_FILE})",
    )
    args = parser.parse_args()

    base = Path(args.patient_dir) if args.patient_dir else PATIENT_BASE
    state_path = Path(args.state_file) if args.state_file else STATE_FILE

    if args.dry_run:
        raise SystemExit(preview(base, args.patient, state_path, args.force))

    raise SystemExit(asyncio.run(sync(base, args.patient, state_path, args.force)))


if __name__ == "__main__":
    main()
