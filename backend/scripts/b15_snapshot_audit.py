#!/usr/bin/env python3
"""B15 Phase 2.1 — Snapshot audit (read-only).

Calls ``build_clinical_snapshot()`` against prod DB for specified patient
IDs and measures:

- Total chars + estimated tokens
- Per-section chars / percent / estimated tokens
  (sections: patient, vital, vent, lab, med, duplicate, reports, scores,
   header, timestamp, footer)
- Per-fetcher build time (via monkey-patch wrapper inside this script —
  zero changes to runtime code on disk)
- DB SELECT count (via SQLAlchemy event listener)
- Total build time
- Stability hash: same patient run twice, hashes must match

Hard read-only:
- No DB writes, no ai_session creation
- No OpenAI API calls
- No edits to backend/app/services/patient_context_builder.py
- No edits to backend/app/routers/ai_chat.py

Usage::

    cd backend
    python3 -m scripts.b15_snapshot_audit \\
        --patients pat_5219befc pat_b00e859b
    # optional: --show-snapshot to dump full snapshot text
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

# Add backend/ to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


# ---------------------------------------------------------------------------
# DB env (same .env.his-sync pattern as b15_baseline_synthetic.py)
# ---------------------------------------------------------------------------

def _get_database_url() -> str:
    env_path = Path(__file__).resolve().parent.parent / ".env.his-sync"
    if not env_path.exists():
        print(
            "ERROR: backend/.env.his-sync not found — needed for prod DB access",
            file=sys.stderr,
        )
        sys.exit(2)
    for line in env_path.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("DATABASE_URL not found in .env.his-sync")


# ---------------------------------------------------------------------------
# Monkey-patch fetchers / formatters with timing+capture wrappers
# ---------------------------------------------------------------------------

# Per-call captures (reset between patients via _reset_captures)
_fetch_timings: dict[str, float] = {}
_section_outputs: dict[str, str] = {}
_format_timings: dict[str, float] = {}


def _reset_captures() -> None:
    _fetch_timings.clear()
    _section_outputs.clear()
    _format_timings.clear()


def _wrap_async_fetcher(name: str, original):
    async def wrapped(*args, **kwargs):
        t0 = time.perf_counter()
        result = await original(*args, **kwargs)
        _fetch_timings[name] = _fetch_timings.get(name, 0) + (time.perf_counter() - t0) * 1000
        return result
    wrapped.__name__ = original.__name__
    return wrapped


def _wrap_sync_formatter(name: str, original):
    def wrapped(*args, **kwargs):
        t0 = time.perf_counter()
        result = original(*args, **kwargs)
        elapsed = (time.perf_counter() - t0) * 1000
        _format_timings[name] = _format_timings.get(name, 0) + elapsed
        # Capture the rendered text so we can compute per-section chars
        if isinstance(result, str):
            _section_outputs[name] = (_section_outputs.get(name, "")) + ("\n" if _section_outputs.get(name) else "") + result
        return result
    wrapped.__name__ = original.__name__
    return wrapped


def install_patches():
    """Wrap fetchers + formatters at import time. In-process only — no
    file edits to runtime code."""
    import app.services.patient_context_builder as pcb

    fetcher_names = [
        "_get_patient",
        "_get_latest_lab",
        "_get_lab_before_24h",
        "_get_active_medications",
        "_get_latest_vital",
        "_get_latest_vent",
        "_get_recent_reports",
        "_get_latest_scores",
        "_safe_duplicate_warnings",
    ]
    for name in fetcher_names:
        if hasattr(pcb, name):
            original = getattr(pcb, name)
            setattr(pcb, name, _wrap_async_fetcher(name, original))

    formatter_names = [
        "_fmt_patient_section",
        "_fmt_vital_section",
        "_fmt_vent_section",
        "_fmt_lab_section",
        "_fmt_med_section",
        "_fmt_duplicate_section",
        "_fmt_reports_section",
        "_fmt_scores_section",
    ]
    for name in formatter_names:
        if hasattr(pcb, name):
            original = getattr(pcb, name)
            setattr(pcb, name, _wrap_sync_formatter(name, original))


# ---------------------------------------------------------------------------
# DB SELECT counter via SQLAlchemy event
# ---------------------------------------------------------------------------

_select_counter = {"n": 0}


def _on_before_cursor(conn, cursor, statement, parameters, context, executemany):
    if statement.strip().upper().startswith("SELECT"):
        _select_counter["n"] += 1


# ---------------------------------------------------------------------------
# Audit core
# ---------------------------------------------------------------------------

async def audit_one(engine, patient_id: str) -> dict:
    """Run build_clinical_snapshot once and return measurements."""
    from sqlalchemy import text as _sql_text

    from app.services.patient_context_builder import build_clinical_snapshot

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    _reset_captures()
    _select_counter["n"] = 0

    async with Session() as db:
        # Warm-up: AsyncSession lazily acquires a connection on first query.
        # build_clinical_snapshot uses asyncio.gather across many fetchers, all
        # sharing this session — concurrent connection acquisition crashes
        # with "This session is provisioning a new connection". Production
        # avoids this because _get_or_create_session() runs first and warms
        # up the session before gather. We mimic that here so the audit hits
        # the same code path.
        await db.execute(_sql_text("SELECT 1"))
        # The warm-up's SELECT is counted by the listener; subtract 1 at the
        # end so the reported select_count reflects only build_clinical_snapshot.
        _select_counter["n"] = 0

        t0 = time.perf_counter()
        snapshot = await build_clinical_snapshot(patient_id, db)
        t1 = time.perf_counter()

    total_chars = len(snapshot)
    # Mixed CJK + EN: ~3.5 chars/token (CJK ~2, EN ~4 chars/token, weighted)
    estimated_tokens = total_chars / 3.5

    # Per-section breakdown from formatter captures
    section_chars: dict[str, int] = {}
    accounted = 0
    for name, text in _section_outputs.items():
        chars = len(text)
        section_chars[name] = chars
        accounted += chars

    # Header / timestamp / footer / blank-line glue = total - sum(formatted sections)
    glue_chars = max(0, total_chars - accounted)

    return {
        "patient_id": patient_id,
        "total_chars": total_chars,
        "estimated_tokens": estimated_tokens,
        "build_ms": (t1 - t0) * 1000,
        "select_count": _select_counter["n"],
        "section_chars": section_chars,
        "glue_chars": glue_chars,
        "fetch_timings_ms": dict(_fetch_timings),
        "format_timings_ms": dict(_format_timings),
        "snapshot_hash": hashlib.sha256(snapshot.encode("utf-8")).hexdigest()[:16],
        "snapshot_text": snapshot,
    }


def _humanize_section_name(formatter: str) -> str:
    return formatter.replace("_fmt_", "").replace("_section", "")


def print_result(result: dict, *, show_snapshot: bool = False) -> None:
    pid = result["patient_id"]
    total = result["total_chars"]
    print(f"\n=== Patient {pid} ===")
    print(f"  total_chars:       {total:6d}")
    print(f"  estimated_tokens:  {result['estimated_tokens']:6.0f}")
    print(f"  build_ms:          {result['build_ms']:6.0f}")
    print(f"  select_count:      {result['select_count']}")
    print(f"  snapshot_hash:     {result['snapshot_hash']}")

    print(f"\n  Section breakdown (chars / percent / est. tokens):")
    sections = sorted(result["section_chars"].items(), key=lambda x: -x[1])
    for name, chars in sections:
        pct = (chars / total * 100) if total else 0
        tok = chars / 3.5
        label = _humanize_section_name(name)
        print(f"    {label:14} {chars:6d}  {pct:5.1f}%  ~{tok:5.0f} tok")
    glue = result["glue_chars"]
    glue_pct = (glue / total * 100) if total else 0
    print(f"    {'(header/glue)':14} {glue:6d}  {glue_pct:5.1f}%  ~{glue/3.5:5.0f} tok")

    print(f"\n  Per-fetcher time (ms):")
    fetchers = sorted(result["fetch_timings_ms"].items(), key=lambda x: -x[1])
    for name, ms in fetchers:
        print(f"    {name:30} {ms:7.1f} ms")

    print(f"\n  Per-formatter time (ms):")
    formatters = sorted(result["format_timings_ms"].items(), key=lambda x: -x[1])
    for name, ms in formatters:
        label = _humanize_section_name(name)
        print(f"    {label:14} {ms:7.2f} ms")

    if show_snapshot:
        print(f"\n  --- snapshot text ---")
        print(result["snapshot_text"])
        print(f"  --- end snapshot ---")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

async def main_async(patient_ids: list[str], no_stability_check: bool, show_snapshot: bool) -> int:
    install_patches()

    db_url = _get_database_url()
    engine = create_async_engine(
        db_url,
        connect_args={
            "prepared_statement_cache_size": 0,
            "statement_cache_size": 0,
            "command_timeout": 60,
        },
    )

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _hook(conn, cursor, statement, parameters, context, executemany):
        _on_before_cursor(conn, cursor, statement, parameters, context, executemany)

    try:
        all_results = []
        for pid in patient_ids:
            r1 = await audit_one(engine, pid)
            print_result(r1, show_snapshot=show_snapshot)
            all_results.append(r1)

            if not no_stability_check:
                # Same patient, second run — verify byte-stability
                r2 = await audit_one(engine, pid)
                if r1["snapshot_hash"] == r2["snapshot_hash"]:
                    print(f"\n  ✓ stability check: hashes MATCH ({r1['snapshot_hash']})")
                else:
                    print(
                        f"\n  ⚠ stability check: hashes DIFFER\n"
                        f"      run1: {r1['snapshot_hash']} chars={r1['total_chars']}\n"
                        f"      run2: {r2['snapshot_hash']} chars={r2['total_chars']}"
                    )
                    # Try to identify diff
                    s1, s2 = r1["snapshot_text"], r2["snapshot_text"]
                    if len(s1) != len(s2):
                        print(f"      total_chars differ: {len(s1)} vs {len(s2)}")
                    # Find first diff position
                    for i, (a, b) in enumerate(zip(s1, s2)):
                        if a != b:
                            ctx_start = max(0, i - 30)
                            ctx_end = min(len(s1), i + 30)
                            print(f"      first diff at byte {i}:")
                            print(f"        run1: ...{s1[ctx_start:ctx_end]!r}...")
                            print(f"        run2: ...{s2[ctx_start:ctx_end]!r}...")
                            break

        # Summary across patients
        print("\n=== Summary ===")
        print(f"  patients audited: {len(all_results)}")
        for r in all_results:
            print(
                f"    {r['patient_id']}: "
                f"chars={r['total_chars']}, "
                f"tokens~{r['estimated_tokens']:.0f}, "
                f"build_ms={r['build_ms']:.0f}, "
                f"selects={r['select_count']}"
            )
    finally:
        await engine.dispose()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--patients", nargs="+", required=True,
        help="Prod patient IDs to audit (e.g. pat_5219befc pat_b00e859b)",
    )
    parser.add_argument(
        "--no-stability-check", action="store_true",
        help="Skip the second build + hash compare (default is to run twice)",
    )
    parser.add_argument(
        "--show-snapshot", action="store_true",
        help="Dump the full snapshot text for inspection",
    )
    args = parser.parse_args()

    rc = asyncio.run(main_async(args.patients, args.no_stability_check, args.show_snapshot))
    sys.exit(rc)


if __name__ == "__main__":
    main()
