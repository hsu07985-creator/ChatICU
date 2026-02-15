import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import Request as StarletteRequest

from app.database import get_db
from app.middleware.auth import require_roles
from app.middleware.audit import create_audit_log
from app.models.audit_log import AuditLog
from app.models.user import User, PasswordHistory
from app.schemas.admin import UserCreate, UserUpdate, UserListResponse
from app.utils.response import success_response
from app.utils.security import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])


# ============ AUDIT LOGS ============

@router.get("/audit-logs")
async def list_audit_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    action: str = Query(None),
    user_id_filter: str = Query(None, alias="userId"),
    status_filter: str = Query(None, alias="status"),
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    query = select(AuditLog)

    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if user_id_filter:
        query = query.where(AuditLog.user_id == user_id_filter)
    if status_filter:
        query = query.where(AuditLog.status == status_filter)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    offset = (page - 1) * limit
    result = await db.execute(
        query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit)
    )
    logs = result.scalars().all()

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
            User.name.ilike(f"%{search}%") | User.username.ilike(f"%{search}%")
        )
    if role:
        query = query.where(User.role == role)

    result = await db.execute(query.order_by(User.created_at))
    users = result.scalars().all()

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
            "embeddingModel": status.get("embedding_model", "tfidf"),
        })
    return success_response(data={"databases": databases})


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
    result = rag_service.index(chunks)

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
