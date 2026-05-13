import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
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
    role_filter: str = Query(None, alias="role"),
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
    if role_filter:
        query = query.where(AuditLog.role == role_filter)
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
        "[INTG][API][DB] list_audit_logs filters action=%s user=%s userId=%s role=%s status=%s startDate=%s endDate=%s",
        action,
        user_name_filter,
        user_id_filter,
        role_filter,
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
    role_counts = {"admin": 0, "doctor": 0, "np": 0, "nurse": 0, "pharmacist": 0}
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
        raise HTTPException(status_code=400, detail="此帳號已存在")

    # Check email uniqueness
    if body.email:
        existing_email = await db.execute(select(User).where(User.email == body.email))
        if existing_email.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="此電子郵件已被使用")

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
    # Prevent admin from disabling their own account (would lock themselves out)
    if update_data.get("active") is False and target_user.id == user.id:
        raise HTTPException(status_code=400, detail="無法停用自己的帳號")
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


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    request: StarletteRequest,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Try to hard-delete the user. If FK references exist (audit logs, chat
    messages, etc.) the DB will reject the DELETE — fall back to soft-delete
    (active=false) in the same transaction so audit trail is preserved.
    """
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="無法刪除自己的帳號")

    result = await db.execute(select(User).where(User.id == user_id))
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    target_username = target_user.username
    target_user_id = target_user.id

    deleted = False
    try:
        async with db.begin_nested():
            await db.delete(target_user)
            await db.flush()
        deleted = True
    except IntegrityError:
        # Savepoint rolled back; reload the row and soft-delete instead
        result = await db.execute(select(User).where(User.id == user_id))
        target_user = result.scalar_one_or_none()
        if target_user:
            target_user.active = False

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="刪除使用者" if deleted else "停用使用者(刪除失敗)",
        target=target_username, status="success",
        ip=request.client.host if request.client else None,
        details={"target_user_id": target_user_id, "hardDeleted": deleted},
    )

    message = (
        "使用者已刪除"
        if deleted
        else "此帳號有歷史紀錄無法刪除，已改為停用"
    )
    return success_response(
        data={"id": target_user_id, "hardDeleted": deleted},
        message=message,
    )


# Vector DB endpoints removed in Phase 1 D2a (RAG layer dropped).


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


