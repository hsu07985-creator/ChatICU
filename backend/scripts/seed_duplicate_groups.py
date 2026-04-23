#!/usr/bin/env python3
"""Seed L3/L4 duplicate-detection groups + rule overrides into Postgres.

Reads the source-of-truth CSVs under backend/app/fhir/code_maps/:

  * drug_mechanism_groups.csv
  * drug_mechanism_group_members.csv
  * drug_endpoint_groups.csv
  * drug_endpoint_group_members.csv
  * duplicate_rule_overrides.csv

Lines whose first non-whitespace character is ``#`` are treated as comments
and skipped. Upserts use the group_key (for groups) or
(rule_type, atc_code_1, atc_code_2) (for overrides) as conflict target, so
re-runs are safe.

Usage:
    # Prefer backend/.env.his-sync (matches other scripts). Set
    # SYNC_ENV_PATH to point somewhere else.
    export SYNC_ENV_PATH=/path/to/backend/.env.his-sync
    python3 -m scripts.seed_duplicate_groups            # apply
    python3 -m scripts.seed_duplicate_groups --dry-run  # preview
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


BACKEND_ROOT = Path(__file__).resolve().parent.parent
CODE_MAPS = BACKEND_ROOT / "app" / "fhir" / "code_maps"

MECHANISM_GROUPS_CSV = CODE_MAPS / "drug_mechanism_groups.csv"
MECHANISM_MEMBERS_CSV = CODE_MAPS / "drug_mechanism_group_members.csv"
ENDPOINT_GROUPS_CSV = CODE_MAPS / "drug_endpoint_groups.csv"
ENDPOINT_MEMBERS_CSV = CODE_MAPS / "drug_endpoint_group_members.csv"
OVERRIDES_CSV = CODE_MAPS / "duplicate_rule_overrides.csv"


# --------------------------------------------------------------------------
# CSV helpers
# --------------------------------------------------------------------------

def _iter_csv_rows(path: Path) -> Iterable[Dict[str, str]]:
    """Yield csv.DictReader rows, stripping ``#``-comment lines first.

    csv.DictReader would otherwise treat a ``#``-prefixed header as valid
    fields, so we filter before parsing.
    """
    if not path.exists():
        raise FileNotFoundError(f"Missing seed CSV: {path}")

    with path.open(encoding="utf-8") as f:
        lines = [ln for ln in f if ln.lstrip() and not ln.lstrip().startswith("#")]

    reader = csv.DictReader(lines)
    for row in reader:
        # Normalise empty strings to None so numeric/nullable columns behave.
        yield {k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()}


def _nullable(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return v or None


# --------------------------------------------------------------------------
# Database URL loading (mirrors backfill_drug_interactions_atc.py)
# --------------------------------------------------------------------------

def get_database_url() -> str:
    env_path = os.environ.get("SYNC_ENV_PATH")
    env_file = Path(env_path) if env_path else BACKEND_ROOT / ".env.his-sync"
    if not env_file.exists():
        # Fall back to DATABASE_URL in the ambient environment.
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError(
                f"DATABASE_URL missing (looked in {env_file} and env vars)"
            )
        return _normalise_url(url)

    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return _normalise_url(url)
    raise RuntimeError("DATABASE_URL missing")


def _normalise_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


# --------------------------------------------------------------------------
# Upserts
# --------------------------------------------------------------------------

async def upsert_groups(
    engine: AsyncEngine,
    table: str,
    csv_path: Path,
    dry_run: bool,
) -> Dict[str, int]:
    """Upsert into drug_mechanism_groups / drug_endpoint_groups.

    Returns {group_key: id} so members can be linked.
    """
    rows = list(_iter_csv_rows(csv_path))
    print(f"  [{table}] loaded {len(rows)} rows from {csv_path.name}")

    if dry_run:
        # In dry-run we still need id mapping for downstream members preview.
        async with engine.connect() as conn:
            existing = await conn.execute(text(f"SELECT id, group_key FROM {table}"))
            return {gk: gid for gid, gk in existing}

    group_ids: Dict[str, int] = {}
    async with engine.begin() as conn:
        for row in rows:
            group_key = row.get("group_key")
            if not group_key:
                continue
            result = await conn.execute(
                text(
                    f"""
                    INSERT INTO {table} (
                        group_key, group_name_zh, group_name_en,
                        severity, mechanism_note,
                        created_at, updated_at
                    ) VALUES (
                        :group_key, :zh, :en,
                        :severity, :note,
                        NOW(), NOW()
                    )
                    ON CONFLICT (group_key) DO UPDATE SET
                        group_name_zh = EXCLUDED.group_name_zh,
                        group_name_en = EXCLUDED.group_name_en,
                        severity      = EXCLUDED.severity,
                        mechanism_note = EXCLUDED.mechanism_note,
                        updated_at    = NOW()
                    RETURNING id
                    """
                ),
                {
                    "group_key": group_key,
                    "zh": _nullable(row.get("group_name_zh")),
                    "en": _nullable(row.get("group_name_en")),
                    "severity": _nullable(row.get("severity")),
                    "note": _nullable(row.get("mechanism_note")),
                },
            )
            group_ids[group_key] = result.scalar_one()
    return group_ids


async def upsert_group_members(
    engine: AsyncEngine,
    table: str,
    csv_path: Path,
    group_ids: Dict[str, int],
    with_subtype: bool,
    dry_run: bool,
) -> int:
    rows = list(_iter_csv_rows(csv_path))
    print(f"  [{table}] loaded {len(rows)} rows from {csv_path.name}")
    if dry_run:
        return len(rows)

    n = 0
    async with engine.begin() as conn:
        for row in rows:
            group_key = row.get("group_key")
            atc = row.get("atc_code")
            if not group_key or not atc:
                continue
            gid = group_ids.get(group_key)
            if gid is None:
                print(
                    f"    warning: member references unknown group_key={group_key!r}; skipping",
                    file=sys.stderr,
                )
                continue
            if with_subtype:
                sql = f"""
                    INSERT INTO {table} (
                        group_id, atc_code, active_ingredient, member_subtype
                    ) VALUES (
                        :gid, :atc, :ingr, :subtype
                    )
                    ON CONFLICT (group_id, atc_code) DO UPDATE SET
                        active_ingredient = EXCLUDED.active_ingredient,
                        member_subtype    = EXCLUDED.member_subtype
                """
                params = {
                    "gid": gid,
                    "atc": atc,
                    "ingr": _nullable(row.get("active_ingredient")),
                    "subtype": _nullable(row.get("member_subtype")),
                }
            else:
                sql = f"""
                    INSERT INTO {table} (
                        group_id, atc_code, active_ingredient
                    ) VALUES (
                        :gid, :atc, :ingr
                    )
                    ON CONFLICT (group_id, atc_code) DO UPDATE SET
                        active_ingredient = EXCLUDED.active_ingredient
                """
                params = {
                    "gid": gid,
                    "atc": atc,
                    "ingr": _nullable(row.get("active_ingredient")),
                }
            await conn.execute(text(sql), params)
            n += 1
    return n


async def upsert_overrides(engine: AsyncEngine, csv_path: Path, dry_run: bool) -> int:
    rows = list(_iter_csv_rows(csv_path))
    print(f"  [duplicate_rule_overrides] loaded {len(rows)} rows from {csv_path.name}")
    if dry_run:
        return len(rows)

    n = 0
    async with engine.begin() as conn:
        for row in rows:
            rule_type = row.get("rule_type")
            a1 = row.get("atc_code_1")
            a2 = row.get("atc_code_2")
            if not rule_type or not a1 or not a2:
                continue
            await conn.execute(
                text(
                    """
                    INSERT INTO duplicate_rule_overrides (
                        rule_type, atc_code_1, atc_code_2,
                        severity_override, reason, evidence_url,
                        created_at, updated_at
                    ) VALUES (
                        :rule_type, :a1, :a2,
                        :sev, :reason, :url,
                        NOW(), NOW()
                    )
                    ON CONFLICT (rule_type, atc_code_1, atc_code_2) DO UPDATE SET
                        severity_override = EXCLUDED.severity_override,
                        reason            = EXCLUDED.reason,
                        evidence_url      = EXCLUDED.evidence_url,
                        updated_at        = NOW()
                    """
                ),
                {
                    "rule_type": rule_type,
                    "a1": a1,
                    "a2": a2,
                    "sev": _nullable(row.get("severity_override")),
                    "reason": _nullable(row.get("reason")),
                    "url": _nullable(row.get("evidence_url")),
                },
            )
            n += 1
    return n


# --------------------------------------------------------------------------
# Entrypoint
# --------------------------------------------------------------------------

async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse CSVs and report counts without writing to DB",
    )
    args = parser.parse_args()

    url = get_database_url()
    engine = create_async_engine(
        url,
        connect_args={
            "prepared_statement_cache_size": 0,
            "statement_cache_size": 0,
            "command_timeout": 120,
        },
    )

    try:
        print("Seeding L3 mechanism groups...")
        mech_ids = await upsert_groups(
            engine, "drug_mechanism_groups", MECHANISM_GROUPS_CSV, args.dry_run
        )
        mech_members = await upsert_group_members(
            engine,
            "drug_mechanism_group_members",
            MECHANISM_MEMBERS_CSV,
            mech_ids,
            with_subtype=False,
            dry_run=args.dry_run,
        )

        print("Seeding L4 endpoint groups...")
        endp_ids = await upsert_groups(
            engine, "drug_endpoint_groups", ENDPOINT_GROUPS_CSV, args.dry_run
        )
        endp_members = await upsert_group_members(
            engine,
            "drug_endpoint_group_members",
            ENDPOINT_MEMBERS_CSV,
            endp_ids,
            with_subtype=True,
            dry_run=args.dry_run,
        )

        print("Seeding duplicate_rule_overrides...")
        overrides = await upsert_overrides(engine, OVERRIDES_CSV, args.dry_run)

        print("\nSummary:")
        print(f"  mechanism groups upserted:  {len(mech_ids)}")
        print(f"  mechanism members upserted: {mech_members}")
        print(f"  endpoint groups upserted:   {len(endp_ids)}")
        print(f"  endpoint members upserted:  {endp_members}")
        print(f"  overrides upserted:         {overrides}")
        if args.dry_run:
            print("\n--dry-run: no DB writes")
    finally:
        await engine.dispose()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
