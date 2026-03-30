from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.utils.response import success_response

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return success_response(data={
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
    })


@router.get("/health/db")
async def db_check(db: AsyncSession = Depends(get_db)):
    import os
    result = await db.execute(text("SELECT version_num FROM alembic_version"))
    rows = [r[0] for r in result.fetchall()]
    tables_result = await db.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    ))
    tables = [r[0] for r in tables_result.fetchall()]
    # List migration files on disk
    versions_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "alembic", "versions")
    migration_files = sorted(os.listdir(versions_dir)) if os.path.isdir(versions_dir) else [f"DIR NOT FOUND: {versions_dir}"]
    return success_response(data={
        "alembic_version": rows,
        "tables": tables,
        "migration_files": migration_files,
        "cwd": os.getcwd(),
        "versions_dir": versions_dir,
    })


@router.get("/health/init-cultures")
async def init_cultures(db: AsyncSession = Depends(get_db)):
    """One-time endpoint to create culture_results table and seed data."""
    import json, uuid
    try:
        exists = await db.scalar(text(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='culture_results')"
        ))
        if exists:
            count = await db.scalar(text("SELECT COUNT(*) FROM culture_results"))
            return success_response(data={"status": "already_exists", "row_count": count})

        await db.execute(text("""
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
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_culture_results_patient_id ON culture_results(patient_id)"
        ))

        seed_cultures = [
            ("pat_001","M11411L014001","Sputum","SP01","加護病房一","2025-11-10T08:30:00+08:00","2025-11-13T14:00:00+08:00",
             [{"code":"XORG1","organism":"Stenotrophomonas maltophilia"}],
             [{"antibiotic":"Levofloxacin","code":"LVX","result":"S"},{"antibiotic":"Trimethoprim/Sulfamethoxazole","code":"SXT","result":"S"}]),
            ("pat_001","M11411L014002","Sputum","SP01","加護病房一","2025-11-05T06:15:00+08:00","2025-11-08T10:30:00+08:00",
             [{"code":"XORG2","organism":"Klebsiella pneumoniae"}],
             [{"antibiotic":"Meropenem","code":"MEM","result":"S"},{"antibiotic":"Ceftazidime","code":"CAZ","result":"R"},
              {"antibiotic":"Piperacillin/Tazobactam","code":"TZP","result":"I"},{"antibiotic":"Amikacin","code":"AMK","result":"S"}]),
            ("pat_001","M11410L036001","Blood","BL01","加護病房一","2025-10-28T17:00:00+08:00","2025-10-31T13:00:00+08:00",[],[]),
            ("pat_001","M11410L036002","Sputum","SP03","加護病房一","2025-10-25T09:00:00+08:00","2025-10-28T11:00:00+08:00",[],[]),
            ("pat_002","M11411L020001","Blood","BL01","加護病房一","2025-11-12T03:00:00+08:00","2025-11-15T09:30:00+08:00",
             [{"code":"XORG1","organism":"Escherichia coli"},{"code":"XORG2","organism":"Enterococcus faecalis"}],
             [{"antibiotic":"Ampicillin","code":"AMP","result":"R"},{"antibiotic":"Ceftriaxone","code":"CRO","result":"S"},
              {"antibiotic":"Ciprofloxacin","code":"CIP","result":"R"},{"antibiotic":"Meropenem","code":"MEM","result":"S"},
              {"antibiotic":"Vancomycin","code":"VAN","result":"S"}]),
            ("pat_002","M11411L020002","Urine(導尿)","UR024","加護病房一","2025-11-12T03:10:00+08:00","2025-11-14T16:00:00+08:00",
             [{"code":"XORG1","organism":"Escherichia coli"}],
             [{"antibiotic":"Ampicillin","code":"AMP","result":"R"},{"antibiotic":"Ceftriaxone","code":"CRO","result":"S"},
              {"antibiotic":"Ciprofloxacin","code":"CIP","result":"R"},{"antibiotic":"Nitrofurantoin","code":"NIT","result":"S"}]),
            ("pat_002","M11411L020003","Blood","BL01","加護病房一","2025-11-08T22:00:00+08:00","2025-11-11T14:00:00+08:00",[],[]),
            ("pat_003","M11411L025001","Urine(導尿)","UR024","加護病房一","2025-11-14T10:00:00+08:00","2025-11-17T11:00:00+08:00",
             [{"code":"XORG1","organism":"Candida albicans"}],
             [{"antibiotic":"Fluconazole","code":"FCA","result":"S"},{"antibiotic":"Amphotericin B","code":"AMB","result":"S"},
              {"antibiotic":"Caspofungin","code":"CAS","result":"S"}]),
            ("pat_003","M11411L025002","Blood","BL01","加護病房一","2025-11-14T10:05:00+08:00","2025-11-17T15:00:00+08:00",[],[]),
            ("pat_003","M11411L025003","Urine(導尿)","UR024","加護病房一","2025-11-08T08:00:00+08:00","2025-11-10T14:00:00+08:00",[],[]),
            ("pat_004","M11411L030001","Wound","WD01","加護病房一","2025-11-15T14:00:00+08:00","2025-11-18T10:00:00+08:00",
             [{"code":"XORG1","organism":"Staphylococcus aureus (MSSA)"}],
             [{"antibiotic":"Oxacillin","code":"OXA","result":"S"},{"antibiotic":"Vancomycin","code":"VAN","result":"S"},
              {"antibiotic":"Clindamycin","code":"CLI","result":"S"},{"antibiotic":"Trimethoprim/Sulfamethoxazole","code":"SXT","result":"S"}]),
            ("pat_004","M11411L030002","CSF","CS01","加護病房一","2025-11-15T14:30:00+08:00","2025-11-18T16:00:00+08:00",[],[]),
        ]
        for pid, sheet, spec, scode, dept, col, rep, iso, susc in seed_cultures:
            cid = f"culture_{uuid.uuid4().hex[:12]}"
            await db.execute(text(
                "INSERT INTO culture_results "
                "(id,patient_id,sheet_number,specimen,specimen_code,department,"
                "collected_at,reported_at,isolates,susceptibility,created_at,updated_at) "
                "VALUES (:id,:pid,:sheet,:spec,:scode,:dept,"
                "CAST(:col_at AS timestamptz),CAST(:rep_at AS timestamptz),CAST(:iso AS jsonb),CAST(:susc AS jsonb),NOW(),NOW())"
            ).bindparams(id=cid,pid=pid,sheet=sheet,spec=spec,scode=scode,dept=dept,
                         col_at=col,rep_at=rep,iso=json.dumps(iso),susc=json.dumps(susc)))
        await db.commit()
        return success_response(data={"status": "created", "rows_seeded": len(seed_cultures)})
    except Exception as exc:
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


@router.get("/")
async def root():
    return success_response(data={
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    })
