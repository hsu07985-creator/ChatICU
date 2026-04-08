"""Startup DB migration fallbacks for Railway deployment.

Railway's Alembic chain sometimes breaks, so these idempotent fallbacks
ensure the schema and seed data are correct regardless of migration state.
All operations are best-effort (non-fatal on failure).
"""

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
    await _ensure_patient_campus(engine)
    await _seed_outpatient_demo(engine)
    await _ensure_diagnostic_reports(engine)
    await _ensure_performance_indexes(engine)


async def _ensure_updated_at_columns(engine: AsyncEngine) -> None:
    tables = [
        "users", "audit_logs", "patients", "medications", "lab_data",
        "vital_signs", "ventilator_settings", "ventilator_modes",
        "messages", "chat_messages", "drug_interactions", "iv_compatibilities",
        "pharmacy_advices", "ai_sessions", "medication_administrations",
        "error_reports", "record_templates",
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
        icu_seed = seeds_dir / "icu_drug_interactions.json"
        seed_path = full_seed if full_seed.exists() else (icu_seed if icu_seed.exists() else None)

        if not seed_path:
            return

        interactions = json.loads(seed_path.read_text("utf-8"))
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
                    ":deps, :dtypes, :im, :pmids, :dk, :bh "
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


async def _ensure_performance_indexes(engine: AsyncEngine) -> None:
    try:
        async with engine.begin() as conn:
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
            # Convert drug_interactions JSON-as-Text columns to JSONB
            for col in ("dependencies", "dependency_types", "interacting_members", "pubmed_ids"):
                try:
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
            logger.info("[INTG][DB] diagnostic_reports table + demo data ensured")
    except Exception as e:
        logger.warning("[INTG][DB] diagnostic_reports failed (non-fatal): %s", e)
