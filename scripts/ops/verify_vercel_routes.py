#!/usr/bin/env python3
"""C4 (architecture-audit-2026-07-19): vercel.json route-parity gate.

The Vercel proxy whitelists top-level path prefixes. A new backend router
whose prefix is missing from vercel.json fails SILENTLY in production —
the SPA catch-all returns index.html with HTTP 200 instead of proxying.

This script enumerates the real FastAPI route table (imports the app, so it
needs backend deps + a valid backend env — run it from CI's backend job or a
dev machine) and asserts every top-level segment is covered by a rewrite.

Usage: python3 scripts/ops/verify_vercel_routes.py   (from repo root)
"""
import json
import os
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

# Paths served by FastAPI but intentionally NOT proxied through Vercel.
EXEMPT_SEGMENTS = {
    "",              # root info endpoint — SPA owns "/" in production
    "docs",          # swagger UI (dev only)
    "openapi.json",
    "redoc",
}


def backend_top_segments() -> set:
    os.chdir(REPO_ROOT / "backend")
    sys.path.insert(0, str(REPO_ROOT / "backend"))
    from app.main import app  # noqa: PLC0415 — deliberate late import

    segments = set()
    for route in app.routes:
        path = getattr(route, "path", "") or ""
        seg = path.strip("/").split("/")[0]
        if seg not in EXEMPT_SEGMENTS:
            segments.add(seg)
    return segments


def vercel_covered_segments() -> set:
    config = json.loads((REPO_ROOT / "vercel.json").read_text())
    covered = set()
    for rule in config.get("rewrites", []):
        dest = rule.get("destination", "")
        if "railway" not in dest and "chaticu" not in dest:
            continue  # SPA catch-all etc.
        source = rule.get("source", "")
        seg = source.strip("/").split("/")[0]
        seg = seg.replace(":path*", "").rstrip("*")
        if seg:
            covered.add(seg)
    return covered


def main() -> int:
    backend = backend_top_segments()
    covered = vercel_covered_segments()
    missing = sorted(backend - covered)
    if missing:
        print("FAIL: backend route prefixes NOT proxied by vercel.json:")
        for seg in missing:
            print(f"  /{seg}  → production requests will get SPA HTML (200), not the API")
        print("Add a rewrite for each prefix in vercel.json (see existing entries).")
        return 1
    print(f"OK: all {len(backend)} backend top-level prefixes covered by vercel.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
