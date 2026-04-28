#!/usr/bin/env python3
"""upgrade_xd_from_lexicomp.py — Add missing X/D drug-drug interactions from
Lexicomp dump into Supabase, never modifying existing rows.

Workflow:
    1. Read Lexicomp dump folder (per-drug X/D json files).
    2. Deduplicate via detail_url -> 4,408 unique X/D pairs.
    3. Load existing Supabase X/D and expand class rules via interacting_members.
    4. Filter Lexicomp pairs already covered (strict dedup_key OR semantic
       strip-parens match OR class expansion).
    5. Map remaining pairs into Supabase schema.
    6. Either dry-run (write JSON report) or INSERT ON CONFLICT (id) DO NOTHING.

Usage:
    python3 backend/scripts/upgrade_xd_from_lexicomp.py --dry-run
    python3 backend/scripts/upgrade_xd_from_lexicomp.py --apply

Safety:
    - Uses INSERT ... ON CONFLICT (id) DO NOTHING -> existing rows untouched.
    - All new rows tagged references='Lexicomp 2026' for traceability.
    - Rollback: DELETE FROM drug_interactions WHERE references='Lexicomp 2026'.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

LEXICOMP_DIR = Path(
    "/Users/chun/Desktop/逆轉腎agent/knowledge_base/drug_database/api/交互作用/interactions"
)
ENV_FILE = Path(__file__).resolve().parent.parent / ".env.his-sync"
REPORTS_DIR = Path(__file__).resolve().parent.parent.parent / "reports"
SOURCE_TAG = "Lexicomp 2026"

RISK_TO_SEVERITY = {"X": "contraindicated", "D": "major"}
RISK_TO_DESCRIPTION = {
    "X": "Avoid combination",
    "D": "Consider therapy modification",
}


def load_db_url() -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"DATABASE_URL not in {ENV_FILE}")


def lex_strict_key(d1: str, d2: str) -> str:
    """Same formula as backend/scripts/import_interactions.py."""
    return "||".join(sorted([d1.lower(), d2.lower()]))


def lex_loose_key(d1: str, d2: str) -> str:
    """Strip parens for semantic-match checks (avoid duplicate semantics)."""
    def strip(s: str) -> str:
        s = re.sub(r"\s*\([^)]*\)\s*", " ", s)
        s = re.sub(r"\s+", " ", s).strip().lower()
        return s
    return "||".join(sorted([strip(d1), strip(d2)]))


# Hand-curated synonyms: Lexicomp full name -> Supabase common name.
# Conservative — only well-known cases where Supabase consistently uses
# the short form. Adding bad entries can mask real new drug pairs.
SYNONYM_MAP = {
    "Acetylsalicylic Acid (Aspirin)": "Aspirin",
    "Acetylsalicylic Acid": "Aspirin",
}


def canonical_name(raw: str) -> str:
    """Map Lexicomp drug name to the Supabase canonical form.

    Default: keep raw (preserve Lexicomp display). Only override via
    SYNONYM_MAP. The `loose` and `expanded` coverage checks compensate
    for the parens-vs-no-parens mismatch.
    """
    if not raw:
        return raw
    s = raw.strip()
    return SYNONYM_MAP.get(s, s)


def normalize_footnotes(fn) -> str:
    if not fn:
        return ""
    if isinstance(fn, list):
        return "\n".join(str(x) for x in fn)
    return str(fn)


def make_id(dedup_key: str) -> str:
    return "ddi_" + hashlib.sha1(dedup_key.encode()).hexdigest()[:12]


def make_body_hash(mechanism: str, management: str, summary: str) -> str:
    body = (mechanism or "") + "|" + (management or "") + "|" + (summary or "")
    return hashlib.md5(body.encode()).hexdigest()


def collect_lexicomp_xd() -> list[dict]:
    """Walk Lexicomp dump and return unique X/D pairs (by detail_url)."""
    folders = [d for d in os.listdir(LEXICOMP_DIR) if (LEXICOMP_DIR / d).is_dir()]
    seen_urls: set[str] = set()
    out: list[dict] = []
    for folder in folders:
        for risk in ("X", "D"):
            p = LEXICOMP_DIR / folder / f"{folder}_{risk}.json"
            if not p.exists():
                continue
            try:
                data = json.loads(p.read_text())
            except Exception as e:
                print(f"  WARN: failed to load {p.name}: {e}", file=sys.stderr)
                continue
            for ix in data.get("interactions", []):
                url = ix.get("detail_url")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                detail = ix.get("detail", {}) or {}
                out.append({
                    "lex_query": ix.get("query_drug", ""),
                    "lex_inter": ix.get("interacting_drug", ""),
                    "risk": risk,
                    "detail_url": url,
                    "title": detail.get("title", ""),
                    "severity_label": detail.get("severity", ""),
                    "reliability": detail.get("reliability", ""),
                    "summary": detail.get("summary", ""),
                    "patient_management": detail.get("patient_management", ""),
                    "discussion": detail.get("discussion", ""),
                    "footnotes": detail.get("footnotes", []),
                })
    return out


async def load_supabase_xd(engine):
    async with engine.connect() as c:
        r = await c.execute(text(
            "SELECT id, dedup_key, drug1, drug2, risk_rating, "
            "interacting_members FROM drug_interactions "
            "WHERE risk_rating IN ('X','D')"
        ))
        rows = []
        for row in r:
            rows.append({
                "id": row.id,
                "dedup_key": row.dedup_key,
                "drug1": row.drug1,
                "drug2": row.drug2,
                "risk_rating": row.risk_rating,
                "interacting_members": row.interacting_members,
            })
    return rows


def build_supabase_coverage(rows: list[dict]) -> tuple[set, set, set]:
    """Return (strict_keys, loose_keys, expanded_keys)."""
    strict = set()
    loose = set()
    expanded = set()
    for r in rows:
        if r["dedup_key"]:
            strict.add(r["dedup_key"])
            loose.add(lex_loose_key(r["drug1"] or "", r["drug2"] or ""))
        # expand class
        side1 = {r["drug1"] or ""}
        side2 = {r["drug2"] or ""}
        members = r["interacting_members"]
        if isinstance(members, str):
            try:
                members = json.loads(members)
            except Exception:
                members = None
        # Format may be dict (raw seed) or list (post-insert pattern)
        if isinstance(members, dict):
            for gn, mems in members.items():
                if gn.lower() == (r["drug1"] or "").lower():
                    side1.update(mems)
                elif gn.lower() == (r["drug2"] or "").lower():
                    side2.update(mems)
        elif isinstance(members, list):
            for grp in members:
                if not isinstance(grp, dict):
                    continue
                gn = grp.get("group_name", "")
                mems = grp.get("members", []) or []
                if gn.lower() == (r["drug1"] or "").lower():
                    side1.update(mems)
                elif gn.lower() == (r["drug2"] or "").lower():
                    side2.update(mems)
        for a in side1:
            for b in side2:
                if a and b:
                    expanded.add(lex_loose_key(a, b))
    return strict, loose, expanded


def build_candidates(lex_rows: list[dict], strict: set, loose: set, expanded: set):
    """Return (to_insert: list[dict], skip_reason_counts: Counter)."""
    to_insert = []
    skip = Counter()
    seen_dedup = set()
    for lr in lex_rows:
        d1 = canonical_name(lr["lex_query"])
        d2 = canonical_name(lr["lex_inter"])
        strict_k = lex_strict_key(d1, d2)
        loose_k = lex_loose_key(d1, d2)
        # Already exact match
        if strict_k in strict:
            skip["existing_strict"] += 1
            continue
        # Semantic match (strip parens)
        if loose_k in loose:
            skip["existing_loose"] += 1
            continue
        # Class-expansion match
        if loose_k in expanded:
            skip["covered_by_class"] += 1
            continue
        # Dedup within Lexicomp itself
        if strict_k in seen_dedup:
            skip["lex_self_dup"] += 1
            continue
        seen_dedup.add(strict_k)
        # Build row
        risk = lr["risk"]
        severity = RISK_TO_SEVERITY[risk]
        risk_desc = RISK_TO_DESCRIPTION[risk]
        mechanism = lr["summary"]  # Lexicomp summary doubles as mechanism
        clinical_effect = lr["summary"]
        management = lr["patient_management"]
        discussion = lr["discussion"]
        footnotes = normalize_footnotes(lr["footnotes"])
        new_row = {
            "id": make_id(strict_k),
            "drug1": d1,
            "drug2": d2,
            "severity": severity,
            "mechanism": mechanism,
            "clinical_effect": clinical_effect,
            "management": management,
            "references": SOURCE_TAG,
            "risk_rating": risk,
            "risk_rating_description": risk_desc,
            "severity_label": lr["severity_label"],
            "reliability_rating": lr["reliability"],
            "route_dependency": "",
            "discussion": discussion,
            "footnotes": footnotes,
            "dependencies": None,
            "dependency_types": None,
            "interacting_members": None,
            "pubmed_ids": None,
            "dedup_key": strict_k,
            "body_hash": make_body_hash(mechanism, management, lr["summary"]),
            "drug1_atc": None,
            "drug2_atc": None,
            # debug-only (not persisted)
            "_lex_query": lr["lex_query"],
            "_lex_inter": lr["lex_inter"],
            "_detail_url": lr["detail_url"],
            "_title": lr["title"],
        }
        to_insert.append(new_row)
    return to_insert, skip


async def insert_rows(engine, rows: list[dict]) -> tuple[int, int]:
    inserted = 0
    skipped = 0
    cols = [
        "id", "drug1", "drug2", "severity", "mechanism", "clinical_effect",
        "management", "references", "risk_rating", "risk_rating_description",
        "severity_label", "reliability_rating", "route_dependency",
        "discussion", "footnotes", "dependencies", "dependency_types",
        "interacting_members", "pubmed_ids", "dedup_key", "body_hash",
        "drug1_atc", "drug2_atc", "updated_at",
    ]
    placeholders = ", ".join(f":{c}" for c in cols)
    col_names = ", ".join(f'"{c}"' for c in cols)
    stmt = text(
        f"INSERT INTO drug_interactions ({col_names}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (id) DO NOTHING"
    )
    BATCH = 200
    now = datetime.now(timezone.utc)
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        async with engine.begin() as conn:
            for r in batch:
                payload = {k: r.get(k) for k in cols if k != "updated_at"}
                payload["updated_at"] = now
                # JSON-encode the JSONB columns explicitly
                for j_col in ("dependencies", "dependency_types",
                              "interacting_members", "pubmed_ids"):
                    if payload[j_col] is not None:
                        payload[j_col] = json.dumps(payload[j_col],
                                                     ensure_ascii=False)
                result = await conn.execute(stmt.bindparams(**payload))
                if result.rowcount > 0:
                    inserted += 1
                else:
                    skipped += 1
        print(f"  batch {i//BATCH + 1}: inserted={inserted}, skipped={skipped}",
              end="\r")
    print()
    return inserted, skipped


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="No DB writes; output candidates JSON.")
    parser.add_argument("--apply", action="store_true",
                        help="Actually INSERT into DB.")
    parser.add_argument("--report-dir", default=str(REPORTS_DIR),
                        help="Where to write candidate JSON / summary.")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        parser.error("Pass either --dry-run or --apply")

    print(f"[1/4] Loading Lexicomp dump from {LEXICOMP_DIR}")
    lex_rows = collect_lexicomp_xd()
    print(f"      Lexicomp X/D unique pairs (by detail_url): {len(lex_rows)}")

    print(f"[2/4] Loading Supabase X/D rows")
    db_url = load_db_url()
    engine = create_async_engine(db_url, connect_args={
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
    })
    sb_rows = await load_supabase_xd(engine)
    print(f"      Supabase X/D rows: {len(sb_rows)}")

    print(f"[3/4] Building coverage sets and candidates")
    strict, loose, expanded = build_supabase_coverage(sb_rows)
    print(f"      strict_keys={len(strict)}, loose_keys={len(loose)}, "
          f"expanded_keys={len(expanded)}")

    candidates, skip_counts = build_candidates(lex_rows, strict, loose, expanded)
    print(f"      candidates to insert: {len(candidates)}")
    for k, v in skip_counts.most_common():
        print(f"        skip[{k}]={v}")

    risk_dist = Counter(c["risk_rating"] for c in candidates)
    print(f"      candidate risk dist: X={risk_dist.get('X',0)}, "
          f"D={risk_dist.get('D',0)}")

    # Always write the report
    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = report_dir / f"lexicomp_xd_candidates_{stamp}.json"
    md_path = report_dir / f"lexicomp_xd_candidates_{stamp}.md"

    json_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2))
    print(f"\n[4/4] Wrote candidates to {json_path}")

    # Markdown summary
    lines = [
        f"# Lexicomp X/D upgrade candidates ({stamp})",
        "",
        f"- Source: `{LEXICOMP_DIR}`",
        f"- Lexicomp X/D pairs: **{len(lex_rows)}**",
        f"- Supabase X/D rows: **{len(sb_rows)}**",
        f"- Coverage strict={len(strict)}, loose={len(loose)}, expanded={len(expanded)}",
        f"- **Candidates to INSERT: {len(candidates)}** (X={risk_dist.get('X',0)}, D={risk_dist.get('D',0)})",
        "",
        "## Skip reasons",
    ]
    for k, v in skip_counts.most_common():
        lines.append(f"- `{k}`: {v}")
    lines += ["", "## First 50 candidates", "", "| Risk | Drug 1 | Drug 2 | Title |", "|---|---|---|---|"]
    for c in candidates[:50]:
        title = (c.get("_title") or "").replace("|", "/")
        lines.append(f"| {c['risk_rating']} | {c['drug1']} | {c['drug2']} | {title} |")

    md_path.write_text("\n".join(lines))
    print(f"      Wrote summary to {md_path}")

    if args.apply:
        if not candidates:
            print("Nothing to insert.")
            await engine.dispose()
            return
        confirm = os.environ.get("CONFIRM_APPLY", "")
        if confirm != "YES":
            print("\n  ⚠ To proceed with INSERT, set env CONFIRM_APPLY=YES and re-run.")
            await engine.dispose()
            return
        # Strip debug fields from rows before insert
        for c in candidates:
            for k in list(c.keys()):
                if k.startswith("_"):
                    c.pop(k)
        print(f"\n[APPLY] Inserting {len(candidates)} rows into drug_interactions...")
        inserted, skipped = await insert_rows(engine, candidates)
        print(f"[APPLY] Done: inserted={inserted}, skipped={skipped}")

        # Verify ("references" is a PG reserved word — must quote the column)
        async with engine.connect() as c:
            r = await c.execute(text(
                'SELECT COUNT(*) FROM drug_interactions WHERE "references"=:src'
            ), {"src": SOURCE_TAG})
            n = r.scalar_one()
            print(f"[VERIFY] rows with references='{SOURCE_TAG}': {n}")
            r = await c.execute(text(
                "SELECT risk_rating, COUNT(*) FROM drug_interactions "
                "GROUP BY risk_rating ORDER BY COUNT(*) DESC"
            ))
            print("[VERIFY] risk_rating distribution:")
            for row in r:
                print(f"   {row.risk_rating!r}: {row[1]}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
