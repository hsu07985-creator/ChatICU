#!/usr/bin/env python3
"""Backfill drug_interactions.drug1_atc / drug2_atc by matching drug names
against the hospital formulary + RxNorm cache.

Matching tiers (first hit wins):
  1. Exact case-insensitive match against formulary ingredient
  2. First-word match against formulary ingredient
     (handles "Morphine (Systemic)" → "morphine")
  3. Suffix-stripped match ("Morphine (Systemic)" → "morphine")
  4. auto_rxnorm_cache.json generic → ATC

Usage:
    export SYNC_ENV_PATH=/path/to/backend/.env.his-sync
    python3 backend/scripts/backfill_drug_interactions_atc.py            # apply
    python3 backend/scripts/backfill_drug_interactions_atc.py --dry-run  # preview
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BACKEND_ROOT = Path(__file__).resolve().parent.parent
CODE_MAPS = BACKEND_ROOT / "app" / "fhir" / "code_maps"
FORMULARY_CSV = CODE_MAPS / "drug_formulary.csv"
RXNORM_CACHE = CODE_MAPS / "auto_rxnorm_cache.json"


def get_database_url() -> str:
    env_path = os.environ.get("SYNC_ENV_PATH")
    env_file = Path(env_path) if env_path else BACKEND_ROOT / ".env.his-sync"
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
            return url
    raise RuntimeError("DATABASE_URL missing")


# Generic ion / element / class prefixes that, on their own, are not
# specific drugs. If a multi-word name starts with one of these (e.g.
# "Sodium Zirconium Cyclosilicate"), first-word matching collides with
# the first sibling in the formulary (e.g. "Sodium chloride" → B05XA03)
# and pollutes every Sodium-* DDI rule with the saline ATC.
_AMBIGUOUS_FIRST_WORDS = frozenset({
    # Ions / elements
    "sodium", "potassium", "calcium", "magnesium",
    "iron", "ferric", "ferrous", "aluminum", "aluminium",
    "zinc", "lithium",
    # Hormone / protein / class prefixes
    "insulin", "insulim",  # `insulim` is a formulary typo variant
    # Modifiers / descriptors that are not standalone drugs
    "human", "hepatitis", "vitamin", "amino", "recombinant",
    "mag.",  # abbreviation with three distinct ATCs in formulary
})


def build_name_to_atc() -> dict[str, str]:
    """Compose the lookup table from formulary + RxNorm cache."""
    out: dict[str, str] = {}

    # From formulary — ingredient column
    with FORMULARY_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            atc = (row.get("atc_code") or "").strip()
            if not atc:
                continue
            ingr = (row.get("ingredient") or "").strip()
            if not ingr:
                continue
            # Full match (lowercased)
            out.setdefault(ingr.lower(), atc)
            # First word (the English generic is usually first).
            # Skip when the first word is an ambiguous ion/element/class —
            # otherwise e.g. "Sodium chloride" makes every "Sodium *" drug
            # resolve to B05XA03 (saline).
            first = re.split(r"[\s\(\[/\-]", ingr)[0].strip().lower()
            if first and first not in _AMBIGUOUS_FIRST_WORDS:
                out.setdefault(first, atc)

    # From RxNorm cache — keys are already lowercased generics
    if RXNORM_CACHE.exists():
        cache = json.loads(RXNORM_CACHE.read_text(encoding="utf-8"))
        for k, v in cache.items():
            atc = v.get("atc_code")
            if atc:
                out.setdefault(k, atc)

    return out


def lookup_atc(drug_name: str, name_to_atc: dict[str, str]) -> str | None:
    """Try several normalisations to find an ATC match."""
    if not drug_name:
        return None

    # 1) Exact lowercased
    key = drug_name.strip().lower()
    if key in name_to_atc:
        return name_to_atc[key]

    # 2) First word only (e.g. "Morphine (Systemic)" → "morphine").
    # Skip this fallback when the first word is an ambiguous prefix to
    # avoid mis-mapping multi-word salts like "Sodium Zirconium Cyclosilicate".
    first = re.split(r"[\s\(\[/\-]", drug_name)[0].strip().lower()
    if first and first not in _AMBIGUOUS_FIRST_WORDS and first in name_to_atc:
        return name_to_atc[first]

    # 3) Strip common suffixes
    normalized = re.sub(
        r"\s*\((Systemic|Oral|Topical|Injection|Inhalation|Ophthalmic|Transdermal|Oral Inhalation)[^)]*\)",
        "",
        drug_name,
        flags=re.IGNORECASE,
    ).strip().lower()
    if normalized and normalized in name_to_atc:
        return name_to_atc[normalized]

    return None


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="preview only, no writes")
    args = parser.parse_args()

    name_to_atc = build_name_to_atc()
    print(f"Loaded {len(name_to_atc)} name→ATC entries from formulary+rxnorm")

    url = get_database_url()
    eng = create_async_engine(
        url,
        connect_args={
            "prepared_statement_cache_size": 0,
            "statement_cache_size": 0,
            "command_timeout": 120,
        },
    )

    matched_d1 = matched_d2 = both = 0
    total = 0
    updates: list[tuple[str, str | None, str | None]] = []

    async with eng.connect() as conn:
        r = await conn.execute(text("SELECT id, drug1, drug2 FROM drug_interactions"))
        rows = list(r)
        total = len(rows)

        for row_id, d1, d2 in rows:
            atc1 = lookup_atc(d1, name_to_atc)
            atc2 = lookup_atc(d2, name_to_atc)
            if atc1:
                matched_d1 += 1
            if atc2:
                matched_d2 += 1
            if atc1 and atc2:
                both += 1
            if atc1 or atc2:
                updates.append((row_id, atc1, atc2))

    print(f"\nDDI rows: {total}")
    print(f"  drug1 matched: {matched_d1} ({100*matched_d1/total:.1f}%)")
    print(f"  drug2 matched: {matched_d2} ({100*matched_d2/total:.1f}%)")
    print(f"  both matched:  {both} ({100*both/total:.1f}%)")
    print(f"  updates to apply: {len(updates)}")

    if args.dry_run:
        print("\n--dry-run: no DB writes")
        await eng.dispose()
        return 0

    # Batched UPDATE FROM (VALUES ...) — 1 round-trip per batch instead of 1 per row.
    # Critical when running over PgBouncer / trans-continental latency.
    print(f"Applying updates in batches of 1000 via UPDATE FROM (VALUES ...)")
    batch_size = 1000
    applied = 0
    for i in range(0, len(updates), batch_size):
        batch = updates[i : i + batch_size]
        # Build parameterised VALUES tuples
        values_sql = ", ".join(
            f"(:id_{k}, CAST(:a1_{k} AS VARCHAR), CAST(:a2_{k} AS VARCHAR))"
            for k in range(len(batch))
        )
        params: dict[str, object] = {}
        for k, (row_id, a1, a2) in enumerate(batch):
            params[f"id_{k}"] = row_id
            params[f"a1_{k}"] = a1
            params[f"a2_{k}"] = a2
        sql = (
            f"UPDATE drug_interactions SET "
            f"  drug1_atc = v.drug1_atc, "
            f"  drug2_atc = v.drug2_atc, "
            f"  updated_at = CURRENT_TIMESTAMP "
            f"FROM (VALUES {values_sql}) AS v(id, drug1_atc, drug2_atc) "
            f"WHERE drug_interactions.id = v.id"
        )
        async with eng.begin() as conn:
            await conn.execute(text(sql), params)
        applied += len(batch)
        print(f"  applied {applied}/{len(updates)}")

    print(f"\nDone. {len(updates)} DDI rows updated.")
    await eng.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
