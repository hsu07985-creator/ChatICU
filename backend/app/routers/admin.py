import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import Request as StarletteRequest

from app.database import get_db
from app.middleware.auth import require_roles
from app.middleware.audit import create_audit_log
from app.models.audit_log import AuditLog
from app.models.user import User, PasswordHistory
from app.schemas.admin import UserCreate, UserUpdate, UserListResponse
from app.utils.response import escape_like, success_response
from app.utils.security import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)

_VECTOR_ALLOWED_EXTENSIONS = frozenset({".pdf", ".docx", ".txt"})
_VECTOR_COLLECTION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_VECTOR_UPLOAD_MAX_BYTES = 25 * 1024 * 1024  # 25 MiB


def _parse_iso_datetime(value: str, field_name: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid {field_name} format: {value}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_collection_name(raw_value: str) -> str:
    collection = (raw_value or "").strip()
    if not collection:
        raise HTTPException(status_code=422, detail="collection is required")
    if not _VECTOR_COLLECTION_RE.fullmatch(collection):
        raise HTTPException(
            status_code=422,
            detail="Invalid collection. Use letters/numbers/_/- and max 64 chars.",
        )
    return collection


def _normalize_upload_filename(raw_filename: str) -> str:
    filename = Path(raw_filename or "").name.strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Missing upload filename")
    ext = Path(filename).suffix.lower()
    if ext not in _VECTOR_ALLOWED_EXTENSIONS:
        allowlist = ", ".join(sorted(_VECTOR_ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension: {ext or '(none)'}. Allowed: {allowlist}",
        )
    return filename


def _parse_upload_metadata(metadata_raw: Optional[str]) -> dict:
    if not metadata_raw:
        return {}
    try:
        parsed = json.loads(metadata_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="metadata must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="metadata must be a JSON object")
    return parsed


# ============ AUDIT LOGS ============

@router.get("/audit-logs")
async def list_audit_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    action: str = Query(None),
    user_name_filter: str = Query(None, alias="user"),
    user_id_filter: str = Query(None, alias="userId"),
    status_filter: str = Query(None, alias="status"),
    start_date: str = Query(None, alias="startDate"),
    end_date: str = Query(None, alias="endDate"),
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(AuditLog)

    if action:
        query = query.where(AuditLog.action.ilike(f"%{escape_like(action)}%"))
    if user_name_filter:
        query = query.where(AuditLog.user_name.ilike(f"%{escape_like(user_name_filter)}%"))
    if user_id_filter:
        query = query.where(AuditLog.user_id == user_id_filter)
    if status_filter:
        query = query.where(AuditLog.status == status_filter)
    if start_date:
        start_dt = _parse_iso_datetime(start_date, "startDate")
        query = query.where(AuditLog.timestamp >= start_dt)
    if end_date:
        end_dt = _parse_iso_datetime(end_date, "endDate")
        if "T" not in end_date and len(end_date.strip()) <= 10:
            end_dt = end_dt + timedelta(days=1) - timedelta(microseconds=1)
        query = query.where(AuditLog.timestamp <= end_dt)

    logger.info(
        "[INTG][API][DB] list_audit_logs filters action=%s user=%s userId=%s status=%s startDate=%s endDate=%s",
        action,
        user_name_filter,
        user_id_filter,
        status_filter,
        start_date,
        end_date,
    )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    offset = (page - 1) * limit
    result = await db.execute(
        query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit)
    )
    logs = result.scalars().all()

    # Stats: count success/failed across the *filtered* result set
    success_q = select(func.count()).select_from(
        query.where(AuditLog.status == "success").subquery()
    )
    success_count = (await db.execute(success_q)).scalar() or 0
    failed_count = total - success_count

    return success_response(data={
        "logs": [
            {
                "id": log.id,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "userId": log.user_id,
                "user": log.user_name,
                "role": log.role,
                "action": log.action,
                "target": log.target,
                "status": log.status,
                "ip": log.ip,
                "details": log.details,
            }
            for log in logs
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit,
        },
        "stats": {
            "total": total,
            "success": success_count,
            "failed": failed_count,
        },
    })


# ============ USER MANAGEMENT ============

@router.get("/users")
async def list_users(
    search: str = Query(None),
    role: str = Query(None),
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(User)

    if search:
        query = query.where(
            User.name.ilike(f"%{escape_like(search)}%") | User.username.ilike(f"%{escape_like(search)}%")
        )
    if role:
        query = query.where(User.role == role)

    result = await db.execute(query.order_by(User.created_at))
    users = result.scalars().all()

    # Compute stats from full (unfiltered) user set (F18)
    all_result = await db.execute(select(User))
    all_users = all_result.scalars().all()
    role_counts = {"admin": 0, "doctor": 0, "nurse": 0, "pharmacist": 0}
    active_count = 0
    for u in all_users:
        if u.active:
            active_count += 1
        if u.role in role_counts:
            role_counts[u.role] += 1

    return success_response(data={
        "users": [
            {
                "id": u.id,
                "name": u.name,
                "username": u.username,
                "email": u.email,
                "role": u.role,
                "unit": u.unit,
                "active": u.active,
                "lastLogin": u.last_login.isoformat() if u.last_login else None,
                "createdAt": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ],
        "stats": {
            "total": len(all_users),
            "active": active_count,
            "byRole": role_counts,
        },
    })


@router.post("/users")
async def create_user(
    request: StarletteRequest,
    body: UserCreate,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    # Check username uniqueness
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")

    new_user = User(
        id=f"usr_{uuid.uuid4().hex[:6]}",
        name=body.name,
        username=body.username,
        password_hash=hash_password(body.password),
        email=body.email,
        role=body.role,
        unit=body.unit,
        active=True,
        password_changed_at=datetime.now(timezone.utc),
    )
    db.add(new_user)
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="建立使用者", target=new_user.username, status="success",
        ip=request.client.host if request.client else None,
        details={"new_user_id": new_user.id, "new_role": new_user.role},
    )

    return success_response(data={
        "id": new_user.id,
        "name": new_user.name,
        "username": new_user.username,
        "email": new_user.email,
        "role": new_user.role,
        "unit": new_user.unit,
        "active": new_user.active,
        "lastLogin": None,
        "createdAt": new_user.created_at.isoformat() if new_user.created_at else None,
    }, message="使用者已建立")


@router.get("/users/{user_id}")
async def get_user(
    user_id: str,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    return success_response(data={
        "id": target_user.id,
        "name": target_user.name,
        "username": target_user.username,
        "email": target_user.email,
        "role": target_user.role,
        "unit": target_user.unit,
        "active": target_user.active,
        "lastLogin": target_user.last_login.isoformat() if target_user.last_login else None,
        "createdAt": target_user.created_at.isoformat() if target_user.created_at else None,
    })


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    request: StarletteRequest,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = body.model_dump(exclude_unset=True)
    if "password" in update_data:
        new_password = update_data.pop("password")
        # Record old hash in password history
        from app.config import settings as app_settings
        entry = PasswordHistory(
            id=f"pwh_{uuid.uuid4().hex[:12]}",
            user_id=target_user.id,
            password_hash=target_user.password_hash,
        )
        db.add(entry)
        target_user.password_hash = hash_password(new_password)
        target_user.password_changed_at = datetime.now(timezone.utc)

    for key, value in update_data.items():
        setattr(target_user, key, value)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="更新使用者", target=target_user.username, status="success",
        ip=request.client.host if request.client else None,
        details={"target_user_id": user_id, "fields_changed": list(body.model_dump(exclude_unset=True).keys())},
    )

    return success_response(data={
        "id": target_user.id,
        "name": target_user.name,
        "username": target_user.username,
        "email": target_user.email,
        "role": target_user.role,
        "unit": target_user.unit,
        "active": target_user.active,
        "lastLogin": target_user.last_login.isoformat() if target_user.last_login else None,
        "createdAt": target_user.created_at.isoformat() if target_user.created_at else None,
    }, message="使用者已更新")


# ============ VECTOR DATABASE (real RAG service) ============


@router.get("/vectors")
async def list_vector_databases(
    user: User = Depends(require_roles("admin")),
):
    from app.services.llm_services.rag_service import rag_service
    status = rag_service.get_status() if hasattr(rag_service, "get_status") else {}
    databases = []
    if rag_service.is_indexed:
        databases.append({
            "id": "rag-main",
            "name": "RAG 醫療文件庫",
            "documentCount": status.get("total_documents", 0),
            "chunkCount": status.get("total_chunks", 0),
            "status": "active",
            "embeddingModel": status.get("embedding_model", "unknown"),
        })
    return success_response(data={"databases": databases})


@router.post("/vectors/upload")
async def upload_vector_document(
    request: StarletteRequest,
    file: UploadFile = File(...),
    collection: str = Form("clinical-guidelines"),
    metadata: Optional[str] = Form(None),
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    from app.config import settings as app_settings
    from app.services.llm_services.rag_service import rag_service

    if not app_settings.RAG_DOCS_PATH:
        raise HTTPException(status_code=400, detail="RAG_DOCS_PATH not configured")

    collection_name = _normalize_collection_name(collection)
    upload_filename = _normalize_upload_filename(file.filename or "")
    metadata_payload = _parse_upload_metadata(metadata)

    docs_root = Path(app_settings.RAG_DOCS_PATH).expanduser()
    if docs_root.exists() and not docs_root.is_dir():
        raise HTTPException(status_code=400, detail="RAG_DOCS_PATH must be a directory")
    docs_root.mkdir(parents=True, exist_ok=True)

    target_dir = docs_root / collection_name
    target_dir.mkdir(parents=True, exist_ok=True)

    file_stem = Path(upload_filename).stem
    file_ext = Path(upload_filename).suffix.lower()
    target_path = target_dir / upload_filename
    if target_path.exists():
        target_path = target_dir / f"{file_stem}-{uuid.uuid4().hex[:8]}{file_ext}"

    file_bytes = await file.read()
    await file.close()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(file_bytes) > _VECTOR_UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded file exceeds {_VECTOR_UPLOAD_MAX_BYTES // (1024 * 1024)} MiB limit",
        )

    target_path.write_bytes(file_bytes)

    try:
        chunks = rag_service.load_and_chunk(str(docs_root))
        result = await rag_service.index(chunks)
    except Exception as exc:
        logger.exception(
            "[INTG][API][ADMIN] vectors upload reindex failed file=%s collection=%s",
            upload_filename,
            collection_name,
        )
        raise HTTPException(status_code=500, detail=f"Vector indexing failed: {exc}") from exc
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message", "Vector indexing failed"))

    database = {
        "id": "rag-main",
        "name": "RAG 醫療文件庫",
        "documentCount": result.get("total_documents", 0),
        "chunkCount": result.get("total_chunks", 0),
        "status": "active",
        "embeddingModel": rag_service.get_status().get("embedding_model", "unknown"),
    }

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="上傳向量文件", target="rag-main", status="success",
        ip=request.client.host if request.client else None,
        details={
            "collection": collection_name,
            "file_name": target_path.name,
            "file_size_bytes": len(file_bytes),
            "metadata": metadata_payload,
            "total_chunks": result.get("total_chunks", 0),
        },
    )

    return success_response(
        data={
            "documentId": f"doc_{uuid.uuid4().hex[:10]}",
            "fileName": target_path.name,
            "collection": collection_name,
            "status": "indexed",
            "database": database,
            "metadata": metadata_payload,
        },
        message=f"文件已上傳並完成索引：{target_path.name}",
    )


@router.post("/vectors/rebuild")
async def rebuild_vector_index(
    request: StarletteRequest,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    from app.config import settings as app_settings
    from app.services.llm_services.rag_service import rag_service
    if not app_settings.RAG_DOCS_PATH:
        raise HTTPException(status_code=400, detail="RAG_DOCS_PATH not configured")

    chunks = rag_service.load_and_chunk(app_settings.RAG_DOCS_PATH)
    result = await rag_service.index(chunks)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="重建向量索引", target="rag-main", status="success",
        ip=request.client.host if request.client else None,
        details={"total_chunks": result.get("total_chunks", 0)},
    )

    return success_response(
        data=result,
        message=f"索引重建完成: {result.get('total_chunks', 0)} chunks",
    )


@router.get("/db-status")
async def db_status(
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Check DB migration status and table existence."""
    from sqlalchemy import text as sa_text
    info = {}
    try:
        result = await db.execute(sa_text("SELECT version_num FROM alembic_version"))
        info["alembic_version"] = result.scalar()
    except Exception as e:
        info["alembic_version"] = f"error: {e}"
    try:
        result = await db.execute(sa_text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'diagnostic_reports'"
        ))
        info["diagnostic_reports_exists"] = result.fetchone() is not None
    except Exception as e:
        info["diagnostic_reports_exists"] = f"error: {e}"
    try:
        result = await db.execute(sa_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'medications' AND column_name = 'source_type'"
        ))
        info["medications_source_type_exists"] = result.fetchone() is not None
    except Exception as e:
        info["medications_source_type_exists"] = f"error: {e}"
    return success_response(data=info)


@router.post("/fix-diagnostic-reports")
async def fix_diagnostic_reports(
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    """One-time fix: create diagnostic_reports table and seed demo data."""
    import traceback
    from sqlalchemy import text as sa_text

    steps = []
    try:
        # Step 1: Create table
        await db.execute(sa_text(
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
        await db.commit()
        steps.append("table_created")

        # Step 2: Create index
        await db.execute(sa_text(
            "CREATE INDEX IF NOT EXISTS ix_diagnostic_reports_patient_id "
            "ON diagnostic_reports (patient_id)"
        ))
        await db.commit()
        steps.append("index_created")

        # Step 3: Seed demo data (asyncpg needs real datetime objects, not strings)
        from datetime import timezone as tz, timedelta
        tz8 = tz(timedelta(hours=8))
        demos = [
            {"id": "rpt_001", "pid": "pat_001", "rt": "imaging", "en": "CT Without C.M. Brain",
             "ed": datetime(2025, 10, 20, 10, 30, 0, tzinfo=tz8),
             "bt": "CT of head without contrast enhancement shows:\n- s/p right lateral ventricle drainage.\n- brain atrophy with prominent sulci.\n- confluent hypodensity at periventricular white matter.\n- old insult in left patietal-occipital-temporal lobes.\n- lacunes at bilateral basal ganglia, thalami, pons.\n- atherosclerosis in intracranial arteries.",
             "imp": "Brain atrophy. old insults and lacunes. post-operative changes.\nSuggest clinical correlation.", "rn": "RAD12-王志明"},
            {"id": "rpt_002", "pid": "pat_001", "rt": "imaging", "en": "Chest X-ray (Portable)",
             "ed": datetime(2025, 10, 18, 8, 15, 0, tzinfo=tz8),
             "bt": "Portable AP view of the chest:\n- ETT tip at approximately 3 cm above carina.\n- NG tube tip in stomach.\n- Right subclavian CVC with tip in SVC.\n- Bilateral diffuse ground-glass opacities.\n- No pneumothorax. Mild cardiomegaly.",
             "imp": "Bilateral diffuse infiltrates, compatible with ARDS or pulmonary edema.\nLines and tubes in satisfactory position.", "rn": "RAD08-陳怡安"},
            {"id": "rpt_003", "pid": "pat_001", "rt": "procedure", "en": "清醒腦波 EEG",
             "ed": datetime(2025, 11, 5, 14, 0, 0, tzinfo=tz8),
             "bt": "Indication: conscious change\n\nFinding:\n1. Diffuse background slowing, theta predominant.\n2. No epileptiform discharge.\n\nConclusion: diffuse cortical dysfunction.",
             "imp": "Diffuse cortical dysfunction. No epileptiform discharge.", "rn": "DAX32-廖岐禮"},
            {"id": "rpt_004", "pid": "pat_001", "rt": "procedure", "en": "Echocardiography (TTE)",
             "ed": datetime(2025, 10, 25, 11, 0, 0, tzinfo=tz8),
             "bt": "TTE:\n- LV systolic function: mildly reduced, EF 45%.\n- Global hypokinesis.\n- Mild MR, mild TR.\n- No pericardial effusion.\n- IVC dilated, estimated RAP 10-15 mmHg.",
             "imp": "Mildly reduced LV systolic function (EF ~45%).\nMild MR/TR. Elevated RAP.", "rn": "CV05-林書豪"},
            {"id": "rpt_005", "pid": "pat_001", "rt": "imaging", "en": "Chest CT with contrast",
             "ed": datetime(2025, 11, 10, 9, 45, 0, tzinfo=tz8),
             "bt": "CT chest with IV contrast:\n- No PE identified.\n- Bilateral pleural effusions.\n- Bilateral dependent consolidations.\n- Diffuse ground-glass opacity.\n- ETT, CVC and NG tube in satisfactory position.",
             "imp": "No PE. Bilateral pleural effusions and consolidations.\nDifferential: atelectasis, infection, or ARDS.", "rn": "RAD12-王志明"},
        ]
        inserted = 0
        for d in demos:
            exists = await db.execute(sa_text("SELECT 1 FROM diagnostic_reports WHERE id = :id"), {"id": d["id"]})
            if exists.fetchone():
                continue
            await db.execute(
                sa_text(
                    "INSERT INTO diagnostic_reports (id, patient_id, report_type, exam_name, exam_date, body_text, impression, reporter_name) "
                    "VALUES (:id, :pid, :rt, :en, :ed, :bt, :imp, :rn)"
                ), d,
            )
            inserted += 1
        await db.commit()
        steps.append(f"seeded_{inserted}")

        return success_response(
            data={"steps": steps, "inserted": inserted},
            message=f"OK: {', '.join(steps)}",
        )
    except Exception as e:
        tb = traceback.format_exc()
        return success_response(
            data={"steps": steps, "error": str(e), "traceback": tb},
            message=f"Failed at step after {steps}: {e}",
        )
