#!/usr/bin/env python3
"""Detect patients with alternate MRNs (chart merges) whose cross-MRN data is unreachable.

Scans each patient's getLabResult.json (main + ExtraFactories) for rows whose
PAT_NO differs from the folder MRN. These indicate HIS chart merges — the
same person has records under multiple MRNs.

HIS API behaviour:
  - getLabResult: merges across MRNs by National ID → we see cross-MRN labs.
  - getAllMedicine / getOpd / getIpd: MRN-scoped → cross-MRN records invisible.

Consequence: outpatient Rx and visits recorded under the alt MRN are never
loaded into ChatICU unless the fetcher is separately run with that MRN.

Usage:
    python3 backend/scripts/audit_alt_mrn.py

Actionable output: for each flagged patient, hand the alt MRN(s) to the HIS
operator / fetcher so they can run another pull scoped to that MRN.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

PATIENT_ROOT = Path(__file__).resolve().parent.parent.parent / "patient"


def load_data(p: Path) -> list:
    try:
        d = json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return []
    rows = d.get("Data", d) if isinstance(d, dict) else d
    return rows if isinstance(rows, list) else []


def audit_patient(mrn: str, pat_dir: Path) -> dict:
    latest = (pat_dir / "latest.txt").read_text().strip()
    snap = pat_dir / latest

    files = [snap / "getLabResult.json"]
    extras = snap / "ExtraFactories"
    if extras.exists():
        files += list(extras.rglob("getLabResult.json"))

    alt: dict = defaultdict(lambda: {"count": 0, "depts": Counter(), "date_range": [None, None]})
    for f in files:
        if not f.exists():
            continue
        for row in load_data(f):
            if not isinstance(row, dict):
                continue
            row_mrn = str(row.get("PAT_NO") or "").strip()
            if row_mrn and row_mrn != mrn:
                info = alt[row_mrn]
                info["count"] += 1
                if row.get("HDEPT_NAME"):
                    info["depts"][row["HDEPT_NAME"]] += 1
                d = str(row.get("REPORT_DATE") or "")[:6]
                if d:
                    lo, hi = info["date_range"]
                    info["date_range"] = [min(lo, d) if lo else d, max(hi, d) if hi else d]

    return {k: dict(v, depts=dict(v["depts"])) for k, v in alt.items()}


def main() -> int:
    print(f"Scanning {PATIENT_ROOT}\n")
    affected = 0
    for pat_dir in sorted(PATIENT_ROOT.iterdir()):
        if not pat_dir.is_dir():
            continue
        if not (pat_dir / "latest.txt").exists():
            continue
        mrn = pat_dir.name
        alt = audit_patient(mrn, pat_dir)
        if alt:
            affected += 1
            print(f"=== MRN {mrn} has {len(alt)} alternate MRN(s) ===")
            for alt_mrn, info in sorted(alt.items(), key=lambda x: -x[1]["count"]):
                rng = f"{info['date_range'][0]}~{info['date_range'][1]}"
                print(f"  alt MRN {alt_mrn}: {info['count']} lab rows, date range {rng}")
                print(f"    depts: {info['depts']}")
                print(
                    f"    → operator action: fetch HIS snapshot for MRN={alt_mrn}"
                    f" and store as /patient/{alt_mrn}/ alongside {mrn}"
                )
            print()

    print(f"Summary: {affected} patient(s) have alternate MRNs — data gap is real")
    return 0 if affected == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
