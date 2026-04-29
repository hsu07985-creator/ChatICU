#!/usr/bin/env python3
"""Explicit seed/repair runner for ChatICU.

Phase 4.1 Step 3a — moves the seed/repair side of `app/startup_migrations.py`
into a stand-alone CLI script so it can be invoked deliberately (after a
fresh DB, after a migration window, on a maintenance host) instead of
piggy-backing on the FastAPI lifespan.

This script does NOT touch schema. Schema lives in Alembic. If a column
referenced here is missing, the seed silently skips that row (the underlying
ALTER is non-our-business).

Idempotency: every helper guards on existence — count thresholds, NULL
filters, EXISTS subqueries — so re-running is safe and a converged DB
produces a no-op run.

Status (intentional, for Phase 4.1 Step 3a):
- NOT wired into Procfile (DDI backfill can take 30-60s; not a hard gate)
- NOT replacing app/startup_migrations.py (kept as dual-coverage during transition)
- NOT removing the lifespan hook in app/main.py

Two prod warnings the audit doc called out are FIXED here (vs the runtime bag):
  1. outpatient demo: native ``date`` objects + patients EXISTS guard
  2. diagnostic_reports demo: patients EXISTS guard before each insert

Usage:
    cd backend
    python3 -m scripts.run_seed_repair                  # run everything
    python3 -m scripts.run_seed_repair --dry-run        # preview only
    python3 -m scripts.run_seed_repair --only outpatient_demo
    python3 -m scripts.run_seed_repair --skip ddi_interacting_members
    python3 -m scripts.run_seed_repair --list           # list helper names
"""

from __future__ import annotations

import argparse
import asyncio
import gzip
import hashlib
import json
import logging
import os
import sys
import uuid
from datetime import date as _date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

# Add backend/ to sys.path so `from app...` works when invoked via -m
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

logger = logging.getLogger("seed_repair")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


# ---------------------------------------------------------------------------
# Engine + common helpers
# ---------------------------------------------------------------------------


def _get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    print("ERROR: DATABASE_URL not in env or backend/.env", file=sys.stderr)
    sys.exit(2)


def _make_engine() -> AsyncEngine:
    return create_async_engine(
        _get_database_url(),
        echo=False,
        pool_size=1,
        max_overflow=0,
        # Supabase pooler (transaction mode) — disable prepared statements
        connect_args={
            "prepared_statement_cache_size": 0,
            "statement_cache_size": 0,
            "command_timeout": 120,
        },
    )


_SEEDS_DIR = Path(__file__).resolve().parent.parent / "seeds"


async def _patient_exists(conn: Any, patient_id: str) -> bool:
    return (await conn.scalar(
        text("SELECT 1 FROM patients WHERE id = :pid"),
        {"pid": patient_id},
    )) is not None


async def _patients_exist(conn: Any, patient_ids: list[str]) -> set[str]:
    rows = await conn.execute(
        text("SELECT id FROM patients WHERE id = ANY(:ids)"),
        {"ids": patient_ids},
    )
    return {r[0] for r in rows.fetchall()}


# ---------------------------------------------------------------------------
# 1. culture_results seed (helper #6)
# ---------------------------------------------------------------------------


_CULTURE_SEED = [
    ("pat_001", "M11411L014001", "Sputum", "SP01", "加護病房一",
     "2025-11-10T08:30:00+08:00", "2025-11-13T14:00:00+08:00",
     [{"code": "XORG1", "organism": "Stenotrophomonas maltophilia"}],
     [{"antibiotic": "Levofloxacin", "code": "LVX", "result": "S"},
      {"antibiotic": "Trimethoprim/Sulfamethoxazole", "code": "SXT", "result": "S"}]),
    ("pat_001", "M11411L014002", "Sputum", "SP01", "加護病房一",
     "2025-11-05T06:15:00+08:00", "2025-11-08T10:30:00+08:00",
     [{"code": "XORG2", "organism": "Klebsiella pneumoniae"}],
     [{"antibiotic": "Meropenem", "code": "MEM", "result": "S"},
      {"antibiotic": "Ceftazidime", "code": "CAZ", "result": "R"},
      {"antibiotic": "Piperacillin/Tazobactam", "code": "TZP", "result": "I"},
      {"antibiotic": "Amikacin", "code": "AMK", "result": "S"}]),
    ("pat_001", "M11410L036001", "Blood", "BL01", "加護病房一",
     "2025-10-28T17:00:00+08:00", "2025-10-31T13:00:00+08:00", [], []),
    ("pat_001", "M11410L036002", "Sputum", "SP03", "加護病房一",
     "2025-10-25T09:00:00+08:00", "2025-10-28T11:00:00+08:00", [], []),
    ("pat_002", "M11411L020001", "Blood", "BL01", "加護病房一",
     "2025-11-12T03:00:00+08:00", "2025-11-15T09:30:00+08:00",
     [{"code": "XORG1", "organism": "Escherichia coli"},
      {"code": "XORG2", "organism": "Enterococcus faecalis"}],
     [{"antibiotic": "Ampicillin", "code": "AMP", "result": "R"},
      {"antibiotic": "Ceftriaxone", "code": "CRO", "result": "S"},
      {"antibiotic": "Ciprofloxacin", "code": "CIP", "result": "R"},
      {"antibiotic": "Meropenem", "code": "MEM", "result": "S"},
      {"antibiotic": "Vancomycin", "code": "VAN", "result": "S"}]),
    ("pat_002", "M11411L020002", "Urine(導尿)", "UR024", "加護病房一",
     "2025-11-12T03:10:00+08:00", "2025-11-14T16:00:00+08:00",
     [{"code": "XORG1", "organism": "Escherichia coli"}],
     [{"antibiotic": "Ampicillin", "code": "AMP", "result": "R"},
      {"antibiotic": "Ceftriaxone", "code": "CRO", "result": "S"},
      {"antibiotic": "Ciprofloxacin", "code": "CIP", "result": "R"},
      {"antibiotic": "Nitrofurantoin", "code": "NIT", "result": "S"}]),
    ("pat_002", "M11411L020003", "Blood", "BL01", "加護病房一",
     "2025-11-08T22:00:00+08:00", "2025-11-11T14:00:00+08:00", [], []),
    ("pat_003", "M11411L025001", "Urine(導尿)", "UR024", "加護病房一",
     "2025-11-14T10:00:00+08:00", "2025-11-17T11:00:00+08:00",
     [{"code": "XORG1", "organism": "Candida albicans"}],
     [{"antibiotic": "Fluconazole", "code": "FCA", "result": "S"},
      {"antibiotic": "Amphotericin B", "code": "AMB", "result": "S"},
      {"antibiotic": "Caspofungin", "code": "CAS", "result": "S"}]),
    ("pat_003", "M11411L025002", "Blood", "BL01", "加護病房一",
     "2025-11-14T10:05:00+08:00", "2025-11-17T15:00:00+08:00", [], []),
    ("pat_003", "M11411L025003", "Urine(導尿)", "UR024", "加護病房一",
     "2025-11-08T08:00:00+08:00", "2025-11-10T14:00:00+08:00", [], []),
    ("pat_004", "M11411L030001", "Wound", "WD01", "加護病房一",
     "2025-11-15T14:00:00+08:00", "2025-11-18T10:00:00+08:00",
     [{"code": "XORG1", "organism": "Staphylococcus aureus (MSSA)"}],
     [{"antibiotic": "Oxacillin", "code": "OXA", "result": "S"},
      {"antibiotic": "Vancomycin", "code": "VAN", "result": "S"},
      {"antibiotic": "Clindamycin", "code": "CLI", "result": "S"},
      {"antibiotic": "Trimethoprim/Sulfamethoxazole", "code": "SXT", "result": "S"}]),
    ("pat_004", "M11411L030002", "CSF", "CS01", "加護病房一",
     "2025-11-15T14:30:00+08:00", "2025-11-18T16:00:00+08:00", [], []),
]


async def seed_culture_results(engine: AsyncEngine, dry_run: bool) -> None:
    """Idempotent: skips if already seeded (per-(patient,sheet) check)."""
    async with engine.connect() as conn:
        present = await _patients_exist(conn, sorted({r[0] for r in _CULTURE_SEED}))
        existing_sheets = {
            r[0]: set()
            for r in (await conn.execute(text(
                "SELECT patient_id, sheet_number FROM culture_results "
                "WHERE patient_id = ANY(:ids)"
            ), {"ids": list(present)})).fetchall()
        }
        # Re-run query into proper grouping
        rows = (await conn.execute(text(
            "SELECT patient_id, sheet_number FROM culture_results "
            "WHERE patient_id = ANY(:ids)"
        ), {"ids": list(present) or ['']})).fetchall()
        existing: dict[str, set[str]] = {}
        for pid, sheet in rows:
            existing.setdefault(pid, set()).add(sheet)

    to_insert = [
        row for row in _CULTURE_SEED
        if row[0] in present and row[1] not in existing.get(row[0], set())
    ]
    skipped_missing_patient = [r[1] for r in _CULTURE_SEED if r[0] not in present]

    if skipped_missing_patient:
        logger.info("[culture_results] skipping %d rows (patients not present): %s",
                    len(skipped_missing_patient),
                    ", ".join(sorted({r[0] for r in _CULTURE_SEED if r[0] not in present})))

    if not to_insert:
        logger.info("[culture_results] no new rows to insert (already seeded)")
        return

    logger.info("[culture_results] would insert %d rows", len(to_insert))
    if dry_run:
        return

    async with engine.begin() as conn:
        for pid, sheet, spec, scode, dept, col_at, rep_at, iso, susc in to_insert:
            cid = f"culture_{uuid.uuid4().hex[:12]}"
            await conn.execute(text(
                "INSERT INTO culture_results "
                "(id,patient_id,sheet_number,specimen,specimen_code,department,"
                "collected_at,reported_at,isolates,susceptibility,created_at,updated_at) "
                "VALUES (:id,:pid,:sheet,:spec,:scode,:dept,"
                "CAST(:col_at AS timestamptz),CAST(:rep_at AS timestamptz),"
                "CAST(:iso AS jsonb),CAST(:susc AS jsonb),NOW(),NOW())"
            ).bindparams(
                id=cid, pid=pid, sheet=sheet, spec=spec, scode=scode, dept=dept,
                col_at=col_at, rep_at=rep_at, iso=json.dumps(iso), susc=json.dumps(susc),
            ))
    logger.info("[culture_results] inserted %d rows", len(to_insert))


# ---------------------------------------------------------------------------
# 2. drug_interactions seed (helper #9)
# ---------------------------------------------------------------------------


async def seed_drug_interactions(engine: AsyncEngine, dry_run: bool) -> None:
    """Idempotent: skips if drug_interactions already has > 100 rows."""
    async with engine.connect() as conn:
        count = (await conn.execute(text("SELECT COUNT(*) FROM drug_interactions"))).scalar()
    if count > 100:
        logger.info("[drug_interactions] already has %d rows, skipping seed", count)
        return

    full = _SEEDS_DIR / "drug_interactions_full.json"
    gz = _SEEDS_DIR / "ddi_xd_only.json.gz"
    icu = _SEEDS_DIR / "icu_drug_interactions.json"
    if full.exists():
        seed_path, interactions = full, json.loads(full.read_text("utf-8"))
    elif gz.exists():
        with gzip.open(gz, "rb") as f:
            interactions = json.loads(f.read().decode("utf-8"))
        seed_path = gz
    elif icu.exists():
        seed_path, interactions = icu, json.loads(icu.read_text("utf-8"))
    else:
        logger.info("[drug_interactions] no seed file found, skipping")
        return

    logger.info("[drug_interactions] would seed %d rows from %s", len(interactions), seed_path.name)
    if dry_run:
        return

    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM drug_interactions"))
        inserted = 0
        for ix in interactions:
            dk = ix.get("dedup_key") or "||".join(sorted([ix["drug1"].lower(), ix["drug2"].lower()]))
            _id = "ddi_" + hashlib.sha1(dk.encode()).hexdigest()[:12]
            deps = ix.get("dependencies")
            dtypes = ix.get("dependency_types")
            im = ix.get("interacting_members")
            pm = ix.get("pubmed_ids")
            await conn.execute(text(
                "INSERT INTO drug_interactions "
                "(id, drug1, drug2, severity, mechanism, clinical_effect, management, \"references\", "
                "risk_rating, risk_rating_description, severity_label, reliability_rating, "
                "route_dependency, discussion, footnotes, "
                "dependencies, dependency_types, interacting_members, pubmed_ids, dedup_key, body_hash) "
                "SELECT :id, :d1, :d2, :sev, :mech, :ce, :mgmt, :ref, "
                ":rr, :rrd, :sl, :rl, :rd, :disc, :fnotes, "
                "CAST(:deps AS JSONB), CAST(:dtypes AS JSONB), CAST(:im AS JSONB), CAST(:pmids AS JSONB), :dk, :bh "
                "WHERE NOT EXISTS (SELECT 1 FROM drug_interactions WHERE id = :id)"
            ).bindparams(
                id=_id, d1=ix["drug1"], d2=ix["drug2"], sev=ix["severity"],
                mech=ix.get("mechanism", ""), ce=ix.get("clinical_effect", ""),
                mgmt=ix.get("management", ""), ref=ix.get("references", ""),
                rr=ix.get("risk_rating", ""), rrd=ix.get("risk_rating_description", ""),
                sl=ix.get("severity_label", ""), rl=ix.get("reliability_rating", ""),
                rd=ix.get("route_dependency", ""), disc=ix.get("discussion", ""),
                fnotes=ix.get("footnotes", ""),
                deps=json.dumps(deps, ensure_ascii=False) if deps else None,
                dtypes=json.dumps(dtypes, ensure_ascii=False) if dtypes else None,
                im=json.dumps(im, ensure_ascii=False) if im else None,
                pmids=json.dumps(pm, ensure_ascii=False) if pm else None,
                dk=dk, bh=ix.get("body_hash", ""),
            ))
            inserted += 1
    logger.info("[drug_interactions] inserted %d rows from %s", inserted, seed_path.name)


# ---------------------------------------------------------------------------
# 3. medication notes + concentration seed (helper #12 seed part)
# ---------------------------------------------------------------------------


_MED_NOTES_SEED = [
    ("pat_001", "Morphine", "Morphine 2mg IV Q4H PRN for pain\nif Pain Score > 4, may repeat x1"),
    ("pat_001", "Dormicum", "for Dormicum pump, initial bolus 1cc\nrun 0.4cc/hr-3cc/hr, titrate every hour\nkeep RASS -2~-3"),
    ("pat_001", "Propofol", "Propofol 1% 10mg/mL\nrun 5-30cc/hr, titrate Q30min\nkeep RASS -1~0, hold if MAP < 65"),
    ("pat_002", "Propofol", "Propofol 2% 20mg/mL\nrun 5-20cc/hr\nkeep RASS -2~-1\nhold if MAP < 60 or HR < 50"),
    ("pat_002", "Fentanyl", "for fentanyl pump, initial bolus 1cc\nrun 0.5-6cc/hr, titrate every hour\nkeep RASS -2~-3"),
    ("pat_002", "Cisatracurium", "Cisatracurium 2mg/mL\nrun 1-5cc/hr, titrate by TOF\ntarget TOF 1-2/4"),
    ("pat_002", "Midazolam", "Midazolam 1mg/mL backup\n0.5-3cc/hr if Propofol insufficient\nkeep RASS -2~-1"),
    ("pat_003", "Dexmedetomidine", "Precedex 4mcg/mL\nrun 0.2-1.4mcg/kg/hr\nkeep RASS -1~0, monitor HR"),
    ("pat_003", "Morphine", "Morphine 2mg IV Q4H PRN\nfor breakthrough pain only"),
    ("pat_003", "Fentanyl", "Fentanyl 10mcg/mL\nrun 1-6cc/hr, titrate Q1H\nkeep Pain Score < 4"),
    ("pat_004", "Midazolam", "Midazolam 1mg/mL\nrun 0.5-3cc/hr\nkeep RASS -2~-1\ntitrate Q1H, hold if RR < 10"),
]
_MED_CONC_SEED = [
    ("Morphine", "2mg/1mL inj"),
    ("Dormicum", "15mg/3mL inj"),
    ("Propofol", "200mg/20mL inj"),
    ("Fentanyl", "0.05mg/mL 10mL"),
    ("Cisatracurium", "2mg/mL 5mL"),
    ("Dexmedetomidine", "200mcg/2mL inj"),
    ("Midazolam", "15mg/3mL inj"),
]


async def seed_medication_notes(engine: AsyncEngine, dry_run: bool) -> None:
    """UPDATE medications SET notes/concentration WHERE col IS NULL — idempotent."""
    if dry_run:
        logger.info("[medication_notes] would update notes for %d (pat,med) pairs + concentration for %d drugs",
                    len(_MED_NOTES_SEED), len(_MED_CONC_SEED))
        return

    async with engine.begin() as conn:
        notes_updated = 0
        for pid, med_name, notes in _MED_NOTES_SEED:
            r = await conn.execute(text(
                "UPDATE medications SET notes = :notes "
                "WHERE patient_id = :pid AND name = :name AND notes IS NULL"
            ), {"pid": pid, "name": med_name, "notes": notes})
            notes_updated += r.rowcount or 0

        conc_updated = 0
        for med_name, conc in _MED_CONC_SEED:
            r = await conn.execute(text(
                "UPDATE medications SET concentration = :conc "
                "WHERE name = :name AND concentration IS NULL"
            ), {"name": med_name, "conc": conc})
            conc_updated += r.rowcount or 0

    logger.info("[medication_notes] updated %d notes + %d concentration rows", notes_updated, conc_updated)


# ---------------------------------------------------------------------------
# 4. venous_blood_gas seed (helper #14 seed part)
# ---------------------------------------------------------------------------


_VBG_SEED = {
    "pat_001": {
        "pH": {"value": 7.32, "unit": "", "referenceRange": "7.31-7.41", "status": "normal"},
        "PCO2": {"value": 48.0, "unit": "mmHg", "referenceRange": "41-51", "status": "normal"},
        "PO2": {"value": 38.0, "unit": "mmHg", "referenceRange": "30-50", "status": "normal"},
        "HCO3": {"value": 24.1, "unit": "mEq/L", "referenceRange": "22-26", "status": "normal"},
        "BE": {"value": -1.2, "unit": "mEq/L", "referenceRange": "-2 to 2", "status": "normal"},
        "SO2C": {"value": 68.0, "unit": "%", "referenceRange": "60-80", "status": "normal"},
    },
    "pat_002": {
        "pH": {"value": 7.28, "unit": "", "referenceRange": "7.31-7.41", "status": "low"},
        "PCO2": {"value": 55.0, "unit": "mmHg", "referenceRange": "41-51", "status": "high"},
        "PO2": {"value": 32.0, "unit": "mmHg", "referenceRange": "30-50", "status": "normal"},
        "HCO3": {"value": 25.5, "unit": "mEq/L", "referenceRange": "22-26", "status": "normal"},
        "BE": {"value": -0.5, "unit": "mEq/L", "referenceRange": "-2 to 2", "status": "normal"},
        "SO2C": {"value": 58.0, "unit": "%", "referenceRange": "60-80", "status": "low"},
    },
}


async def seed_venous_blood_gas(engine: AsyncEngine, dry_run: bool) -> None:
    """UPDATE lab_data.venous_blood_gas WHERE col IS NULL — idempotent."""
    if dry_run:
        logger.info("[venous_blood_gas] would update %d patients (pat_001/pat_002)", len(_VBG_SEED))
        return

    async with engine.begin() as conn:
        present = await _patients_exist(conn, list(_VBG_SEED.keys()))
        if not present:
            logger.info("[venous_blood_gas] no target patients present, skipping")
            return
        updated = 0
        for pid, vbg in _VBG_SEED.items():
            if pid not in present:
                continue
            r = await conn.execute(text(
                "UPDATE lab_data SET venous_blood_gas = :vbg "
                "WHERE patient_id = :pid AND venous_blood_gas IS NULL"
            ), {"vbg": json.dumps(vbg), "pid": pid})
            updated += r.rowcount or 0
    logger.info("[venous_blood_gas] updated %d lab_data rows", updated)


# ---------------------------------------------------------------------------
# 5. vital_signs etco2/cvp/icp/cpp + body_weight history (helper #15 seed/repair part)
# ---------------------------------------------------------------------------


_VITAL_DEFAULTS = [
    ("pat_001", {"etco2": 38.0, "cvp": 10.0}),
    ("pat_002", {"etco2": 42.0, "cvp": 9.0}),
    ("pat_004", {"etco2": 40.0, "cvp": 11.0, "icp": 18.0, "cpp": 62.0}),
]
_BW_BASELINE = [("pat_001", 63.2), ("pat_002", 55.0), ("pat_003", 68.5), ("pat_004", 78.0)]
_BW_OFFSETS = {
    "pat_001": [0.3, 0.0, -0.4, -0.2, 0.0],
    "pat_002": [1.5, 1.0, 0.5, 0.2, 0.0],
    "pat_003": [3.5, 2.0, 1.0, 0.5, 0.0],
    "pat_004": [0.0, 0.2, 0.5, 0.3, 0.0],
}


async def seed_vital_signs_data(engine: AsyncEngine, dry_run: bool) -> None:
    """Backfill etco2/cvp/icp/cpp defaults + body_weight history.

    All UPDATEs are idempotent (`WHERE col IS NULL` for fresh, deterministic
    offset spread for body_weight trend). DELETE drops legacy `vs_bw_*`
    orphan rows that early experiments may have created.
    """
    if dry_run:
        logger.info("[vital_signs_data] would update %d patients with vital defaults + body_weight history",
                    len(_VITAL_DEFAULTS) + len(_BW_BASELINE))
        return

    async with engine.begin() as conn:
        present = await _patients_exist(conn, [pid for pid, _ in _BW_BASELINE])

        # Stage 1: backfill etco2/cvp/icp/cpp where NULL
        for pid, defaults in _VITAL_DEFAULTS:
            if pid not in present:
                continue
            set_clause = ", ".join(f"{c} = :{c}" for c in defaults)
            null_clause = " AND ".join(f"{c} IS NULL" for c in defaults)
            params = {**defaults, "pid": pid}
            await conn.execute(text(
                f"UPDATE vital_signs SET {set_clause} "
                f"WHERE patient_id = :pid AND {null_clause}"
            ), params)

        # Stage 2: baseline body_weight where NULL
        for pid, w in _BW_BASELINE:
            if pid not in present:
                continue
            await conn.execute(text(
                "UPDATE vital_signs SET body_weight = :w "
                "WHERE patient_id = :pid AND body_weight IS NULL"
            ), {"w": w, "pid": pid})

        # Stage 3: drop legacy weight-only rows (idempotent)
        await conn.execute(text("DELETE FROM vital_signs WHERE id LIKE 'vs_bw_%'"))

        # Stage 4: spread weight history offsets across existing records (deterministic)
        for pid, base_w in _BW_BASELINE:
            if pid not in present:
                continue
            rows = await conn.execute(text(
                "SELECT id FROM vital_signs WHERE patient_id = :pid "
                "ORDER BY timestamp ASC"
            ), {"pid": pid})
            ids = [r[0] for r in rows.fetchall()]
            offsets = _BW_OFFSETS.get(pid, [0.0])
            for i, rid in enumerate(ids):
                offset = offsets[i] if i < len(offsets) else offsets[-1]
                w = round(base_w + offset, 1)
                await conn.execute(text(
                    "UPDATE vital_signs SET body_weight = :w WHERE id = :id"
                ), {"w": w, "id": rid})

    logger.info("[vital_signs_data] applied (etco2/cvp/icp/cpp defaults + body_weight history)")


# ---------------------------------------------------------------------------
# 6. iv_compatibilities seed (helper #21)
# ---------------------------------------------------------------------------


async def seed_iv_compatibilities(engine: AsyncEngine, dry_run: bool) -> None:
    """Idempotent: skips if iv_compatibilities already has > 10 rows."""
    async with engine.connect() as conn:
        count = (await conn.execute(text("SELECT COUNT(*) FROM iv_compatibilities"))).scalar()
    if count > 10:
        logger.info("[iv_compatibilities] already has %d rows, skipping", count)
        return

    seed_path = _SEEDS_DIR / "icu_y_site_compatibility_v2_lookup.json"
    if not seed_path.exists():
        logger.warning("[iv_compatibilities] seed file not found: %s", seed_path)
        return

    with open(seed_path, encoding="utf-8") as f:
        data = json.load(f)

    def _norm(name: str) -> str:
        n = name.strip()
        if n == "Norepinephrine Bitartrate":
            return "Norepinephrine bitartrate"
        if n == "Lidocaine":
            return "Lidocaine HCl"
        return n

    pair_map: dict = {}
    for sheet_name, sheet in data.get("sheets", {}).items():
        for drug1, row in sheet.get("compatibility", {}).items():
            for drug2, status in row.items():
                if status not in ("C", "I"):
                    continue
                d1, d2 = tuple(sorted([_norm(drug1), _norm(drug2)]))
                if d1 == d2:
                    continue
                key = (d1, d2)
                if key not in pair_map:
                    pair_map[key] = {"compatible": True, "sheets": set(), "has_i": False}
                pair_map[key]["sheets"].add(sheet_name)
                if status == "I":
                    pair_map[key]["compatible"] = False
                    pair_map[key]["has_i"] = True

    logger.info("[iv_compatibilities] would seed %d pairs from %s", len(pair_map), seed_path.name)
    if dry_run:
        return

    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM iv_compatibilities"))
        for (d1, d2), info in pair_map.items():
            _id = "ivc_" + hashlib.sha1(f"{d1}|{d2}".encode()).hexdigest()[:12]
            note = f"科別：{'、'.join(sorted(info['sheets']))}"
            if info["has_i"]:
                note += "（任一科別不相容）"
            await conn.execute(text(
                "INSERT INTO iv_compatibilities (id, drug1, drug2, compatible, solution, notes) "
                "SELECT :id, :d1, :d2, :compat, :sol, :notes "
                "WHERE NOT EXISTS (SELECT 1 FROM iv_compatibilities WHERE id = :id)"
            ).bindparams(id=_id, d1=d1, d2=d2, compat=info["compatible"], sol="icu_y_site", notes=note))
    logger.info("[iv_compatibilities] inserted %d pairs", len(pair_map))


# ---------------------------------------------------------------------------
# 7. DDI interacting_members backfill (helper #22) — idempotent + 60s timeout
# ---------------------------------------------------------------------------


async def patch_ddi_interacting_members(engine: AsyncEngine, dry_run: bool) -> None:
    """Bulk UPDATE drug_interactions.interacting_members where NULL.

    Hard 60s asyncio.wait_for cap. Idempotent (WHERE interacting_members IS NULL).
    Heavy enough to warrant explicit invocation rather than web startup blocking.
    """
    async def _count_nulls() -> int:
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL lock_timeout = '10000'"))
            await conn.execute(text("SET LOCAL statement_timeout = '15000'"))
            return (await conn.execute(text(
                "SELECT COUNT(*) FROM drug_interactions WHERE interacting_members IS NULL"
            ))).scalar()

    try:
        null_count = await asyncio.wait_for(_count_nulls(), timeout=20.0)
    except asyncio.TimeoutError:
        logger.warning("[ddi_interacting_members] timed out waiting for lock, skipping")
        return

    if null_count == 0:
        logger.info("[ddi_interacting_members] already populated, nothing to patch")
        return

    gz = _SEEDS_DIR / "ddi_xd_only.json.gz"
    if not gz.exists():
        logger.info("[ddi_interacting_members] seed file %s not found, skipping", gz.name)
        return

    with gzip.open(gz, "rb") as f:
        interactions = json.loads(f.read().decode("utf-8"))

    rows: list[tuple[str, str]] = []
    for ix in interactions:
        im = ix.get("interacting_members")
        if not im:
            continue
        dk = ix.get("dedup_key") or "||".join(sorted([ix["drug1"].lower(), ix["drug2"].lower()]))
        _id = "ddi_" + hashlib.sha1(dk.encode()).hexdigest()[:12]
        rows.append((_id, json.dumps(im, ensure_ascii=False)))

    if not rows:
        logger.info("[ddi_interacting_members] no rows to patch")
        return

    logger.info("[ddi_interacting_members] would patch %d candidate rows (NULL count: %d)",
                len(rows), null_count)
    if dry_run:
        return

    BATCH_SIZE = 200

    async def _patch_batches() -> int:
        total = 0
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL lock_timeout = '10000'"))
            await conn.execute(text("SET LOCAL statement_timeout = '30000'"))
            for start in range(0, len(rows), BATCH_SIZE):
                chunk = rows[start:start + BATCH_SIZE]
                values_sql_parts = []
                params: dict[str, Any] = {}
                for i, (_id, _im) in enumerate(chunk):
                    values_sql_parts.append(f"(:id{i}, CAST(:im{i} AS JSONB))")
                    params[f"id{i}"] = _id
                    params[f"im{i}"] = _im
                values_sql = ", ".join(values_sql_parts)
                stmt = text(
                    "UPDATE drug_interactions AS d "
                    "SET interacting_members = v.im "
                    f"FROM (VALUES {values_sql}) AS v(id, im) "
                    "WHERE d.id = v.id AND d.interacting_members IS NULL"
                )
                result = await conn.execute(stmt, params)
                total += result.rowcount or 0
        return total

    try:
        patched = await asyncio.wait_for(_patch_batches(), timeout=60.0)
    except asyncio.TimeoutError:
        logger.warning("[ddi_interacting_members] bulk UPDATE timed out at 60s, partial progress retained")
        return

    logger.info("[ddi_interacting_members] patched %d rows", patched)


# ---------------------------------------------------------------------------
# 8. Critical DDI seed (helper #23)
# ---------------------------------------------------------------------------


_CRITICAL_DDI = [
    {
        "drug1": "DOPamine",
        "drug2": "HaloPERidol",
        "risk_rating": "D",
        "severity": "major",
        "risk_rating_description": "Consider therapy modification",
        "severity_label": "Major",
        "reliability_rating": "Intermediate",
        "clinical_effect": (
            "Antipsychotic agents may antagonize the vasopressor effects of DOPamine "
            "by blocking dopaminergic receptors, potentially reducing cardiac output "
            "and blood pressure support in critically ill patients."
        ),
        "management": (
            "If antipsychotic therapy is required in a patient receiving dopamine "
            "vasopressor support, monitor hemodynamic response closely and consider "
            "increasing dopamine dose or switching to a non-dopaminergic vasopressor."
        ),
    },
    {
        "drug1": "DOPamine",
        "drug2": "QUEtiapine",
        "risk_rating": "D",
        "severity": "major",
        "risk_rating_description": "Consider therapy modification",
        "severity_label": "Major",
        "reliability_rating": "Intermediate",
        "clinical_effect": (
            "Antipsychotic agents may antagonize the vasopressor effects of DOPamine "
            "by blocking dopaminergic receptors, potentially reducing cardiac output "
            "and blood pressure support in critically ill patients."
        ),
        "management": (
            "If antipsychotic therapy is required in a patient receiving dopamine "
            "vasopressor support, monitor hemodynamic response closely and consider "
            "increasing dopamine dose or switching to a non-dopaminergic vasopressor."
        ),
    },
    {
        "drug1": "DilTIAZem",
        "drug2": "Beta-Blockers",
        "risk_rating": "D",
        "severity": "major",
        "risk_rating_description": "Consider therapy modification",
        "severity_label": "Major",
        "reliability_rating": "Intermediate",
        "clinical_effect": (
            "Concurrent use of a non-dihydropyridine calcium channel blocker (diltiazem) "
            "and a beta-blocker produces additive inhibition of AV node conduction. "
            "This combination may cause bradycardia, heart block (1st-, 2nd-, or 3rd-degree), "
            "or haemodynamic compromise, particularly in critically ill patients."
        ),
        "management": (
            "Use with caution in ICU. Monitor HR and 12-lead ECG continuously. "
            "If symptomatic bradycardia, PR prolongation ≥ 240 ms, or 2nd/3rd-degree AV block "
            "develops, reduce or discontinue one agent. Consider temporary pacing if needed."
        ),
        "interacting_members": [
            {
                "group_name": "Beta-Blockers",
                "members": [
                    "Bisoprolol", "Carvedilol", "Metoprolol", "Atenolol",
                    "Propranolol", "Esmolol", "Labetalol", "Nebivolol",
                ],
                "exceptions": [],
                "exceptions_note": "",
            },
        ],
    },
    {
        "drug1": "Colchicine",
        "drug2": "Ticagrelor",
        "risk_rating": "D",
        "severity": "major",
        "risk_rating_description": "Consider therapy modification",
        "severity_label": "Major",
        "reliability_rating": "Intermediate",
        "clinical_effect": (
            "Ticagrelor inhibits both P-glycoprotein (P-gp/ABCB1) and CYP3A4, "
            "leading to increased plasma concentrations of colchicine. "
            "This combination may cause colchicine toxicity: nausea, vomiting, "
            "diarrhoea, myopathy, and potentially fatal multi-organ failure."
        ),
        "management": (
            "Avoid concomitant use if possible. If necessary, reduce colchicine dose "
            "by 50% or more and monitor closely for signs of toxicity "
            "(GI symptoms, muscle weakness, CK elevation). "
            "Consider temporary colchicine dose hold if ticagrelor is initiated acutely."
        ),
    },
    {
        "drug1": "Spironolactone",
        "drug2": "Sacubitril and Valsartan",
        "risk_rating": "D",
        "severity": "major",
        "risk_rating_description": "Consider therapy modification",
        "severity_label": "Major",
        "reliability_rating": "Intermediate",
        "clinical_effect": (
            "Combination of spironolactone (potassium-sparing diuretic / aldosterone antagonist) "
            "with sacubitril-valsartan (RAAS inhibitor) significantly increases the risk of "
            "hyperkalaemia, particularly in patients with renal impairment, elderly patients, "
            "or those receiving other potassium-sparing agents. Severe hyperkalaemia may cause "
            "life-threatening arrhythmias."
        ),
        "management": (
            "Monitor serum potassium closely (baseline, within 1 week of initiation, then every "
            "2-4 weeks for the first 3 months, then quarterly). Avoid concomitant potassium "
            "supplements unless deficiency is documented. Consider dose reduction or alternative "
            "diuretic if K+ > 5.5 mmol/L. Discontinue spironolactone if K+ > 6.0 mmol/L."
        ),
    },
]


async def seed_missing_critical_ddi(engine: AsyncEngine, dry_run: bool) -> None:
    """Insert ICU-critical DDI pairs that are absent from the main DDI dataset.

    Idempotent: each row inserted via WHERE NOT EXISTS by deterministic id.
    Bounded by 30s asyncio.wait_for to avoid hanging on lock contention.
    """
    async def _do() -> int:
        inserted = 0
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL lock_timeout = '10000'"))
            await conn.execute(text("SET LOCAL statement_timeout = '30000'"))
            for ix in _CRITICAL_DDI:
                dk = "||".join(sorted([ix["drug1"].lower(), ix["drug2"].lower()]))
                _id = "ddi_" + hashlib.sha1(dk.encode()).hexdigest()[:12]
                im = ix.get("interacting_members")
                r = await conn.execute(text(
                    "INSERT INTO drug_interactions "
                    "(id, drug1, drug2, severity, mechanism, clinical_effect, management, "
                    "risk_rating, risk_rating_description, severity_label, reliability_rating, "
                    "interacting_members, dedup_key) "
                    "SELECT :id, :d1, :d2, :sev, :mech, :ce, :mgmt, "
                    ":rr, :rrd, :sl, :rl, "
                    "CAST(:im AS JSONB), :dk "
                    "WHERE NOT EXISTS (SELECT 1 FROM drug_interactions WHERE id = :id)"
                ).bindparams(
                    id=_id, d1=ix["drug1"], d2=ix["drug2"], sev=ix["severity"],
                    mech=ix.get("mechanism", ""), ce=ix.get("clinical_effect", ""),
                    mgmt=ix.get("management", ""),
                    rr=ix.get("risk_rating", ""), rrd=ix.get("risk_rating_description", ""),
                    sl=ix.get("severity_label", ""), rl=ix.get("reliability_rating", ""),
                    im=json.dumps(im, ensure_ascii=False) if im else None,
                    dk=dk,
                ))
                inserted += r.rowcount or 0
        return inserted

    if dry_run:
        logger.info("[critical_ddi] would attempt to insert %d critical pairs", len(_CRITICAL_DDI))
        return

    try:
        n = await asyncio.wait_for(_do(), timeout=30.0)
    except asyncio.TimeoutError:
        logger.warning("[critical_ddi] timed out waiting for lock, skipping")
        return
    logger.info("[critical_ddi] inserted %d new critical pairs (others already present)", n)


# ---------------------------------------------------------------------------
# 9. Outpatient demo seed (helper #25) — FIXES audit warning #1
# ---------------------------------------------------------------------------


# FIX #1 (audit warning): start_date/end_date are now native ``date`` objects
# so asyncpg accepts them for the DATE column. Previously these were ISO
# strings and triggered ``invalid input ... 'str' object has no attribute
# 'toordinal'`` on every startup.
_OUTPATIENT_DEMO = [
    ("med_opd_001", "pat_001", "Tamsulosin", "Tamsulosin HCl", "0.4", "mg", "QD", "PO",
     "BPH (良性攝護腺肥大)", _date(2025, 9, 15), _date(2026, 3, 15), "active",
     "outpatient", "仁愛", "臺北市立聯合醫院", "泌尿科", "張德揚", 28, False),
    ("med_opd_002", "pat_001", "Amlodipine", "Amlodipine Besylate", "5", "mg", "QD", "PO",
     "Hypertension (高血壓)", _date(2025, 6, 1), _date(2026, 6, 1), "active",
     "outpatient", "中興", "臺北市立聯合醫院", "心臟內科", "王建民", 28, False),
    ("med_opd_003", "pat_001", "Metformin", "Metformin HCl", "500", "mg", "BID", "PO",
     "DM type 2 (第二型糖尿病)", _date(2025, 4, 10), _date(2026, 4, 10), "active",
     "outpatient", "陽明", "臺北市立聯合醫院", "新陳代謝科", "陳美玲", 28, False),
    ("med_opd_004", "pat_001", "Atorvastatin", "Atorvastatin Calcium", "20", "mg", "QD HS", "PO",
     "Hyperlipidemia (高血脂)", _date(2025, 7, 20), _date(2026, 7, 20), "active",
     "outpatient", "忠孝", "臺北市立聯合醫院", "心臟內科", "林志明", 28, False),
]


async def seed_outpatient_demo(engine: AsyncEngine, dry_run: bool) -> None:
    """Seed 4 outpatient demo medications for pat_001.

    FIX #2 (audit warning): EXISTS guard on patients(pat_001). Previously
    this would fire the FK violation warning whenever pat_001 wasn't seeded
    (typical for a fresh DB with HIS-only patients). Now we log + skip cleanly.
    """
    async with engine.connect() as conn:
        if not await _patient_exists(conn, "pat_001"):
            logger.info("[outpatient_demo] pat_001 not present in DB, skipping cleanly")
            return

    if dry_run:
        logger.info("[outpatient_demo] would insert up to %d rows for pat_001", len(_OUTPATIENT_DEMO))
        return

    async with engine.begin() as conn:
        inserted = 0
        for m in _OUTPATIENT_DEMO:
            exists = (await conn.execute(
                text("SELECT 1 FROM medications WHERE id = :id"), {"id": m[0]}
            )).fetchone()
            if exists:
                continue
            await conn.execute(text(
                "INSERT INTO medications "
                "(id, patient_id, name, generic_name, dose, unit, frequency, route, "
                "indication, start_date, end_date, status, "
                "source_type, source_campus, prescribing_hospital, "
                "prescribing_department, prescribing_doctor_name, days_supply, is_external) "
                "VALUES (:id, :pid, :name, :gn, :dose, :unit, :freq, :route, "
                ":ind, :sd, :ed, :st, :src, :campus, :hosp, :dept, :doc, :days, :ext)"
            ), {
                "id": m[0], "pid": m[1], "name": m[2], "gn": m[3],
                "dose": m[4], "unit": m[5], "freq": m[6], "route": m[7],
                "ind": m[8], "sd": m[9], "ed": m[10], "st": m[11],
                "src": m[12], "campus": m[13], "hosp": m[14], "dept": m[15],
                "doc": m[16], "days": m[17], "ext": m[18],
            })
            inserted += 1
    logger.info("[outpatient_demo] inserted %d new rows (existing skipped)", inserted)


# ---------------------------------------------------------------------------
# 10. diagnostic_reports demo seed (helper #26 seed part) — FIXES audit warning #2
# ---------------------------------------------------------------------------


_TZ8 = timezone(timedelta(hours=8))


def _diag_demos() -> dict[str, list[tuple]]:
    return {
        "pat_001": [
            ("rpt_001", "imaging", "CT Without C.M. Brain", datetime(2025, 10, 20, 10, 30, tzinfo=_TZ8),
             "CT of head without contrast enhancement shows:\n- s/p right lateral ventricle drainage. s/p left craniotomy and a left burr hole.\n- brain atrophy with prominent sulci, fissures and ventricles.\n- confluent hypodensity at the periventricular white matter.\n- old insult in the left patietal-occipital-temporal lobes.\n- lacunes at bilateral basal ganglia, thalami, and pons.\n- atherosclerosis with mural calcification in the intracranial arteries.",
             "Brain atrophy. old insults and lacunes. post-operative changes.\nSuggest clinical correlation.",
             "RAD12-王志明"),
            ("rpt_002", "imaging", "Chest X-ray (Portable)", datetime(2025, 10, 18, 8, 15, tzinfo=_TZ8),
             "Portable AP view of the chest:\n- ETT tip at approximately 3 cm above the carina.\n- NG tube tip in the stomach.\n- Right subclavian CVC with tip in the SVC.\n- Bilateral diffuse ground-glass opacities, more prominent in the lower lobes.\n- No pneumothorax identified.\n- Mild cardiomegaly.",
             "Bilateral diffuse infiltrates, compatible with ARDS or pulmonary edema.\nLines and tubes in satisfactory position.",
             "RAD08-陳怡安"),
            ("rpt_003", "procedure", "清醒腦波 EEG", datetime(2025, 11, 5, 14, 0, tzinfo=_TZ8),
             "Indication: conscious change\n\nFinding:\n1. Diffuse background slowing, theta predominant (5-6 Hz, 20-30 uV).\n2. Beta wave: 14-16 Hz, 5-10 uV.\n3. Hyperventilation: cannot cooperate.\n4. Photic sensitivity: no photic drive response.\n5. No epiletiform discharge.\n\nConclusion: the EEG findings suggest diffuse cortical dysfunction.",
             "Diffuse cortical dysfunction. No epileptiform discharge.",
             "DAX32-廖岐禮"),
            ("rpt_004", "procedure", "Echocardiography (TTE)", datetime(2025, 10, 25, 11, 0, tzinfo=_TZ8),
             "Transthoracic echocardiography:\n- LV systolic function: mildly reduced, estimated EF 45%.\n- LV wall motion: global hypokinesis.\n- RV size and function: normal.\n- Valvular: mild MR, mild TR. No significant AS or AI.\n- No pericardial effusion.\n- IVC: dilated with <50% respiratory variation, estimated RAP 10-15 mmHg.",
             "Mildly reduced LV systolic function with global hypokinesis (EF ~45%).\nMild MR/TR. Elevated estimated RAP.",
             "CV05-林書豪"),
            ("rpt_005", "imaging", "Chest CT with contrast", datetime(2025, 11, 10, 9, 45, tzinfo=_TZ8),
             "CT chest with IV contrast:\n- No pulmonary embolism identified.\n- Bilateral pleural effusions, moderate on right, small on left.\n- Bilateral dependent consolidations, likely atelectasis vs infection.\n- Diffuse ground-glass opacity in both lungs.\n- Mediastinal lymph nodes, borderline size (short axis up to 10mm).\n- ETT, CVC and NG tube in satisfactory position.",
             "No PE. Bilateral pleural effusions and consolidations.\nDifferential includes atelectasis, infection, or ARDS.",
             "RAD12-王志明"),
        ],
        "pat_002": [
            ("rpt_006", "imaging", "Chest X-ray (Portable)", datetime(2025, 11, 2, 7, 30, tzinfo=_TZ8),
             "Portable AP view of the chest:\n- ETT tip 4 cm above the carina.\n- Right IJV CVC with tip in the SVC.\n- NG tube tip in the stomach.\n- Bilateral diffuse alveolar infiltrates, worse on the right.\n- Small bilateral pleural effusions.\n- No pneumothorax.",
             "Bilateral alveolar infiltrates with small pleural effusions.\nConsider ARDS vs fluid overload in the setting of septic shock.",
             "RAD08-陳怡安"),
            ("rpt_007", "imaging", "CT Abdomen & Pelvis with contrast", datetime(2025, 11, 3, 14, 20, tzinfo=_TZ8),
             "CT abdomen and pelvis with IV contrast:\n- Diffuse bowel wall thickening involving the ascending and transverse colon.\n- Mild pericolonic fat stranding.\n- Bilateral small pleural effusions with adjacent atelectasis.\n- Mild ascites in the pelvis.\n- No free air or abscess formation.\n- Liver, spleen, and pancreas appear unremarkable.\n- Bilateral kidneys show normal size with mildly delayed nephrogram.",
             "Diffuse colitis with pericolonic inflammatory changes.\nDifferential: infectious colitis, ischemic colitis.\nNo drainable abscess or free air.",
             "RAD12-王志明"),
            ("rpt_008", "procedure", "Echocardiography (TTE)", datetime(2025, 11, 4, 10, 0, tzinfo=_TZ8),
             "Transthoracic echocardiography:\n- LV systolic function: hyperdynamic, estimated EF 70%.\n- LV wall motion: normal.\n- RV size and function: mildly dilated, TAPSE 14mm (mildly reduced).\n- Valvular: trace MR, mild TR (estimated RVSP 42 mmHg).\n- No pericardial effusion.\n- IVC: dilated 2.3 cm with <50% respiratory variation.",
             "Hyperdynamic LV function (sepsis physiology).\nMild RV dysfunction with elevated RVSP.\nElevated estimated RAP.",
             "CV05-林書豪"),
            ("rpt_009", "imaging", "Chest CT with contrast (CTPA)", datetime(2025, 11, 6, 9, 0, tzinfo=_TZ8),
             "CT pulmonary angiography:\n- No pulmonary embolism.\n- Bilateral moderate pleural effusions with compressive atelectasis.\n- Diffuse ground-glass opacity in both lungs, compatible with ARDS.\n- Mediastinal lymphadenopathy (short axis up to 12mm).\n- ETT, CVC in satisfactory position.\n- Small pericardial effusion.",
             "No PE. Bilateral ARDS pattern with pleural effusions.\nReactive mediastinal lymphadenopathy.\nSmall pericardial effusion.",
             "RAD12-王志明"),
        ],
        "pat_003": [
            ("rpt_010", "imaging", "Chest X-ray (Portable)", datetime(2025, 10, 28, 6, 45, tzinfo=_TZ8),
             "Portable AP view of the chest:\n- No ETT. NG tube tip in the stomach.\n- Right subclavian double-lumen dialysis catheter with tip in the RA.\n- Bilateral perihilar haziness with Kerley B lines.\n- Bilateral pleural effusions, moderate.\n- Upper lobe pulmonary venous distention.\n- Cardiomegaly (CTR ~0.60).",
             "Pulmonary edema with bilateral pleural effusions.\nCardiomegaly. Dialysis catheter in satisfactory position.",
             "RAD08-陳怡安"),
            ("rpt_011", "imaging", "Renal Ultrasound", datetime(2025, 10, 29, 10, 30, tzinfo=_TZ8),
             "Renal ultrasound:\n- Right kidney: 10.2 cm, normal cortical thickness, no hydronephrosis.\n- Left kidney: 10.5 cm, normal cortical thickness, no hydronephrosis.\n- Bilateral increased renal cortical echogenicity.\n- No renal mass or calculus identified.\n- Bladder: Foley catheter in situ, minimal residual.",
             "Bilateral increased renal cortical echogenicity, compatible with medical renal disease.\nNo hydronephrosis or obstructive uropathy.",
             "RAD15-張雅婷"),
            ("rpt_012", "procedure", "Echocardiography (TTE)", datetime(2025, 10, 30, 11, 30, tzinfo=_TZ8),
             "Transthoracic echocardiography:\n- LV systolic function: preserved, estimated EF 55%.\n- Concentric LV hypertrophy (IVSd 13mm).\n- Diastolic dysfunction: E/e' ratio 18 (Grade II).\n- Valvular: moderate MR, mild TR.\n- Moderate pericardial effusion without tamponade physiology.\n- IVC: dilated 2.5 cm, no respiratory variation.",
             "Preserved LVEF with concentric hypertrophy.\nGrade II diastolic dysfunction (elevated filling pressure).\nModerate pericardial effusion. Volume overload physiology.",
             "CV05-林書豪"),
            ("rpt_013", "imaging", "Chest X-ray post-HD", datetime(2025, 11, 1, 16, 0, tzinfo=_TZ8),
             "Portable AP view of the chest (post-hemodialysis):\n- Dialysis catheter unchanged.\n- Interval improvement of pulmonary edema.\n- Decreased bilateral pleural effusions.\n- Persistent cardiomegaly.\n- No new consolidation or pneumothorax.",
             "Interval improvement of pulmonary edema post-hemodialysis.\nPersistent cardiomegaly and small residual effusions.",
             "RAD08-陳怡安"),
        ],
        "pat_004": [
            ("rpt_014", "imaging", "CT Without C.M. Brain", datetime(2025, 11, 12, 2, 15, tzinfo=_TZ8),
             "Non-contrast CT of the head (trauma protocol):\n- Right frontotemporal acute epidural hematoma (max thickness 15mm).\n- Midline shift 6mm to the left.\n- Right temporal bone linear fracture.\n- Diffuse cerebral edema with effacement of sulci and basal cisterns.\n- No intraventricular hemorrhage.\n- Pneumocephalus in the right frontal region.",
             "Acute right frontotemporal epidural hematoma with mass effect.\nMidline shift 6mm. Right temporal bone fracture.\nDiffuse cerebral edema. Neurosurgical emergency.",
             "RAD12-王志明"),
            ("rpt_015", "imaging", "CT C-spine without contrast", datetime(2025, 11, 12, 2, 30, tzinfo=_TZ8),
             "Non-contrast CT of the cervical spine:\n- No acute cervical spine fracture or dislocation.\n- Mild degenerative changes at C5-C6 and C6-C7.\n- Prevertebral soft tissue within normal limits.\n- Spinal canal patent at all levels.\n- Bilateral vertebral artery foramina intact.",
             "No acute cervical spine injury.\nMild degenerative changes at C5-C7.",
             "RAD12-王志明"),
            ("rpt_016", "imaging", "CT Brain post-op follow-up", datetime(2025, 11, 13, 8, 0, tzinfo=_TZ8),
             "Non-contrast CT of the head (post-craniotomy):\n- s/p right frontotemporal craniotomy for EDH evacuation.\n- Residual thin subdural collection along the right convexity (5mm).\n- Improved midline shift (now 2mm).\n- Persistent diffuse cerebral edema.\n- Right frontal EVD catheter with tip in the frontal horn of the right lateral ventricle.\n- Pneumocephalus decreased compared to prior.",
             "Post-craniotomy changes with near-complete EDH evacuation.\nResidual thin subdural collection. Improved mass effect.\nEVD in satisfactory position.",
             "RAD08-陳怡安"),
            ("rpt_017", "procedure", "清醒腦波 EEG", datetime(2025, 11, 16, 14, 0, tzinfo=_TZ8),
             "Indication: post-traumatic brain injury, consciousness evaluation\n\nFinding:\n1. Background: diffuse theta-delta slowing (3-5 Hz, 20-50 uV), no posterior dominant rhythm.\n2. Right hemisphere: intermittent polymorphic delta activity (IPDA) over right frontotemporal region.\n3. Reactivity: minimal attenuation with painful stimulation.\n4. No definite epileptiform discharges.\n5. No electrographic seizures recorded during 30 minutes of monitoring.\n\nConclusion: severe diffuse encephalopathy with right hemispheric emphasis, consistent with structural lesion.",
             "Severe diffuse encephalopathy with focal right hemispheric dysfunction.\nNo epileptiform discharges or electrographic seizures.",
             "DAX32-廖岐禮"),
            ("rpt_018", "imaging", "Chest X-ray (Portable)", datetime(2025, 11, 14, 7, 0, tzinfo=_TZ8),
             "Portable AP view of the chest:\n- ETT tip 3.5 cm above the carina.\n- NG tube tip in the stomach.\n- Right subclavian CVC with tip in the SVC.\n- Lungs: clear bilateral lung fields.\n- No pleural effusion or pneumothorax.\n- Heart size normal.",
             "Lines and tubes in satisfactory position.\nNo acute cardiopulmonary abnormality.",
             "RAD08-陳怡安"),
        ],
    }


async def seed_diagnostic_reports(engine: AsyncEngine, dry_run: bool) -> None:
    """Seed demo diagnostic reports for pat_001..pat_004.

    FIX #2 (audit warning): EXISTS guard per patient before insert. Previously
    fired ``ForeignKeyViolationError: pat_001 not present in patients`` on
    every fresh-DB startup. Now we log + skip cleanly per-patient.
    """
    demos_by_patient = _diag_demos()
    async with engine.connect() as conn:
        present = await _patients_exist(conn, list(demos_by_patient.keys()))

    skipped = sorted(set(demos_by_patient.keys()) - present)
    if skipped:
        logger.info("[diagnostic_reports] skipping %d patient(s) not present: %s",
                    len(skipped), ", ".join(skipped))

    targets = {pid: rows for pid, rows in demos_by_patient.items() if pid in present}
    total_rows = sum(len(rs) for rs in targets.values())
    logger.info("[diagnostic_reports] %d candidate rows across %d patients",
                total_rows, len(targets))

    if dry_run or not targets:
        return

    inserted = 0
    async with engine.begin() as conn:
        for pid, rows in targets.items():
            for d in rows:
                exists = (await conn.execute(
                    text("SELECT 1 FROM diagnostic_reports WHERE id = :id"),
                    {"id": d[0]},
                )).fetchone()
                if exists:
                    continue
                await conn.execute(text(
                    "INSERT INTO diagnostic_reports "
                    "(id, patient_id, report_type, exam_name, exam_date, body_text, impression, reporter_name) "
                    "VALUES (:id, :pid, :rt, :en, :ed, :bt, :imp, :rn)"
                ), {
                    "id": d[0], "pid": pid, "rt": d[1], "en": d[2],
                    "ed": d[3], "bt": d[4], "imp": d[5], "rn": d[6],
                })
                inserted += 1
    logger.info("[diagnostic_reports] inserted %d new rows", inserted)


# ---------------------------------------------------------------------------
# Registry + CLI
# ---------------------------------------------------------------------------

REPAIRS: list[tuple[str, Callable[[AsyncEngine, bool], Awaitable[None]]]] = [
    ("culture_results", seed_culture_results),
    ("drug_interactions", seed_drug_interactions),
    ("medication_notes", seed_medication_notes),
    ("venous_blood_gas", seed_venous_blood_gas),
    ("vital_signs_data", seed_vital_signs_data),
    ("iv_compatibilities", seed_iv_compatibilities),
    ("ddi_interacting_members", patch_ddi_interacting_members),
    ("critical_ddi", seed_missing_critical_ddi),
    ("outpatient_demo", seed_outpatient_demo),
    ("diagnostic_reports", seed_diagnostic_reports),
]


async def main_async(only: list[str] | None, skip: list[str] | None, dry_run: bool) -> int:
    selected = [(name, fn) for name, fn in REPAIRS
                if (not only or name in only) and (not skip or name not in skip)]
    if not selected:
        logger.error("No helpers selected (check --only/--skip)")
        return 2

    mode = "DRY-RUN" if dry_run else "EXECUTE"
    logger.info("=== run_seed_repair %s — %d helper(s) ===", mode, len(selected))

    engine = _make_engine()
    failed: list[str] = []
    try:
        for name, fn in selected:
            logger.info("--- %s ---", name)
            try:
                await fn(engine, dry_run)
            except Exception as e:
                logger.exception("[%s] FAILED: %s", name, e)
                failed.append(name)
    finally:
        await engine.dispose()

    if failed:
        logger.error("=== run_seed_repair %s complete — FAILURES: %s ===", mode, ", ".join(failed))
        return 1
    logger.info("=== run_seed_repair %s complete — all OK ===", mode)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview actions without writing to the DB")
    parser.add_argument("--only", nargs="*", metavar="NAME",
                        help="Only run these helpers (by registry name)")
    parser.add_argument("--skip", nargs="*", metavar="NAME",
                        help="Skip these helpers (by registry name)")
    parser.add_argument("--list", action="store_true",
                        help="List all registered helpers and exit")
    args = parser.parse_args()

    if args.list:
        print("Registered helpers (run order):")
        for name, _ in REPAIRS:
            print(f"  {name}")
        return

    rc = asyncio.run(main_async(args.only, args.skip, args.dry_run))
    sys.exit(rc)


if __name__ == "__main__":
    main()
