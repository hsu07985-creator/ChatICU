"""Startup DB migration fallbacks for Railway deployment.

Railway's Alembic chain sometimes breaks, so these idempotent fallbacks
ensure the schema and seed data are correct regardless of migration state.
All operations are best-effort (non-fatal on failure).
"""

import asyncio
import gzip
import json
import hashlib
import logging
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger("chaticu")


async def run_all(engine: AsyncEngine) -> None:
    """Run all startup migration fallbacks sequentially."""
    # Drop role constraint FIRST (before anything else can fail)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_users_role_valid') THEN
                        ALTER TABLE users DROP CONSTRAINT ck_users_role_valid;
                    END IF;
                END $$
            """))
            logger.info("Dropped ck_users_role_valid constraint (np role support)")
    except Exception as e:
        logger.warning("Failed to drop role constraint: %s", e)
    await _ensure_updated_at_columns(engine)
    await _ensure_ai_messages_feedback(engine)
    await _ensure_culture_results(engine)
    await _fix_gender_swap(engine)
    await _ensure_drug_interaction_columns(engine)
    await _seed_drug_interactions(engine)
    await _ensure_symptom_records(engine)
    await _ensure_custom_tags(engine)
    await _ensure_medication_notes(engine)
    await _ensure_culture_extra_columns(engine)
    await _ensure_venous_blood_gas(engine)
    await _ensure_vital_signs_advanced(engine)
    await _ensure_medication_source_columns(engine)
    await _ensure_medication_order_code(engine)
    await _ensure_patient_campus(engine)
    await _seed_outpatient_demo(engine)
    await _ensure_diagnostic_reports(engine)
    await _migrate_vpn_letter_codes(engine)
    await _clear_messages_once(engine)
    await _ensure_np_role(engine)
    await _seed_iv_compatibilities(engine)
    # 2026-04-14 re-enabled after bulk-UPDATE refactor. Old loop did 1839
    # sequential UPDATEs in a single transaction (~500ms RTT each = ~15 min
    # blocking Railway startup → /health 502). Now batched via
    # `UPDATE ... FROM (VALUES ...)` (200 rows per stmt = ~10 roundtrips total),
    # measured ~9s end-to-end against Supabase prod. Hard 60s asyncio.wait_for
    # cap + 30s statement_timeout bound the worst case.
    await _patch_ddi_interacting_members(engine)
    await _seed_missing_critical_ddi(engine)
    await _ensure_performance_indexes(engine)
    await _ensure_sync_status_table(engine)


async def _ensure_updated_at_columns(engine: AsyncEngine) -> None:
    tables = [
        "users", "audit_logs", "patients", "medications", "lab_data",
        "vital_signs", "ventilator_settings", "ventilator_modes",
        "messages", "chat_messages", "drug_interactions", "iv_compatibilities",
        "pharmacy_advices", "ai_sessions", "medication_administrations",
        "error_reports", "record_templates", "sync_status",
    ]
    try:
        for tbl in tables:
            try:
                async with engine.begin() as conn:
                    await conn.execute(text(
                        f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"
                    ))
            except Exception:
                pass
    except Exception as e:
        logger.warning("[INTG][DB] updated_at column check failed (non-fatal): %s", e)


async def _ensure_ai_messages_feedback(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS feedback VARCHAR(10)"
            ))
    except Exception:
        pass


async def _ensure_sync_status_table(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sync_status (
                    key VARCHAR(100) PRIMARY KEY,
                    source VARCHAR(50) NOT NULL,
                    version VARCHAR(100) NOT NULL,
                    last_synced_at TIMESTAMPTZ NOT NULL,
                    details JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_sync_status_source ON sync_status(source)"
            ))
    except Exception as e:
        logger.warning("[INTG][DB] sync_status bootstrap failed (non-fatal): %s", e)


async def _ensure_culture_results(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            exists = await conn.scalar(text(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='culture_results')"
            ))
            if not exists:
                logger.info("[INTG][DB] Creating culture_results table (migration 024 fallback)")
                await conn.execute(text("""
                    CREATE TABLE culture_results (
                        id VARCHAR(50) PRIMARY KEY,
                        patient_id VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
                        sheet_number VARCHAR(50) NOT NULL,
                        specimen VARCHAR(100) NOT NULL,
                        specimen_code VARCHAR(20) NOT NULL,
                        department VARCHAR(100) NOT NULL DEFAULT '',
                        collected_at TIMESTAMPTZ,
                        reported_at TIMESTAMPTZ,
                        isolates JSONB,
                        susceptibility JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_culture_results_patient_id ON culture_results(patient_id)"
                ))
                await _seed_culture_results(conn)
    except Exception as e:
        logger.warning("[INTG][DB] culture_results bootstrap failed (non-fatal): %s", e)


async def _seed_culture_results(conn: Any) -> None:
    seed_cultures = [
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
    for pid, sheet, spec, scode, dept, col_at, rep_at, iso, susc in seed_cultures:
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
    logger.info("[INTG][DB] Seeded %d culture results", len(seed_cultures))


async def _fix_gender_swap(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "UPDATE patients SET gender = '女' WHERE id = 'pat_002' AND gender = '男'"
            ))
            await conn.execute(text(
                "UPDATE patients SET gender = '男' WHERE id = 'pat_003' AND gender = '女'"
            ))
            logger.info("[INTG][DB] Gender fix applied for pat_002/pat_003 (migration 026 fallback)")
    except Exception as e:
        logger.warning("[INTG][DB] Gender fix failed (non-fatal): %s", e)


async def _ensure_drug_interaction_columns(engine: AsyncEngine) -> None:
    new_cols = [
        ("risk_rating", "VARCHAR(2)"),
        ("risk_rating_description", "VARCHAR(100)"),
        ("severity_label", "VARCHAR(30)"),
        ("reliability_rating", "VARCHAR(30)"),
        ("route_dependency", "TEXT"),
        ("discussion", "TEXT"),
        ("footnotes", "TEXT"),
    ]
    try:
        async with engine.begin() as conn:
            for col_name, col_type in new_cols:
                try:
                    await conn.execute(text(
                        f"ALTER TABLE drug_interactions ADD COLUMN {col_name} {col_type}"
                    ))
                except Exception:
                    pass
        logger.info("[INTG][DB] drug_interactions enrichment columns ensured (migration 027 fallback)")
    except Exception as e:
        logger.warning("[INTG][DB] drug_interactions column migration failed (non-fatal): %s", e)


async def _seed_drug_interactions(engine: AsyncEngine) -> None:
    try:
        # Ensure migration-028 columns exist
        new_cols_028 = [
            ("dependencies", "TEXT"), ("dependency_types", "TEXT"),
            ("interacting_members", "TEXT"), ("pubmed_ids", "TEXT"),
            ("dedup_key", "VARCHAR(300)"), ("body_hash", "VARCHAR(32)"),
        ]
        for col, ctype in new_cols_028:
            try:
                async with engine.begin() as conn:
                    await conn.execute(text(
                        f"ALTER TABLE drug_interactions ADD COLUMN IF NOT EXISTS {col} {ctype}"
                    ))
            except Exception:
                pass

        async with engine.connect() as conn:
            count = (await conn.execute(text("SELECT COUNT(*) FROM drug_interactions"))).scalar()

        if count > 100:
            logger.info("[INTG][DB] drug_interactions already has %d rows, skipping seed", count)
            return

        seeds_dir = Path(__file__).resolve().parents[1] / "seeds"
        full_seed = seeds_dir / "drug_interactions_full.json"
        gz_seed = seeds_dir / "ddi_xd_only.json.gz"
        icu_seed = seeds_dir / "icu_drug_interactions.json"

        if full_seed.exists():
            seed_path = full_seed
            interactions = json.loads(full_seed.read_text("utf-8"))
        elif gz_seed.exists():
            seed_path = gz_seed
            with gzip.open(gz_seed, "rb") as _gz:
                interactions = json.loads(_gz.read().decode("utf-8"))
        elif icu_seed.exists():
            seed_path = icu_seed
            interactions = json.loads(icu_seed.read_text("utf-8"))
        else:
            return
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM drug_interactions"))
            inserted = 0
            for ix in interactions:
                dk = ix.get("dedup_key", "")
                if not dk:
                    dk = "||".join(sorted([ix["drug1"].lower(), ix["drug2"].lower()]))
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
                    id=_id,
                    d1=ix["drug1"], d2=ix["drug2"], sev=ix["severity"],
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
            logger.info("[INTG][DB] Seeded %d drug interactions from %s", inserted, seed_path.name)
    except Exception as e:
        logger.warning("[INTG][DB] Drug interactions seed failed (non-fatal): %s", e)


async def _ensure_symptom_records(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS symptom_records (
                    id VARCHAR(50) PRIMARY KEY,
                    patient_id VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
                    recorded_at TIMESTAMPTZ NOT NULL,
                    symptoms JSONB,
                    recorded_by JSONB,
                    notes VARCHAR(1000),
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_symptom_records_patient_id ON symptom_records (patient_id)"
            ))
            logger.info("[INTG][DB] symptom_records table ensured")
    except Exception as e:
        logger.warning("[INTG][DB] Failed to ensure symptom_records: %s", e)


async def _ensure_custom_tags(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS custom_tags (
                    id VARCHAR(50) PRIMARY KEY,
                    name VARCHAR(30) NOT NULL UNIQUE,
                    created_by_id VARCHAR(50) NOT NULL,
                    created_by_name VARCHAR(100) NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_custom_tags_name ON custom_tags (name)"
            ))
            logger.info("[INTG][DB] custom_tags table ensured")
    except Exception as e:
        logger.warning("[INTG][DB] Failed to ensure custom_tags: %s", e)


async def _ensure_medication_notes(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE medications ADD COLUMN IF NOT EXISTS notes TEXT"
            ))
            notes_seed = [
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
            for pid, med_name, notes in notes_seed:
                await conn.execute(text(
                    "UPDATE medications SET notes = :notes "
                    "WHERE patient_id = :pid AND name = :name AND notes IS NULL"
                ), {"pid": pid, "name": med_name, "notes": notes})
            conc_seed = [
                ("Morphine", "2mg/1mL inj"),
                ("Dormicum", "15mg/3mL inj"),
                ("Propofol", "200mg/20mL inj"),
                ("Fentanyl", "0.05mg/mL 10mL"),
                ("Cisatracurium", "2mg/mL 5mL"),
                ("Dexmedetomidine", "200mcg/2mL inj"),
                ("Midazolam", "15mg/3mL inj"),
            ]
            for med_name, conc in conc_seed:
                await conn.execute(text(
                    "UPDATE medications SET concentration = :conc "
                    "WHERE name = :name AND concentration IS NULL"
                ), {"name": med_name, "conc": conc})
            logger.info("[INTG][DB] medications.notes + concentration seeded")
    except Exception as e:
        logger.warning("[INTG][DB] medications.notes bootstrap failed (non-fatal): %s", e)


async def _ensure_culture_extra_columns(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE culture_results ADD COLUMN IF NOT EXISTS q_score INTEGER"
            ))
            await conn.execute(text(
                "ALTER TABLE culture_results ADD COLUMN IF NOT EXISTS result VARCHAR(200)"
            ))
            logger.info("[INTG][DB] culture_results.q_score/result columns ensured")
    except Exception as e:
        logger.warning("[INTG][DB] culture_results columns failed (non-fatal): %s", e)


async def _ensure_venous_blood_gas(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE lab_data ADD COLUMN IF NOT EXISTS venous_blood_gas JSONB"
            ))
            logger.info("[INTG][DB] lab_data.venous_blood_gas column ensured")

            vbg_pat_001 = {
                "pH": {"value": 7.32, "unit": "", "referenceRange": "7.31-7.41", "status": "normal"},
                "PCO2": {"value": 48.0, "unit": "mmHg", "referenceRange": "41-51", "status": "normal"},
                "PO2": {"value": 38.0, "unit": "mmHg", "referenceRange": "30-50", "status": "normal"},
                "HCO3": {"value": 24.1, "unit": "mEq/L", "referenceRange": "22-26", "status": "normal"},
                "BE": {"value": -1.2, "unit": "mEq/L", "referenceRange": "-2 to 2", "status": "normal"},
                "SO2C": {"value": 68.0, "unit": "%", "referenceRange": "60-80", "status": "normal"},
            }
            vbg_pat_002 = {
                "pH": {"value": 7.28, "unit": "", "referenceRange": "7.31-7.41", "status": "low"},
                "PCO2": {"value": 55.0, "unit": "mmHg", "referenceRange": "41-51", "status": "high"},
                "PO2": {"value": 32.0, "unit": "mmHg", "referenceRange": "30-50", "status": "normal"},
                "HCO3": {"value": 25.5, "unit": "mEq/L", "referenceRange": "22-26", "status": "normal"},
                "BE": {"value": -0.5, "unit": "mEq/L", "referenceRange": "-2 to 2", "status": "normal"},
                "SO2C": {"value": 58.0, "unit": "%", "referenceRange": "60-80", "status": "low"},
            }
            for pid, vbg_data in [("pat_001", vbg_pat_001), ("pat_002", vbg_pat_002)]:
                await conn.execute(text(
                    "UPDATE lab_data SET venous_blood_gas = :vbg "
                    "WHERE patient_id = :pid AND venous_blood_gas IS NULL"
                ), {"vbg": json.dumps(vbg_data), "pid": pid})
            logger.info("[INTG][DB] venous_blood_gas seed data applied for pat_001/pat_002")
    except Exception as e:
        logger.warning("[INTG][DB] venous_blood_gas bootstrap failed (non-fatal): %s", e)


async def _ensure_vital_signs_advanced(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
            for vcol in ("etco2", "cvp", "icp", "cpp"):
                await conn.execute(text(
                    f"ALTER TABLE vital_signs ADD COLUMN IF NOT EXISTS {vcol} FLOAT"
                ))
            logger.info("[INTG][DB] vital_signs etco2/cvp/icp/cpp columns ensured")
            await conn.execute(text(
                "UPDATE vital_signs SET etco2 = 38.0, cvp = 10.0 "
                "WHERE patient_id = 'pat_001' AND etco2 IS NULL"
            ))
            await conn.execute(text(
                "UPDATE vital_signs SET etco2 = 42.0, cvp = 9.0 "
                "WHERE patient_id = 'pat_002' AND etco2 IS NULL"
            ))
            await conn.execute(text(
                "UPDATE vital_signs SET etco2 = 40.0, cvp = 11.0, icp = 18.0, cpp = 62.0 "
                "WHERE patient_id = 'pat_004' AND etco2 IS NULL"
            ))
    except Exception as e:
        logger.warning("[INTG][DB] vital_signs advanced columns failed (non-fatal): %s", e)

    # body_weight column + seed weight history
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE vital_signs ADD COLUMN IF NOT EXISTS body_weight FLOAT"
            ))
            # Update existing records with baseline weights
            _bw = [("pat_001", 63.2), ("pat_002", 55.0), ("pat_003", 68.5), ("pat_004", 78.0)]
            for pid, w in _bw:
                await conn.execute(text(
                    "UPDATE vital_signs SET body_weight = :w "
                    "WHERE patient_id = :pid AND body_weight IS NULL"
                ), {"w": w, "pid": pid})
            # Clean up any weight-only records that may have been created before
            await conn.execute(text(
                "DELETE FROM vital_signs WHERE id LIKE 'vs_bw_%'"
            ))
            # Spread different weights across existing records for trend data
            # (each patient's existing vital_signs get sequential weight values)
            _bw_offsets = {
                "pat_001": [0.3, 0.0, -0.4, -0.2, 0.0],
                "pat_002": [1.5, 1.0, 0.5, 0.2, 0.0],
                "pat_003": [3.5, 2.0, 1.0, 0.5, 0.0],
                "pat_004": [0.0, 0.2, 0.5, 0.3, 0.0],
            }
            for pid, base_w in _bw:
                rows = await conn.execute(text(
                    "SELECT id FROM vital_signs WHERE patient_id = :pid "
                    "ORDER BY timestamp ASC"
                ), {"pid": pid})
                ids = [r[0] for r in rows.fetchall()]
                offsets = _bw_offsets.get(pid, [0.0])
                for i, rid in enumerate(ids):
                    offset = offsets[i] if i < len(offsets) else offsets[-1]
                    w = round(base_w + offset, 1)
                    await conn.execute(text(
                        "UPDATE vital_signs SET body_weight = :w WHERE id = :id"
                    ), {"w": w, "id": rid})
            logger.info("[INTG][DB] vital_signs body_weight column + history ensured")
    except Exception as e:
        logger.warning("[INTG][DB] vital_signs body_weight failed (non-fatal): %s", e)


async def _ensure_medication_source_columns(engine: AsyncEngine) -> None:
    """Migration 048 fallback: add outpatient source columns to medications."""
    new_cols = [
        ("source_type", "VARCHAR(20) NOT NULL DEFAULT 'inpatient'"),
        ("source_campus", "VARCHAR(50)"),
        ("prescribing_hospital", "VARCHAR(200)"),
        ("prescribing_department", "VARCHAR(100)"),
        ("prescribing_doctor_name", "VARCHAR(100)"),
        ("days_supply", "INTEGER"),
        ("is_external", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ]
    try:
        async with engine.begin() as conn:
            for col_name, col_type in new_cols:
                try:
                    await conn.execute(text(
                        f"ALTER TABLE medications ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
                    ))
                except Exception:
                    pass
            try:
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_medications_source_type ON medications (source_type)"
                ))
            except Exception:
                pass
        logger.info("[INTG][DB] medications source columns ensured (migration 048 fallback)")
    except Exception as e:
        logger.warning("[INTG][DB] medications source columns failed (non-fatal): %s", e)


async def _ensure_medication_order_code(engine: AsyncEngine) -> None:
    """Migration 011 fallback: add order_code column to medications."""
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE medications ADD COLUMN IF NOT EXISTS order_code VARCHAR(50)"
            ))
        logger.info("[INTG][DB] medications.order_code column ensured (migration 011 fallback)")
    except Exception as e:
        logger.warning("[INTG][DB] medications.order_code failed (non-fatal): %s", e)


async def _ensure_patient_campus(engine: AsyncEngine) -> None:
    """Migration 048 fallback: add campus column to patients."""
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE patients ADD COLUMN IF NOT EXISTS campus VARCHAR(50)"
            ))
        logger.info("[INTG][DB] patients.campus column ensured (migration 048 fallback)")
    except Exception as e:
        logger.warning("[INTG][DB] patients.campus column failed (non-fatal): %s", e)


async def _clear_messages_once(engine: AsyncEngine) -> None:
    """One-time: delete all patient_messages and team_chat_messages."""
    try:
        async with engine.begin() as conn:
            # Use a dedicated flag table to track one-time operations
            await conn.execute(text(
                "CREATE TABLE IF NOT EXISTS _startup_flags "
                "(flag VARCHAR(100) PRIMARY KEY)"
            ))
            done = await conn.execute(text(
                "SELECT 1 FROM _startup_flags WHERE flag = 'clear_messages_053'"
            ))
            if done.scalar():
                return
            r1 = await conn.execute(text("DELETE FROM patient_messages"))
            r2 = await conn.execute(text("DELETE FROM team_chat_messages"))
            await conn.execute(text(
                "INSERT INTO _startup_flags (flag) VALUES ('clear_messages_053')"
            ))
            logger.info("Cleared %d patient_messages, %d team_chat_messages", r1.rowcount, r2.rowcount)
    except Exception:
        logger.warning("_clear_messages_once failed (non-fatal)", exc_info=True)


async def _ensure_np_role(engine: AsyncEngine) -> None:
    """Remove old role CHECK constraint to allow 'np' role.

    Pydantic schemas handle validation; DB constraint is unnecessary.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_role_valid'
                    ) THEN
                        ALTER TABLE users DROP CONSTRAINT ck_users_role_valid;
                    END IF;
                END $$;
            """))
        logger.info("_ensure_np_role: CHECK constraint dropped (validation via Pydantic)")
    except Exception:
        logger.warning("_ensure_np_role failed (non-fatal)", exc_info=True)


async def _seed_iv_compatibilities(engine: AsyncEngine) -> None:
    """Seed iv_compatibilities from icu_y_site_compatibility_v2_lookup.json.

    Merges 8 ICU department sheets into one row per drug pair.
    Incompatible (I) in any sheet overrides Compatible (C).
    Skips if table already has > 10 rows (already seeded).
    """
    try:
        async with engine.connect() as conn:
            count = (await conn.execute(text("SELECT COUNT(*) FROM iv_compatibilities"))).scalar()
        if count > 10:
            logger.info("[INTG][DB] iv_compatibilities already has %d rows, skipping seed", count)
            return

        seed_path = Path(__file__).resolve().parents[1] / "seeds" / "icu_y_site_compatibility_v2_lookup.json"
        if not seed_path.exists():
            logger.warning("[INTG][DB] iv_compatibilities seed file not found at %s", seed_path)
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

        # Merge across all 8 sheets: I wins over C
        from collections import defaultdict
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

        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM iv_compatibilities"))
            inserted = 0
            for (d1, d2), info in pair_map.items():
                _id = "ivc_" + hashlib.sha1(f"{d1}|{d2}".encode()).hexdigest()[:12]
                sheets_str = "、".join(sorted(info["sheets"]))
                note = f"科別：{sheets_str}"
                if info["has_i"]:
                    note += "（任一科別不相容）"
                await conn.execute(text(
                    "INSERT INTO iv_compatibilities (id, drug1, drug2, compatible, solution, notes) "
                    "SELECT :id, :d1, :d2, :compat, :sol, :notes "
                    "WHERE NOT EXISTS (SELECT 1 FROM iv_compatibilities WHERE id = :id)"
                ).bindparams(
                    id=_id, d1=d1, d2=d2,
                    compat=info["compatible"],
                    sol="icu_y_site",
                    notes=note,
                ))
                inserted += 1
        logger.info("[INTG][DB] Seeded %d IV compatibility pairs from %s", inserted, seed_path.name)
    except Exception as e:
        logger.warning("[INTG][DB] IV compatibility seed failed (non-fatal): %s", e)


async def _patch_ddi_interacting_members(engine: AsyncEngine) -> None:
    """Back-fill interacting_members for existing DDI rows where it is NULL.

    The seeding skips re-seed when count > 100, so rows inserted before the
    interacting_members column existed have NULL in that column.  Class-level
    matching (e.g. Tramadol ↔ Mirtazapine via Serotonergic class) only works
    when the column is populated.
    """
    logger.info("[INTG][DB] _patch_ddi_interacting_members: checking...")

    async def _count_nulls() -> int:
        """Run COUNT inside engine.begin() so SET LOCAL lock_timeout persists."""
        async with engine.begin() as conn:
            # lock_timeout cancels this statement if it waits >10s for a table lock.
            # Using engine.begin() ensures BEGIN is sent first so PgBouncer assigns
            # the same server connection to both SET LOCAL and SELECT.
            await conn.execute(text("SET LOCAL lock_timeout = '10000'"))
            await conn.execute(text("SET LOCAL statement_timeout = '15000'"))
            result = await conn.execute(
                text("SELECT COUNT(*) FROM drug_interactions WHERE interacting_members IS NULL")
            )
            return result.scalar()

    try:
        # asyncio.wait_for provides a hard Python-level timeout regardless of
        # PgBouncer/asyncpg lock-wait behaviour.
        null_count = await asyncio.wait_for(_count_nulls(), timeout=20.0)
    except asyncio.TimeoutError:
        logger.warning("[INTG][DB] _patch_ddi_interacting_members timed out waiting for lock, skipping")
        return
    except Exception as e:
        logger.warning("[INTG][DB] DDI interacting_members count failed (non-fatal): %s", e)
        return

    if null_count == 0:
        logger.info("[INTG][DB] ddi interacting_members already populated, skipping patch")
        return

    seeds_dir = Path(__file__).resolve().parents[1] / "seeds"
    gz_seed = seeds_dir / "ddi_xd_only.json.gz"
    if not gz_seed.exists():
        logger.info("[INTG][DB] ddi_xd_only.json.gz not found, skipping patch")
        return

    try:
        with gzip.open(gz_seed, "rb") as _gz:
            interactions = json.loads(_gz.read().decode("utf-8"))

        # Pre-compute (id, im_json) pairs in Python so the DB-side work is a
        # handful of bulk UPDATEs instead of ~1800 sequential roundtrips.
        # Each per-row UPDATE costs one network RTT; on Railway → Supabase
        # Sydney that's ~150-200ms, so 1839 rows ≈ 5-10 minutes blocking the
        # FastAPI lifespan. Bulk UPDATE collapses it to ~10 roundtrips.
        rows: list[tuple[str, str]] = []
        for ix in interactions:
            im = ix.get("interacting_members")
            if not im:
                continue
            dk = ix.get("dedup_key", "")
            if not dk:
                dk = "||".join(sorted([ix["drug1"].lower(), ix["drug2"].lower()]))
            _id = "ddi_" + hashlib.sha1(dk.encode()).hexdigest()[:12]
            rows.append((_id, json.dumps(im, ensure_ascii=False)))

        if not rows:
            logger.info("[INTG][DB] no DDI interacting_members rows to patch")
            return

        BATCH_SIZE = 200
        patched = 0

        async def _patch_batches() -> int:
            total = 0
            async with engine.begin() as conn:
                await conn.execute(text("SET LOCAL lock_timeout = '10000'"))
                await conn.execute(text("SET LOCAL statement_timeout = '30000'"))
                for start in range(0, len(rows), BATCH_SIZE):
                    chunk = rows[start:start + BATCH_SIZE]
                    # Build VALUES (:id0, :im0), (:id1, :im1), ... with named params.
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

        # Hard Python-level deadline so this never blocks startup forever.
        try:
            patched = await asyncio.wait_for(_patch_batches(), timeout=60.0)
        except asyncio.TimeoutError:
            logger.warning(
                "[INTG][DB] _patch_ddi_interacting_members bulk UPDATE timed out at 60s, partial progress retained"
            )
            return

        logger.info("[INTG][DB] Patched interacting_members for %d DDI rows", patched)
    except Exception as e:
        logger.warning("[INTG][DB] DDI interacting_members patch failed (non-fatal): %s", e)


async def _seed_missing_critical_ddi(engine: AsyncEngine) -> None:
    """Insert ICU-critical DDI pairs that are absent from the main DDI dataset.

    DOPamine (vasopressor) is pharmacologically distinct from dopamine agonists
    used in Parkinson's disease, so the Anti-Parkinson / Antipsychotic class rule
    does NOT cover it.  We add explicit rows for the vasopressor interactions.
    """
    _CRITICAL = [
        # DOPamine vasopressor + antipsychotics → reduced vasopressor efficacy
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
        # DilTIAZem + Beta-Blockers → additive AV node conduction slowing (AV block risk)
        # Both drugs are Bradycardia-Causing Agents (same class side), so class rule cannot
        # detect this pair.  An explicit entry is required.
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
        # Colchicine + Ticagrelor [D] — P-gp AND CYP3A4 inhibition → colchicine toxicity
        # Ticagrelor is NOT in the P-gp inhibitors class members in the main DDI dataset.
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
        # Spironolactone + Sacubitril-Valsartan [D] — hyperkalaemia risk
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
                "hyperkalaemia, which may cause life-threatening cardiac arrhythmias."
            ),
            "management": (
                "Monitor serum potassium and renal function closely (weekly for first 4 weeks, "
                "then monthly). Keep K⁺ < 5.0 mEq/L. Reduce spironolactone dose or discontinue "
                "if K⁺ ≥ 5.5 mEq/L. Avoid if eGFR < 30 mL/min/1.73m²."
            ),
            "interacting_members": [
                {
                    "group_name": "Sacubitril and Valsartan",
                    "members": ["Sacubitril", "Valsartan", "Entresto"],
                    "exceptions": [],
                    "exceptions_note": "",
                },
            ],
        },
        # DexmedeTOMIDine + Opioid Agonists [D] — synergistic CNS/respiratory depression
        # The DDI dataset covers DexmedeTOMIDine × CNS Depressants, but the CNS Depressants
        # class does NOT include opioids (they are in the separate Opioid Agonists class).
        # This explicit entry is required to detect dexmedetomidine + morphine/fentanyl/etc.
        {
            "drug1": "DexmedeTOMIDine",
            "drug2": "Opioid Agonists",
            "risk_rating": "D",
            "severity": "major",
            "risk_rating_description": "Consider therapy modification",
            "severity_label": "Major",
            "reliability_rating": "Intermediate",
            "clinical_effect": (
                "Concurrent use of dexmedetomidine with opioid analgesics produces synergistic "
                "CNS and respiratory depression. The combination may cause excessive sedation, "
                "respiratory depression, apnoea, haemodynamic instability (bradycardia, hypotension), "
                "and prolonged recovery. This interaction is particularly significant in the ICU "
                "where both agents are commonly co-administered."
            ),
            "management": (
                "Use the combination with caution and at reduced doses. Continuously monitor "
                "respiratory rate, SpO₂, level of sedation (RASS), heart rate, and blood pressure. "
                "When initiating or increasing dexmedetomidine, consider reducing concurrent "
                "opioid dose by 25-50%. Have reversal agents (naloxone) readily available."
            ),
            "interacting_members": [
                {
                    "group_name": "Opioid Agonists",
                    "members": [
                        "Morphine (Systemic)", "FentaNYL", "HYDROmorphone", "Remifentanil",
                        "SUFentanil", "ALfentanil", "TraMADol", "OxyCODONE", "Meperidine",
                        "Methadone", "Codeine", "Tapentadol", "Buprenorphine",
                    ],
                    "exceptions": [],
                    "exceptions_note": "",
                },
            ],
        },
        # Perampanel × CNS Depressants [D] — additive CNS/respiratory depression in status epilepticus
        # Perampanel is in the CNS Depressants class (same side as LORazepam/Midazolam), so no
        # existing cross-class rule can detect this pair. An explicit entry is required.
        {
            "drug1": "Perampanel",
            "drug2": "CNS Depressants",
            "risk_rating": "D",
            "severity": "major",
            "risk_rating_description": "Consider therapy modification",
            "severity_label": "Major",
            "reliability_rating": "Intermediate",
            "clinical_effect": (
                "Perampanel, an AMPA glutamate receptor antagonist with significant CNS depressant "
                "activity, produces additive CNS and respiratory depression when combined with other "
                "CNS depressants (benzodiazepines, propofol, dexmedetomidine, opioids). "
                "In the ICU setting for refractory status epilepticus, this combination may cause "
                "excessive sedation, respiratory depression, or haemodynamic compromise."
            ),
            "management": (
                "Use with caution. When adding perampanel to ongoing benzodiazepine or sedative "
                "therapy, start at the lowest effective dose and titrate slowly. "
                "Monitor respiratory rate, SpO₂, level of sedation (RASS), and haemodynamics. "
                "Consider reducing the dose of concomitant CNS depressants."
            ),
            "interacting_members": [
                {
                    "group_name": "CNS Depressants",
                    "members": [
                        "LORazepam", "Midazolam", "DiazePAM", "ClonazePAM",
                        "ALPRAZolam", "ChlordiazePOXIDE", "CloBAZam", "CloNAZEpam",
                        "Propofol", "Ketamine", "Esketamine (Injection)",
                        "DexmedeTOMIDine", "PHENobarbital",
                        "Haloperidol", "QUEtiapine", "Zolpidem",
                    ],
                    "exceptions": [],
                    "exceptions_note": "",
                },
            ],
        },
    ]

    logger.info("[INTG][DB] _seed_missing_critical_ddi: checking %d entries...", len(_CRITICAL))

    async def _do_critical_seed() -> None:
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL lock_timeout = '10000'"))
            for ix in _CRITICAL:
                dk = "icu_critical||" + "||".join(sorted([ix["drug1"].lower(), ix["drug2"].lower()]))
                _id = "ddi_" + hashlib.sha1(dk.encode()).hexdigest()[:12]
                im = ix.get("interacting_members")
                await conn.execute(text(
                    "INSERT INTO drug_interactions "
                    "(id, drug1, drug2, severity, mechanism, clinical_effect, management, "
                    "risk_rating, risk_rating_description, severity_label, reliability_rating, "
                    "interacting_members, dedup_key) "
                    "SELECT :id, :d1, :d2, :sev, :mech, :ce, :mgmt, :rr, :rrd, :sl, :rl, "
                    "CAST(:im AS JSONB), :dk "
                    "WHERE NOT EXISTS (SELECT 1 FROM drug_interactions WHERE id = :id)"
                ).bindparams(
                    id=_id, d1=ix["drug1"], d2=ix["drug2"],
                    sev=ix["severity"], mech="",
                    ce=ix["clinical_effect"], mgmt=ix["management"],
                    rr=ix["risk_rating"], rrd=ix["risk_rating_description"],
                    sl=ix["severity_label"], rl=ix["reliability_rating"],
                    im=json.dumps(im, ensure_ascii=False) if im else None,
                    dk=dk,
                ))

    try:
        await asyncio.wait_for(_do_critical_seed(), timeout=20.0)
        logger.info("[INTG][DB] Critical DDI seed: verified %d entries", len(_CRITICAL))
    except asyncio.TimeoutError:
        logger.warning("[INTG][DB] Critical DDI seed timed out waiting for lock, skipping")
    except Exception as e:
        logger.warning("[INTG][DB] Critical DDI seed failed (non-fatal): %s", e)


async def _ensure_performance_indexes(engine: AsyncEngine) -> None:
    logger.info("[INTG][DB] _ensure_performance_indexes: starting...")
    try:
        async with engine.begin() as conn:
            # Guard against lock contention from prior deployments (SET LOCAL ensures
            # the setting applies within this transaction even via PgBouncer).
            await conn.execute(text("SET LOCAL lock_timeout = '15000'"))
            await conn.execute(text("SET LOCAL statement_timeout = '30000'"))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_patient_messages_patient_is_read "
                "ON patient_messages (patient_id, is_read)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_medications_status_san_category "
                "ON medications (status, san_category)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_pharmacy_advices_category_timestamp "
                "ON pharmacy_advices (category, timestamp)"
            ))
            # FK constraints (safe — DO NOTHING if already exists)
            await conn.execute(text(
                "DO $$ BEGIN "
                "ALTER TABLE clinical_scores ADD CONSTRAINT fk_clinical_scores_patient "
                "FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            ))
            await conn.execute(text(
                "DO $$ BEGIN "
                "ALTER TABLE custom_tags ADD CONSTRAINT fk_custom_tags_created_by "
                "FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT; "
                "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            ))
            # Convert drug_interactions JSON-as-Text columns to JSONB (skip if already JSONB)
            for col in ("dependencies", "dependency_types", "interacting_members", "pubmed_ids"):
                try:
                    row = (await conn.execute(text(
                        "SELECT data_type FROM information_schema.columns "
                        "WHERE table_name='drug_interactions' AND column_name=:col"
                    ).bindparams(col=col))).fetchone()
                    if row and row[0] == "jsonb":
                        continue
                    await conn.execute(text(
                        f"ALTER TABLE drug_interactions "
                        f"ALTER COLUMN {col} TYPE JSONB USING {col}::jsonb"
                    ))
                except Exception:
                    pass
            logger.info("[INTG][DB] dashboard performance indexes + FK constraints + JSONB migration ensured")
    except Exception as e:
        logger.warning("[INTG][DB] dashboard indexes failed (non-fatal): %s", e)


async def _seed_outpatient_demo(engine: AsyncEngine) -> None:
    """Seed 4 outpatient demo medications for pat_001 (idempotent)."""
    meds = [
        ("med_opd_001", "pat_001", "Tamsulosin", "Tamsulosin HCl", "0.4", "mg", "QD", "PO",
         "BPH (良性攝護腺肥大)", "2025-09-15", "2026-03-15", "active",
         "outpatient", "仁愛", "臺北市立聯合醫院", "泌尿科", "張德揚", 28, False),
        ("med_opd_002", "pat_001", "Amlodipine", "Amlodipine Besylate", "5", "mg", "QD", "PO",
         "Hypertension (高血壓)", "2025-06-01", "2026-06-01", "active",
         "outpatient", "中興", "臺北市立聯合醫院", "心臟內科", "王建民", 28, False),
        ("med_opd_003", "pat_001", "Metformin", "Metformin HCl", "500", "mg", "BID", "PO",
         "DM type 2 (第二型糖尿病)", "2025-04-10", "2026-04-10", "active",
         "outpatient", "陽明", "臺北市立聯合醫院", "新陳代謝科", "陳美玲", 28, False),
        ("med_opd_004", "pat_001", "Atorvastatin", "Atorvastatin Calcium", "20", "mg", "QD HS", "PO",
         "Hyperlipidemia (高血脂)", "2025-07-20", "2026-07-20", "active",
         "outpatient", "忠孝", "臺北市立聯合醫院", "心臟內科", "林志明", 28, False),
    ]
    try:
        async with engine.begin() as conn:
            for m in meds:
                exists = await conn.execute(
                    text("SELECT 1 FROM medications WHERE id = :id"),
                    {"id": m[0]},
                )
                if exists.fetchone():
                    continue
                await conn.execute(
                    text(
                        "INSERT INTO medications "
                        "(id, patient_id, name, generic_name, dose, unit, frequency, route, "
                        "indication, start_date, end_date, status, "
                        "source_type, source_campus, prescribing_hospital, "
                        "prescribing_department, prescribing_doctor_name, days_supply, is_external) "
                        "VALUES (:id, :pid, :name, :gn, :dose, :unit, :freq, :route, "
                        ":ind, :sd, :ed, :st, :src, :campus, :hosp, :dept, :doc, :days, :ext)"
                    ),
                    {"id": m[0], "pid": m[1], "name": m[2], "gn": m[3],
                     "dose": m[4], "unit": m[5], "freq": m[6], "route": m[7],
                     "ind": m[8], "sd": m[9], "ed": m[10], "st": m[11],
                     "src": m[12], "campus": m[13], "hosp": m[14], "dept": m[15],
                     "doc": m[16], "days": m[17], "ext": m[18]},
                )
            logger.info("[INTG][DB] outpatient demo medications seeded")
    except Exception as e:
        logger.warning("[INTG][DB] outpatient seed failed (non-fatal): %s", e)


async def _ensure_diagnostic_reports(engine: AsyncEngine) -> None:
    """Create diagnostic_reports table and seed demo data if missing."""
    from datetime import timezone as _tz, timedelta as _td
    tz8 = _tz(_td(hours=8))
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "CREATE TABLE IF NOT EXISTS diagnostic_reports ("
                "id VARCHAR(50) PRIMARY KEY, "
                "patient_id VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, "
                "report_type VARCHAR(50) NOT NULL, "
                "exam_name VARCHAR(200) NOT NULL, "
                "exam_date TIMESTAMPTZ NOT NULL, "
                "body_text TEXT NOT NULL, "
                "impression TEXT, "
                "reporter_name VARCHAR(100), "
                "status VARCHAR(20) NOT NULL DEFAULT 'final', "
                "created_at TIMESTAMPTZ DEFAULT NOW())"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_diagnostic_reports_patient_id "
                "ON diagnostic_reports (patient_id)"
            ))
            # Seed 5 demo reports for pat_001 (asyncpg needs real datetime objects)
            from datetime import datetime as _dt
            demos = [
                ("rpt_001", "pat_001", "imaging", "CT Without C.M. Brain", _dt(2025, 10, 20, 10, 30, tzinfo=tz8),
                 "CT of head without contrast enhancement shows:\n- s/p right lateral ventricle drainage. s/p left craniotomy and a left burr hole.\n- brain atrophy with prominent sulci, fissures and ventricles.\n- confluent hypodensity at the periventricular white matter.\n- old insult in the left patietal-occipital-temporal lobes.\n- lacunes at bilateral basal ganglia, thalami, and pons.\n- atherosclerosis with mural calcification in the intracranial arteries.",
                 "Brain atrophy. old insults and lacunes. post-operative changes.\nSuggest clinical correlation.",
                 "RAD12-王志明"),
                ("rpt_002", "pat_001", "imaging", "Chest X-ray (Portable)", _dt(2025, 10, 18, 8, 15, tzinfo=tz8),
                 "Portable AP view of the chest:\n- ETT tip at approximately 3 cm above the carina.\n- NG tube tip in the stomach.\n- Right subclavian CVC with tip in the SVC.\n- Bilateral diffuse ground-glass opacities, more prominent in the lower lobes.\n- No pneumothorax identified.\n- Mild cardiomegaly.",
                 "Bilateral diffuse infiltrates, compatible with ARDS or pulmonary edema.\nLines and tubes in satisfactory position.",
                 "RAD08-陳怡安"),
                ("rpt_003", "pat_001", "procedure", "清醒腦波 EEG", _dt(2025, 11, 5, 14, 0, tzinfo=tz8),
                 "Indication: conscious change\n\nFinding:\n1. Diffuse background slowing, theta predominant (5-6 Hz, 20-30 uV).\n2. Beta wave: 14-16 Hz, 5-10 uV.\n3. Hyperventilation: cannot cooperate.\n4. Photic sensitivity: no photic drive response.\n5. No epiletiform discharge.\n\nConclusion: the EEG findings suggest diffuse cortical dysfunction.",
                 "Diffuse cortical dysfunction. No epileptiform discharge.",
                 "DAX32-廖岐禮"),
                ("rpt_004", "pat_001", "procedure", "Echocardiography (TTE)", _dt(2025, 10, 25, 11, 0, tzinfo=tz8),
                 "Transthoracic echocardiography:\n- LV systolic function: mildly reduced, estimated EF 45%.\n- LV wall motion: global hypokinesis.\n- RV size and function: normal.\n- Valvular: mild MR, mild TR. No significant AS or AI.\n- No pericardial effusion.\n- IVC: dilated with <50% respiratory variation, estimated RAP 10-15 mmHg.",
                 "Mildly reduced LV systolic function with global hypokinesis (EF ~45%).\nMild MR/TR. Elevated estimated RAP.",
                 "CV05-林書豪"),
                ("rpt_005", "pat_001", "imaging", "Chest CT with contrast", _dt(2025, 11, 10, 9, 45, tzinfo=tz8),
                 "CT chest with IV contrast:\n- No pulmonary embolism identified.\n- Bilateral pleural effusions, moderate on right, small on left.\n- Bilateral dependent consolidations, likely atelectasis vs infection.\n- Diffuse ground-glass opacity in both lungs.\n- Mediastinal lymph nodes, borderline size (short axis up to 10mm).\n- ETT, CVC and NG tube in satisfactory position.",
                 "No PE. Bilateral pleural effusions and consolidations.\nDifferential includes atelectasis, infection, or ARDS.",
                 "RAD12-王志明"),
            ]
            for d in demos:
                exists = await conn.execute(text("SELECT 1 FROM diagnostic_reports WHERE id = :id"), {"id": d[0]})
                if exists.fetchone():
                    continue
                await conn.execute(
                    text(
                        "INSERT INTO diagnostic_reports (id, patient_id, report_type, exam_name, exam_date, body_text, impression, reporter_name) "
                        "VALUES (:id, :pid, :rt, :en, :ed, :bt, :imp, :rn)"
                    ),
                    {"id": d[0], "pid": d[1], "rt": d[2], "en": d[3], "ed": d[4], "bt": d[5], "imp": d[6], "rn": d[7]},
                )
            # --- pat_002 林小姐: 敗血性休克併多重器官衰竭 ---
            demos_002 = [
                ("rpt_006", "pat_002", "imaging", "Chest X-ray (Portable)", _dt(2025, 11, 2, 7, 30, tzinfo=tz8),
                 "Portable AP view of the chest:\n- ETT tip 4 cm above the carina.\n- Right IJV CVC with tip in the SVC.\n- NG tube tip in the stomach.\n- Bilateral diffuse alveolar infiltrates, worse on the right.\n- Small bilateral pleural effusions.\n- No pneumothorax.",
                 "Bilateral alveolar infiltrates with small pleural effusions.\nConsider ARDS vs fluid overload in the setting of septic shock.",
                 "RAD08-陳怡安"),
                ("rpt_007", "pat_002", "imaging", "CT Abdomen & Pelvis with contrast", _dt(2025, 11, 3, 14, 20, tzinfo=tz8),
                 "CT abdomen and pelvis with IV contrast:\n- Diffuse bowel wall thickening involving the ascending and transverse colon.\n- Mild pericolonic fat stranding.\n- Bilateral small pleural effusions with adjacent atelectasis.\n- Mild ascites in the pelvis.\n- No free air or abscess formation.\n- Liver, spleen, and pancreas appear unremarkable.\n- Bilateral kidneys show normal size with mildly delayed nephrogram.",
                 "Diffuse colitis with pericolonic inflammatory changes.\nDifferential: infectious colitis, ischemic colitis.\nNo drainable abscess or free air.",
                 "RAD12-王志明"),
                ("rpt_008", "pat_002", "procedure", "Echocardiography (TTE)", _dt(2025, 11, 4, 10, 0, tzinfo=tz8),
                 "Transthoracic echocardiography:\n- LV systolic function: hyperdynamic, estimated EF 70%.\n- LV wall motion: normal.\n- RV size and function: mildly dilated, TAPSE 14mm (mildly reduced).\n- Valvular: trace MR, mild TR (estimated RVSP 42 mmHg).\n- No pericardial effusion.\n- IVC: dilated 2.3 cm with <50% respiratory variation.",
                 "Hyperdynamic LV function (sepsis physiology).\nMild RV dysfunction with elevated RVSP.\nElevated estimated RAP.",
                 "CV05-林書豪"),
                ("rpt_009", "pat_002", "imaging", "Chest CT with contrast (CTPA)", _dt(2025, 11, 6, 9, 0, tzinfo=tz8),
                 "CT pulmonary angiography:\n- No pulmonary embolism.\n- Bilateral moderate pleural effusions with compressive atelectasis.\n- Diffuse ground-glass opacity in both lungs, compatible with ARDS.\n- Mediastinal lymphadenopathy (short axis up to 12mm).\n- ETT, CVC in satisfactory position.\n- Small pericardial effusion.",
                 "No PE. Bilateral ARDS pattern with pleural effusions.\nReactive mediastinal lymphadenopathy.\nSmall pericardial effusion.",
                 "RAD12-王志明"),
            ]
            for d in demos_002:
                exists = await conn.execute(text("SELECT 1 FROM diagnostic_reports WHERE id = :id"), {"id": d[0]})
                if exists.fetchone():
                    continue
                await conn.execute(
                    text(
                        "INSERT INTO diagnostic_reports (id, patient_id, report_type, exam_name, exam_date, body_text, impression, reporter_name) "
                        "VALUES (:id, :pid, :rt, :en, :ed, :bt, :imp, :rn)"
                    ),
                    {"id": d[0], "pid": d[1], "rt": d[2], "en": d[3], "ed": d[4], "bt": d[5], "imp": d[6], "rn": d[7]},
                )

            # --- pat_003 陳女士: 急性腎衰竭併肺水腫 ---
            demos_003 = [
                ("rpt_010", "pat_003", "imaging", "Chest X-ray (Portable)", _dt(2025, 10, 28, 6, 45, tzinfo=tz8),
                 "Portable AP view of the chest:\n- No ETT. NG tube tip in the stomach.\n- Right subclavian double-lumen dialysis catheter with tip in the RA.\n- Bilateral perihilar haziness with Kerley B lines.\n- Bilateral pleural effusions, moderate.\n- Upper lobe pulmonary venous distention.\n- Cardiomegaly (CTR ~0.60).",
                 "Pulmonary edema with bilateral pleural effusions.\nCardiomegaly. Dialysis catheter in satisfactory position.",
                 "RAD08-陳怡安"),
                ("rpt_011", "pat_003", "imaging", "Renal Ultrasound", _dt(2025, 10, 29, 10, 30, tzinfo=tz8),
                 "Renal ultrasound:\n- Right kidney: 10.2 cm, normal cortical thickness, no hydronephrosis.\n- Left kidney: 10.5 cm, normal cortical thickness, no hydronephrosis.\n- Bilateral increased renal cortical echogenicity.\n- No renal mass or calculus identified.\n- Bladder: Foley catheter in situ, minimal residual.",
                 "Bilateral increased renal cortical echogenicity, compatible with medical renal disease.\nNo hydronephrosis or obstructive uropathy.",
                 "RAD15-張雅婷"),
                ("rpt_012", "pat_003", "procedure", "Echocardiography (TTE)", _dt(2025, 10, 30, 11, 30, tzinfo=tz8),
                 "Transthoracic echocardiography:\n- LV systolic function: preserved, estimated EF 55%.\n- Concentric LV hypertrophy (IVSd 13mm).\n- Diastolic dysfunction: E/e' ratio 18 (Grade II).\n- Valvular: moderate MR, mild TR.\n- Moderate pericardial effusion without tamponade physiology.\n- IVC: dilated 2.5 cm, no respiratory variation.",
                 "Preserved LVEF with concentric hypertrophy.\nGrade II diastolic dysfunction (elevated filling pressure).\nModerate pericardial effusion. Volume overload physiology.",
                 "CV05-林書豪"),
                ("rpt_013", "pat_003", "imaging", "Chest X-ray post-HD", _dt(2025, 11, 1, 16, 0, tzinfo=tz8),
                 "Portable AP view of the chest (post-hemodialysis):\n- Dialysis catheter unchanged.\n- Interval improvement of pulmonary edema.\n- Decreased bilateral pleural effusions.\n- Persistent cardiomegaly.\n- No new consolidation or pneumothorax.",
                 "Interval improvement of pulmonary edema post-hemodialysis.\nPersistent cardiomegaly and small residual effusions.",
                 "RAD08-陳怡安"),
            ]
            for d in demos_003:
                exists = await conn.execute(text("SELECT 1 FROM diagnostic_reports WHERE id = :id"), {"id": d[0]})
                if exists.fetchone():
                    continue
                await conn.execute(
                    text(
                        "INSERT INTO diagnostic_reports (id, patient_id, report_type, exam_name, exam_date, body_text, impression, reporter_name) "
                        "VALUES (:id, :pid, :rt, :en, :ed, :bt, :imp, :rn)"
                    ),
                    {"id": d[0], "pid": d[1], "rt": d[2], "en": d[3], "ed": d[4], "bt": d[5], "imp": d[6], "rn": d[7]},
                )

            # --- pat_004 黃先生: 創傷性腦損傷 ---
            demos_004 = [
                ("rpt_014", "pat_004", "imaging", "CT Without C.M. Brain", _dt(2025, 11, 12, 2, 15, tzinfo=tz8),
                 "Non-contrast CT of the head (trauma protocol):\n- Right frontotemporal acute epidural hematoma (max thickness 15mm).\n- Midline shift 6mm to the left.\n- Right temporal bone linear fracture.\n- Diffuse cerebral edema with effacement of sulci and basal cisterns.\n- No intraventricular hemorrhage.\n- Pneumocephalus in the right frontal region.",
                 "Acute right frontotemporal epidural hematoma with mass effect.\nMidline shift 6mm. Right temporal bone fracture.\nDiffuse cerebral edema. Neurosurgical emergency.",
                 "RAD12-王志明"),
                ("rpt_015", "pat_004", "imaging", "CT C-spine without contrast", _dt(2025, 11, 12, 2, 30, tzinfo=tz8),
                 "Non-contrast CT of the cervical spine:\n- No acute cervical spine fracture or dislocation.\n- Mild degenerative changes at C5-C6 and C6-C7.\n- Prevertebral soft tissue within normal limits.\n- Spinal canal patent at all levels.\n- Bilateral vertebral artery foramina intact.",
                 "No acute cervical spine injury.\nMild degenerative changes at C5-C7.",
                 "RAD12-王志明"),
                ("rpt_016", "pat_004", "imaging", "CT Brain post-op follow-up", _dt(2025, 11, 13, 8, 0, tzinfo=tz8),
                 "Non-contrast CT of the head (post-craniotomy):\n- s/p right frontotemporal craniotomy for EDH evacuation.\n- Residual thin subdural collection along the right convexity (5mm).\n- Improved midline shift (now 2mm).\n- Persistent diffuse cerebral edema.\n- Right frontal EVD catheter with tip in the frontal horn of the right lateral ventricle.\n- Pneumocephalus decreased compared to prior.",
                 "Post-craniotomy changes with near-complete EDH evacuation.\nResidual thin subdural collection. Improved mass effect.\nEVD in satisfactory position.",
                 "RAD08-陳怡安"),
                ("rpt_017", "pat_004", "procedure", "清醒腦波 EEG", _dt(2025, 11, 16, 14, 0, tzinfo=tz8),
                 "Indication: post-traumatic brain injury, consciousness evaluation\n\nFinding:\n1. Background: diffuse theta-delta slowing (3-5 Hz, 20-50 uV), no posterior dominant rhythm.\n2. Right hemisphere: intermittent polymorphic delta activity (IPDA) over right frontotemporal region.\n3. Reactivity: minimal attenuation with painful stimulation.\n4. No definite epileptiform discharges.\n5. No electrographic seizures recorded during 30 minutes of monitoring.\n\nConclusion: severe diffuse encephalopathy with right hemispheric emphasis, consistent with structural lesion.",
                 "Severe diffuse encephalopathy with focal right hemispheric dysfunction.\nNo epileptiform discharges or electrographic seizures.",
                 "DAX32-廖岐禮"),
                ("rpt_018", "pat_004", "imaging", "Chest X-ray (Portable)", _dt(2025, 11, 14, 7, 0, tzinfo=tz8),
                 "Portable AP view of the chest:\n- ETT tip 3.5 cm above the carina.\n- NG tube tip in the stomach.\n- Right subclavian CVC with tip in the SVC.\n- Lungs: clear bilateral lung fields.\n- No pleural effusion or pneumothorax.\n- Heart size normal.",
                 "Lines and tubes in satisfactory position.\nNo acute cardiopulmonary abnormality.",
                 "RAD08-陳怡安"),
            ]
            for d in demos_004:
                exists = await conn.execute(text("SELECT 1 FROM diagnostic_reports WHERE id = :id"), {"id": d[0]})
                if exists.fetchone():
                    continue
                await conn.execute(
                    text(
                        "INSERT INTO diagnostic_reports (id, patient_id, report_type, exam_name, exam_date, body_text, impression, reporter_name) "
                        "VALUES (:id, :pid, :rt, :en, :ed, :bt, :imp, :rn)"
                    ),
                    {"id": d[0], "pid": d[1], "rt": d[2], "en": d[3], "ed": d[4], "bt": d[5], "imp": d[6], "rn": d[7]},
                )

            logger.info("[INTG][DB] diagnostic_reports table + demo data ensured (pat_001-004)")
    except Exception as e:
        logger.warning("[INTG][DB] diagnostic_reports failed (non-fatal): %s", e)


async def _migrate_vpn_letter_codes(engine: AsyncEngine) -> None:
    """Migrate advice_code and tags from numeric to VPN letter format (idempotent)."""
    CODE_MAP = {
        "1-1": "1-A", "1-2": "1-B", "1-3": "1-C", "1-4": "1-D",
        "1-5": "1-E", "1-6": "1-F", "1-7": "1-G", "1-8": "1-H",
        "1-9": "1-I", "1-10": "1-J", "1-11": "1-K", "1-12": "1-L",
        "1-13": "1-M",
        "2-1": "2-J", "2-2": "2-K", "2-3": "2-L", "2-4": "2-M",
        "2-5": "2-N", "2-6": "2-O", "2-7": "2-P", "2-8": "2-Q",
        "3-1": "3-R", "3-2": "3-S", "3-3": "3-T",
        "4-1": "4-U", "4-2": "4-V", "4-3": "4-W",
    }
    try:
        async with engine.begin() as conn:
            migrated = 0

            # 1. Migrate pharmacy_advices.advice_code
            result = await conn.execute(text(
                "SELECT COUNT(*) FROM pharmacy_advices WHERE advice_code ~ '^[0-9]+-[0-9]+$'"
            ))
            old_advice_count = result.scalar() or 0
            if old_advice_count > 0:
                for old, new in CODE_MAP.items():
                    await conn.execute(text(
                        "UPDATE pharmacy_advices SET advice_code = :new WHERE advice_code = :old"
                    ), {"old": old, "new": new})
                migrated += old_advice_count

            # 2. Migrate patient_messages.advice_code
            result = await conn.execute(text(
                "SELECT COUNT(*) FROM patient_messages WHERE advice_code ~ '^[0-9]+-[0-9]+$'"
            ))
            old_msg_code_count = result.scalar() or 0
            if old_msg_code_count > 0:
                for old, new in CODE_MAP.items():
                    await conn.execute(text(
                        "UPDATE patient_messages SET advice_code = :new WHERE advice_code = :old"
                    ), {"old": old, "new": new})
                migrated += old_msg_code_count

            # 3. Migrate tags JSONB array in patient_messages
            # Replace old-format tags like "1-1 給藥問題" → "1-A 給藥問題"
            result = await conn.execute(text(
                "SELECT COUNT(*) FROM patient_messages "
                "WHERE tags IS NOT NULL AND tags::text ~ '\"[0-9]+-[0-9]'"
            ))
            old_tag_count = result.scalar() or 0
            if old_tag_count > 0:
                for old, new in CODE_MAP.items():
                    # Simple text replacement in the JSONB text representation
                    # Replace "OLD " prefix (with space, for readable tags like "1-1 給藥問題")
                    await conn.execute(text(
                        "UPDATE patient_messages "
                        "SET tags = replace(tags::text, :old_tag, :new_tag)::jsonb "
                        "WHERE tags::text LIKE :search"
                    ), {
                        "old_tag": f'"{old} ',
                        "new_tag": f'"{new} ',
                        "search": f'%"{old} %',
                    })
                    # Replace bare "OLD" code (exact match in array)
                    await conn.execute(text(
                        "UPDATE patient_messages "
                        "SET tags = replace(tags::text, :old_bare, :new_bare)::jsonb "
                        "WHERE tags::text LIKE :search"
                    ), {
                        "old_bare": f'"{old}"',
                        "new_bare": f'"{new}"',
                        "search": f'%"{old}"%',
                    })
                migrated += old_tag_count

            if migrated > 0:
                logger.info("[INTG][DB] VPN letter codes migrated (%d advice + %d msg codes + %d msg tags)",
                            old_advice_count, old_msg_code_count, old_tag_count)
            else:
                logger.info("[INTG][DB] VPN letter codes already migrated, skipping")
    except Exception as e:
        logger.warning("[INTG][DB] VPN letter code migration failed (non-fatal): %s", e)
