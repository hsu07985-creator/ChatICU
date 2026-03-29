import traceback

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


@router.get("/health/db-check")
async def db_migration_check(db: AsyncSession = Depends(get_db)):
    """Temporary diagnostic: check alembic version and table columns."""
    info = {}
    try:
        result = await db.execute(text("SELECT version_num FROM alembic_version"))
        rows = result.fetchall()
        info["alembic_version"] = [r[0] for r in rows]
    except Exception as e:
        info["alembic_version_error"] = str(e)
    try:
        result = await db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'users' AND table_schema = 'public' ORDER BY ordinal_position"
        ))
        info["public_users_columns"] = [r[0] for r in result.fetchall()]
    except Exception as e:
        info["public_users_columns_error"] = str(e)
    try:
        result = await db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'users' AND table_schema = 'auth' ORDER BY ordinal_position"
        ))
        info["auth_users_columns"] = [r[0] for r in result.fetchall()]
    except Exception as e:
        info["auth_users_columns_error"] = str(e)
    try:
        result = await db.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        ))
        info["tables"] = [r[0] for r in result.fetchall()]
    except Exception as e:
        info["tables_error"] = str(e)
    return success_response(data=info)


@router.post("/health/run-migration")
async def run_migration(db: AsyncSession = Depends(get_db)):
    """Temporary: attempt to run pending migrations and return result."""
    results = []
    try:
        # Check current version
        result = await db.execute(text("SELECT version_num FROM alembic_version"))
        current = [r[0] for r in result.fetchall()]
        results.append(f"current_version: {current}")

        # Add updated_at to all tables that need it
        tables = [
            "patients", "medications", "users", "vital_signs", "lab_data",
            "ventilator_settings", "weaning_assessments", "patient_messages",
            "team_chat_messages", "pharmacy_advices", "error_reports",
            "audit_logs", "drug_interactions", "iv_compatibilities",
        ]
        for tbl in tables:
            result = await db.execute(text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :tbl AND column_name = 'updated_at'"
            ), {"tbl": tbl})
            if result.fetchone() is None:
                try:
                    await db.execute(text(
                        f"ALTER TABLE {tbl} ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
                    ))
                    await db.commit()
                    results.append(f"added updated_at to {tbl}")
                except Exception as e:
                    results.append(f"error adding to {tbl}: {str(e)}")
                    await db.rollback()
            else:
                results.append(f"updated_at already exists on {tbl}")

        # Update alembic version
        await db.execute(text(
            "UPDATE alembic_version SET version_num = '023_fix_updated_at' "
            "WHERE version_num IN ('022_pgvector_rag', '023_fix_updated_at')"
        ))
        await db.commit()
        results.append("updated alembic_version to 023")
    except Exception as e:
        results.append(f"error: {str(e)}")
        results.append(traceback.format_exc()[-500:])
    return success_response(data={"results": results})


@router.get("/health/users-check")
async def users_check(db: AsyncSession = Depends(get_db)):
    """Temporary: list usernames in public.users."""
    try:
        result = await db.execute(text(
            "SELECT username, email, role, active FROM public.users LIMIT 20"
        ))
        rows = [{"username": r[0], "email": r[1], "role": r[2], "active": r[3]} for r in result.fetchall()]
        return success_response(data={"users": rows, "count": len(rows)})
    except Exception as e:
        return success_response(data={"error": str(e)})


@router.get("/")
async def root():
    return success_response(data={
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    })
