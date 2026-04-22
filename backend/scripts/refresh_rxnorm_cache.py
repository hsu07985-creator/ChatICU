#!/usr/bin/env python3
"""Refresh auto_rxnorm_cache.json by looking up ODR_CODEs still missing ATC.

Scans all patient/*/*/getAllMedicine.json files locally, extracts the generic
name from ODR_NAME for codes NOT in drug_formulary.csv, queries RxNav (online),
and writes the results back to backend/app/fhir/code_maps/auto_rxnorm_cache.json
so they're available in production's cache-only sync.

Usage:
    python3 backend/scripts/refresh_rxnorm_cache.py            # full scan
    python3 backend/scripts/refresh_rxnorm_cache.py --dry-run  # list what would query
    python3 backend/scripts/refresh_rxnorm_cache.py --offline  # no network (only verify cache hits)

Production launchd sync NEVER calls this — it only reads the cache. New drugs
show up in a developer's next run, get resolved, and get committed to git.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

PATIENT_BASE = REPO_ROOT / "patient"
FORMULARY_CSV = BACKEND_ROOT / "app" / "fhir" / "code_maps" / "drug_formulary.csv"


def load_formulary_codes() -> set[str]:
    out: set[str] = set()
    if not FORMULARY_CSV.exists():
        return out
    with FORMULARY_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            code = (row.get("odr_code") or "").strip()
            atc = (row.get("atc_code") or "").strip()
            if code and atc:
                out.add(code)
    return out


def collect_unmapped_ODR_name_pairs(formulary_codes: set[str]) -> dict[str, str]:
    """Scan patient/*/*/getAllMedicine.json → {ODR_CODE: sample ODR_NAME}.

    Only keeps codes NOT already in the formulary (i.e. candidates for RxNorm).
    """
    out: dict[str, str] = {}
    if not PATIENT_BASE.exists():
        print(f"[WARN] {PATIENT_BASE} not found; nothing to scan", file=sys.stderr)
        return out

    for patient_dir in sorted(PATIENT_BASE.iterdir()):
        if not patient_dir.is_dir():
            continue
        latest_file = patient_dir / "latest.txt"
        if not latest_file.exists():
            continue
        latest_ts = latest_file.read_text().strip()
        med_file = patient_dir / latest_ts / "getAllMedicine.json"
        if not med_file.exists():
            continue
        try:
            doc = json.loads(med_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        rows = doc.get("Data") if isinstance(doc, dict) else doc
        if not isinstance(rows, list):
            continue
        for m in rows:
            code = (m.get("ODR_CODE") or "").strip()
            name = (m.get("ODR_NAME") or "").strip()
            if not code or code in formulary_codes:
                continue
            if code not in out and name:
                out[code] = name
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Show candidates, no network, no write")
    parser.add_argument("--offline", action="store_true", help="Cache-only (check existing cache)")
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()

    from app.fhir.rxnorm import (
        extract_generic_name,
        lookup,
        save_cache,
        _default_cache,
        reset_default_cache,
    )

    # Make sure we're using a fresh cache instance
    reset_default_cache()

    formulary_codes = load_formulary_codes()
    print(f"Loaded {len(formulary_codes)} formulary codes")

    candidates = collect_unmapped_ODR_name_pairs(formulary_codes)
    print(f"Found {len(candidates)} ODR_CODEs not in formulary")

    resolved_new = 0
    resolved_cached = 0
    missed_generic = 0
    missed_lookup = 0

    for code in sorted(candidates.keys()):
        name = candidates[code]
        generic = extract_generic_name(name)
        if not generic:
            missed_generic += 1
            continue

        if args.dry_run:
            print(f"  {code:>10s}  generic={generic!r}  name={name[:50]}")
            continue

        before = _default_cache().was_looked_up(generic)
        hit = lookup(generic, online=not args.offline, timeout=args.timeout)

        if hit and hit.atc_code:
            if before:
                resolved_cached += 1
            else:
                resolved_new += 1
                print(f"  + {code:>10s} {generic:<30s} → ATC={hit.atc_code}")
        else:
            missed_lookup += 1

    print(f"\nSummary:")
    print(f"  resolved (cache hit):    {resolved_cached}")
    print(f"  resolved (new, network): {resolved_new}")
    print(f"  missed (no generic):     {missed_generic}")
    print(f"  missed (lookup fail):    {missed_lookup}")

    if not args.dry_run and not args.offline:
        save_cache()
        print(f"\nCache saved to backend/app/fhir/code_maps/auto_rxnorm_cache.json")
        print(f"(commit it so production's cache-only lookup benefits)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
