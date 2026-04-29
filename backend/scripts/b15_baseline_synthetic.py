#!/usr/bin/env python3
"""B15 Phase 0 — Synthetic prod traffic for TTFT / cache_hit baseline.

Read-only against user data. Writes:
- 1 bot user (b15-baseline-bot, idempotent upsert)
- N ai_session rows (cleaned up by --cleanup)
- 2*N ai_message rows (cleaned up by --cleanup)

Generates ``[CHAT][TIMING]`` and ``[CHAT][CACHE]`` log lines on Railway
so we can compute TTFT / cache_hit_ratio statistics.

A-lite scope: 2 patients × 3 question sets × 3 turns = 18 calls.

Usage::

    cd backend

    # 1. run synthetic traffic (creates bot, makes 18 calls, ~3-5 min)
    python3 scripts/b15_baseline_synthetic.py --run

    # 2. wait ~30s for Railway log to flush, then analyze
    python3 scripts/b15_baseline_synthetic.py --analyze

    # 3. clean up bot data when done
    python3 scripts/b15_baseline_synthetic.py --cleanup
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import statistics
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Add backend/ to sys.path so `from app...` works when invoked via -m
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROD_API_BASE = "https://chaticu-production-8060.up.railway.app"

BOT_USER_ID = "usr_b15_bot"
BOT_USERNAME = "b15-baseline-bot"
BOT_NAME = "B15 Baseline Bot"
BOT_EMAIL = "b15-bot@chaticu.local"
BOT_ROLE = "doctor"  # doctor role passes role check on /ai/chat/stream
BOT_UNIT = "ICU"

MARKER = "[B15_BASELINE_2026_04_30]"

# Real prod patients (verified earlier in session via Playwright snapshot)
PATIENTS = [
    "pat_5219befc",  # 廖○賢 I-01 (39M, ICH)
    "pat_b00e859b",  # 周○鄉 I-17 (61F, septic shock)
]

# 3 question-sets per patient, 3 turns each → 9 turns per patient × 2 patients = 18 calls
QUESTION_SETS = [
    [
        f"{MARKER} 病人最近 K+ trend 怎樣？有需要立即處理的異常嗎？",
        "目前是否需要 K+ correction？",
        "如果要 IV K+ correction，建議劑量？",
    ],
    [
        f"{MARKER} 目前在用什麼 vasopressor？dose 多少？",
        "最近 24h 有調整嗎？",
        "如果要 wean off，建議步驟？",
    ],
    [
        f"{MARKER} 最近影像 finding 有什麼重點？",
        "有什麼 follow-up 建議？",
        "需不需要重新 image？",
    ],
]


# ---------------------------------------------------------------------------
# DB helpers (read prod via .env.his-sync — same pattern as other scripts)
# ---------------------------------------------------------------------------

def _get_database_url() -> str:
    """Read DATABASE_URL from .env.his-sync (prod Supabase pooler)."""
    env_path = Path(__file__).resolve().parent.parent / ".env.his-sync"
    if not env_path.exists():
        print(
            "ERROR: backend/.env.his-sync not found — needed for prod DB access",
            file=sys.stderr,
        )
        sys.exit(2)
    for line in env_path.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return url
    raise RuntimeError("DATABASE_URL not found in .env.his-sync")


def _make_engine():
    return create_async_engine(
        _get_database_url(),
        connect_args={
            "prepared_statement_cache_size": 0,
            "statement_cache_size": 0,
            "command_timeout": 60,
        },
    )


# ---------------------------------------------------------------------------
# Bot-user lifecycle
# ---------------------------------------------------------------------------

async def upsert_bot_user(engine, password: str) -> None:
    """Idempotent upsert of the b15-baseline-bot user with a fresh password."""
    from app.utils.security import hash_password
    pwd_hash = hash_password(password)

    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO users (
                    id, username, name, password_hash, email,
                    role, unit, active, created_at, updated_at
                )
                VALUES (
                    :id, :username, :name, :pw, :email,
                    :role, :unit, true, NOW(), NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    role = EXCLUDED.role,
                    active = true,
                    updated_at = NOW()
                """
            ),
            {
                "id": BOT_USER_ID,
                "username": BOT_USERNAME,
                "name": BOT_NAME,
                "pw": pwd_hash,
                "email": BOT_EMAIL,
                "role": BOT_ROLE,
                "unit": BOT_UNIT,
            },
        )
    print(f"  [bot] upserted user {BOT_USER_ID} ({BOT_USERNAME})")


async def cleanup_bot_data(engine, drop_user: bool = False) -> None:
    """Remove all bot-generated ai_messages + ai_sessions. Optionally drop user."""
    async with engine.begin() as conn:
        # Cascade: ai_messages → ai_sessions (FK in 001 schema with CASCADE)
        # but we delete explicitly to print counts.
        r1 = await conn.execute(
            text(
                """
                DELETE FROM ai_messages
                WHERE session_id IN (
                    SELECT id FROM ai_sessions WHERE user_id = :uid
                )
                """
            ),
            {"uid": BOT_USER_ID},
        )
        r2 = await conn.execute(
            text("DELETE FROM ai_sessions WHERE user_id = :uid"),
            {"uid": BOT_USER_ID},
        )
        if drop_user:
            r3 = await conn.execute(
                text("DELETE FROM users WHERE id = :uid"),
                {"uid": BOT_USER_ID},
            )
            print(
                f"  [cleanup] deleted {r1.rowcount} ai_messages, "
                f"{r2.rowcount} ai_sessions, {r3.rowcount} users"
            )
        else:
            print(
                f"  [cleanup] deleted {r1.rowcount} ai_messages, "
                f"{r2.rowcount} ai_sessions (bot user kept inactive — "
                f"use --cleanup-drop-user to remove)"
            )


# ---------------------------------------------------------------------------
# HTTP / SSE helpers
# ---------------------------------------------------------------------------

async def login(client: httpx.AsyncClient, password: str) -> None:
    """Authenticate as bot. httpx.AsyncClient cookie jar persists chaticu_access."""
    r = await client.post(
        "/auth/login",
        json={"username": BOT_USERNAME, "password": password},
    )
    if r.status_code != 200:
        print(f"ERROR: login failed: {r.status_code} {r.text}", file=sys.stderr)
        sys.exit(1)
    print(f"  [auth] login OK as {BOT_USERNAME}")


async def chat_call(
    client: httpx.AsyncClient,
    patient_id: str,
    session_id: Optional[str],
    message: str,
) -> dict[str, Any]:
    """Make one streaming chat call. Returns {sessionId, request_id, elapsed_ms,
    error?}.

    Drains the entire SSE stream so the server-side ``[CHAT][TIMING]`` and
    ``[CHAT][CACHE]`` lines are both emitted.
    """
    body: dict[str, Any] = {"message": message, "patientId": patient_id}
    if session_id:
        body["sessionId"] = session_id

    request_id = f"b15-{uuid.uuid4().hex[:8]}"
    headers = {"X-Request-ID": request_id}

    out_session_id = session_id
    error: Optional[str] = None

    t0 = time.perf_counter()
    async with client.stream(
        "POST", "/ai/chat/stream", json=body, headers=headers, timeout=60.0
    ) as resp:
        if resp.status_code != 200:
            txt = await resp.aread()
            return {
                "request_id": request_id,
                "session_id": session_id,
                "elapsed_ms": (time.perf_counter() - t0) * 1000,
                "error": f"HTTP {resp.status_code}: {txt[:200]!r}",
            }
        # Parse SSE: alternating "event: NAME\ndata: <json>\n\n" frames
        current_event: Optional[str] = None
        async for raw_line in resp.aiter_lines():
            if not raw_line:
                current_event = None
                continue
            if raw_line.startswith("event:"):
                current_event = raw_line[6:].strip()
            elif raw_line.startswith("data:"):
                payload_str = raw_line[5:].strip()
                if not payload_str:
                    continue
                try:
                    payload = json.loads(payload_str)
                except json.JSONDecodeError:
                    continue
                if current_event == "done":
                    out_session_id = payload.get("sessionId") or out_session_id
                elif current_event == "error":
                    error = payload.get("message", "unknown error")
    t1 = time.perf_counter()
    return {
        "request_id": request_id,
        "session_id": out_session_id,
        "elapsed_ms": (t1 - t0) * 1000,
        "error": error,
    }


# ---------------------------------------------------------------------------
# Run mode
# ---------------------------------------------------------------------------

async def cmd_run() -> int:
    print(f"=== B15 A-lite synthetic baseline run @ {datetime.now(timezone.utc).isoformat()} ===")
    print(f"  patients   : {PATIENTS}")
    print(f"  question sets: {len(QUESTION_SETS)} per patient")
    print(f"  turns/set  : {len(QUESTION_SETS[0])}")
    n_calls = len(PATIENTS) * len(QUESTION_SETS) * len(QUESTION_SETS[0])
    print(f"  total calls: {n_calls}")
    print()

    engine = _make_engine()
    password = secrets.token_urlsafe(24)
    try:
        await upsert_bot_user(engine, password)
    finally:
        await engine.dispose()

    summary: list[dict[str, Any]] = []
    async with httpx.AsyncClient(base_url=PROD_API_BASE, timeout=70.0) as client:
        await login(client, password)
        idx = 0
        for patient_id in PATIENTS:
            for q_set_idx, questions in enumerate(QUESTION_SETS):
                session_id: Optional[str] = None
                for turn_idx, msg in enumerate(questions):
                    idx += 1
                    print(
                        f"  [{idx:02d}/{n_calls}] patient={patient_id[-6:]} "
                        f"set={q_set_idx + 1} turn={turn_idx + 1} ... ",
                        end="",
                        flush=True,
                    )
                    result = await chat_call(client, patient_id, session_id, msg)
                    if result.get("error"):
                        print(f"ERROR ({result['error']})")
                    else:
                        session_id = result["session_id"]
                        print(f"{result['elapsed_ms']:.0f}ms (req={result['request_id']})")
                    summary.append(
                        {
                            "idx": idx,
                            "patient_id": patient_id,
                            "set": q_set_idx + 1,
                            "turn": turn_idx + 1,
                            "request_id": result["request_id"],
                            "session_id": result["session_id"],
                            "elapsed_ms": result["elapsed_ms"],
                            "error": result.get("error"),
                        }
                    )
                    # Light spacing to be polite to the API + give logger time to flush
                    await asyncio.sleep(1.5)

    # Persist run summary so --analyze can correlate
    out_path = Path(__file__).resolve().parent.parent / ".state" / "b15_baseline_run.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print()
    print(f"  ✓ run complete; client-side summary saved to {out_path}")

    n_ok = sum(1 for s in summary if not s.get("error"))
    n_err = len(summary) - n_ok
    elapsed_vals = [s["elapsed_ms"] for s in summary if not s.get("error")]
    if elapsed_vals:
        med = statistics.median(elapsed_vals)
        p95 = sorted(elapsed_vals)[int(0.95 * len(elapsed_vals)) - 1] if len(elapsed_vals) >= 2 else elapsed_vals[-1]
        print(f"  client-side end-to-end: {n_ok} ok, {n_err} err, median={med:.0f}ms p95={p95:.0f}ms")
        print(
            "  (this is wall-clock; the load-bearing numbers come from"
            " server-side [CHAT][TIMING] — run --analyze next)"
        )
    return 0 if n_err == 0 else 1


# ---------------------------------------------------------------------------
# Analyze mode
# ---------------------------------------------------------------------------

_TIMING_RE = re.compile(
    r"\[CHAT\]\[TIMING\]\s*"
    r"(?:session=([\d.]+)ms\s+)?"
    r"(?:snapshot=([\d.]+)ms\s+)?"
    r"(?:pre_llm=([\d.]+)ms\s+)?"
    r"ttft=([\d.]+)ms\s*"
    r"(?:total=([\d.]+)ms\s+)?"
    r"sys_prompt_chars=(\d+)"
)
_CACHE_RE = re.compile(
    r"\[CHAT\]\[CACHE\]\s+"
    r"prompt_tokens=(\d+)\s+"
    r"cached_tokens=(\d+)\s+"
    r"hit_ratio=([\d.]+)%\s+"
    r"completion_tokens=(\d+)"
)


def _percentile(vals: list[float], pct: float) -> float:
    if not vals:
        return float("nan")
    s = sorted(vals)
    k = max(0, min(len(s) - 1, int(round(pct * (len(s) - 1)))))
    return s[k]


def _stat_summary(label: str, vals: list[float], unit: str = "") -> str:
    if not vals:
        return f"  {label:24} n=0"
    return (
        f"  {label:24} n={len(vals):3d}  "
        f"p50={_percentile(vals, 0.50):8.0f}{unit}  "
        f"p95={_percentile(vals, 0.95):8.0f}{unit}  "
        f"p99={_percentile(vals, 0.99):8.0f}{unit}  "
        f"min={min(vals):8.0f}{unit}  "
        f"max={max(vals):8.0f}{unit}"
    )


def cmd_analyze() -> int:
    print(f"=== B15 A-lite analyze @ {datetime.now(timezone.utc).isoformat()} ===")
    print("  fetching railway logs --since 1h --lines 5000 ...")
    proc = subprocess.run(
        ["railway", "logs", "--since", "1h", "--lines", "5000"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        print(f"  WARN: railway logs returned {proc.returncode}: {proc.stderr[:200]}", file=sys.stderr)
    log_text = proc.stdout
    print(f"  fetched {len(log_text.splitlines())} log lines")

    timings: list[dict[str, float]] = []
    caches: list[dict[str, float]] = []
    for line in log_text.splitlines():
        m = _TIMING_RE.search(line)
        if m:
            timings.append(
                {
                    "session_ms": float(m.group(1)) if m.group(1) else None,
                    "snapshot_ms": float(m.group(2)) if m.group(2) else None,
                    "pre_llm_ms": float(m.group(3)) if m.group(3) else None,
                    "ttft_ms": float(m.group(4)),
                    "total_ms": float(m.group(5)) if m.group(5) else None,
                    "sys_prompt_chars": int(m.group(6)),
                }
            )
            continue
        m = _CACHE_RE.search(line)
        if m:
            caches.append(
                {
                    "prompt_tokens": float(m.group(1)),
                    "cached_tokens": float(m.group(2)),
                    "hit_ratio_pct": float(m.group(3)),
                    "completion_tokens": float(m.group(4)),
                }
            )

    print()
    print(f"  [CHAT][TIMING] sample count: {len(timings)}")
    print(f"  [CHAT][CACHE] sample count : {len(caches)}")
    print()

    print("=== TIMING (server-side) ===")
    for key, unit in [
        ("ttft_ms", "ms"),
        ("snapshot_ms", "ms"),
        ("pre_llm_ms", "ms"),
        ("session_ms", "ms"),
        ("total_ms", "ms"),
        ("sys_prompt_chars", " chars"),
    ]:
        vals = [t[key] for t in timings if t.get(key) is not None]
        print(_stat_summary(key, vals, unit))

    print()
    print("=== CACHE ===")
    for key, unit in [
        ("prompt_tokens", " tok"),
        ("cached_tokens", " tok"),
        ("hit_ratio_pct", "%"),
        ("completion_tokens", " tok"),
    ]:
        vals = [c[key] for c in caches]
        print(_stat_summary(key, vals, unit))

    # Persist analyze output for the doc to consume
    out_path = Path(__file__).resolve().parent.parent / ".state" / "b15_baseline_analyze.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "timings_n": len(timings),
                "caches_n": len(caches),
                "timings": timings,
                "caches": caches,
            },
            indent=2,
        )
    )
    print()
    print(f"  raw samples written to {out_path}")
    return 0


# ---------------------------------------------------------------------------
# Cleanup mode
# ---------------------------------------------------------------------------

async def cmd_cleanup(drop_user: bool) -> int:
    print(f"=== B15 A-lite cleanup @ {datetime.now(timezone.utc).isoformat()} ===")
    engine = _make_engine()
    try:
        await cleanup_bot_data(engine, drop_user=drop_user)
    finally:
        await engine.dispose()
    return 0


# ---------------------------------------------------------------------------
# CLI entry
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--run", action="store_true", help="Run synthetic traffic (18 calls)")
    parser.add_argument("--analyze", action="store_true", help="Pull Railway logs and compute stats")
    parser.add_argument("--cleanup", action="store_true", help="Delete bot ai_sessions + ai_messages")
    parser.add_argument(
        "--cleanup-drop-user",
        action="store_true",
        help="Also delete the b15-baseline-bot user row (use after final run)",
    )
    args = parser.parse_args()

    if not (args.run or args.analyze or args.cleanup or args.cleanup_drop_user):
        parser.print_help()
        sys.exit(2)

    if args.run:
        sys.exit(asyncio.run(cmd_run()))
    if args.analyze:
        sys.exit(cmd_analyze())
    if args.cleanup or args.cleanup_drop_user:
        sys.exit(asyncio.run(cmd_cleanup(drop_user=args.cleanup_drop_user)))


if __name__ == "__main__":
    main()
