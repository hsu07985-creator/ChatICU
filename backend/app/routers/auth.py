import logging
import uuid
from datetime import datetime, timedelta, timezone

from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select

logger = logging.getLogger("chaticu")
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import (
    COOKIE_REFRESH_KEY,
    clear_auth_cookies,
    get_current_user,
    get_redis,
    set_auth_cookies,
)
from app.middleware.audit import create_audit_log
from app.middleware.rate_limit import limiter
from app.models.user import User, PasswordHistory
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    RefreshResponse,
    ResetPasswordInitRequest,
    ResetPasswordRequest,
    UserResponse,
)
from app.utils.response import error_response, success_response
from app.utils.security import (
    check_password_history,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    validate_password_strength,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Account Lockout (configurable via env: F10) ──────────────────────
MAX_LOGIN_ATTEMPTS = settings.MAX_LOGIN_ATTEMPTS
LOCKOUT_SECONDS = settings.LOCKOUT_SECONDS

ROLE_PERMISSIONS = {
    "nurse": ["view_patients", "chat_ai", "edit_nursing_records", "view_medications", "team_chat"],
    "doctor": ["view_patients", "chat_ai", "edit_nursing_records", "view_medications", "team_chat", "progress_note", "prescribe_medications"],
    "admin": ["view_patients", "chat_ai", "edit_nursing_records", "view_medications", "team_chat", "progress_note", "prescribe_medications", "manage_users", "manage_vectors", "view_audit_logs", "pharmacy_tools"],
    "pharmacist": ["view_medications", "team_chat", "pharmacy_tools", "medication_advice", "error_reports"],
}


@router.post("/login")
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    redis_client = await get_redis()
    lockout_key = f"lockout:{body.username}"
    attempts_key = f"login_attempts:{body.username}"

    # ── Check account lockout ──
    if await redis_client.get(lockout_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="帳號已鎖定，請 15 分鐘後再試",
        )

    result = await db.execute(
        select(User).where(User.username == body.username)
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        # ── Increment failed attempts ──
        attempts = await redis_client.incr(attempts_key)
        await redis_client.expire(attempts_key, LOCKOUT_SECONDS)
        if attempts >= MAX_LOGIN_ATTEMPTS:
            await redis_client.setex(lockout_key, LOCKOUT_SECONDS, "1")

        # Only write DB audit when user exists to avoid FK violations on unknown username.
        if user:
            await create_audit_log(
                db, user_id=user.id, user_name=user.name,
                role=user.role, action="用戶登入", target="系統",
                status="failed", ip=request.client.host if request.client else None,
                details={"reason": "Invalid credentials", "attempt": attempts},
            )
        else:
            logger.warning("[INTG][API][AUTH] Login failed for unknown username=%s", body.username)
        remaining = MAX_LOGIN_ATTEMPTS - attempts
        detail = "帳號或密碼錯誤"
        if 0 < remaining <= 2:
            detail += f"（剩餘 {remaining} 次嘗試）"
        elif remaining <= 0:
            detail = "帳號已鎖定，請 15 分鐘後再試"
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
        )

    if not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="帳號已停用",
        )

    # ── Login success: reset attempt counter ──
    await redis_client.delete(attempts_key)
    await redis_client.delete(lockout_key)

    user.last_login = datetime.now(timezone.utc)

    # ── Password expiry check (T07) ──
    password_expired = False
    if user.password_changed_at:
        expiry_date = user.password_changed_at + timedelta(days=settings.PASSWORD_EXPIRY_DAYS)
        if datetime.now(timezone.utc) > expiry_date:
            password_expired = True

    token_data = {"sub": user.id, "username": user.username, "role": user.role}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name,
        role=user.role, action="用戶登入", target="系統",
        status="success", ip=request.client.host if request.client else None,
    )

    body_data = success_response(data={
        "user": {
            "id": user.id,
            "name": user.name,
            "role": user.role,
            "unit": user.unit,
            "email": user.email,
        },
        "token": access_token,
        "refreshToken": refresh_token,
        "expiresIn": settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "passwordExpired": password_expired,
    })
    response = JSONResponse(content=body_data)
    set_auth_cookies(response, access_token, refresh_token)
    return response


@router.post("/logout")
async def logout(
    request: Request,
    body: Optional[dict] = Body(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    redis_client = await get_redis()

    # Blacklist access token from cookie or header
    access_token = request.cookies.get("chaticu_access")
    if not access_token:
        auth_header = request.headers.get("authorization", "")
        access_token = auth_header.replace("Bearer ", "") if auth_header else None
    if access_token:
        await redis_client.setex(
            f"blacklist:{access_token}",
            settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "1",
        )

    # Blacklist refresh token from cookie or body
    refresh_tok = request.cookies.get(COOKIE_REFRESH_KEY)
    if not refresh_tok and body and body.get("refreshToken"):
        refresh_tok = body["refreshToken"]
    if refresh_tok:
        await redis_client.setex(
            f"blacklist:{refresh_tok}",
            settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            "1",
        )

    await create_audit_log(
        db, user_id=user.id, user_name=user.name,
        role=user.role, action="用戶登出", target="系統",
        status="success", ip=request.client.host if request.client else None,
    )

    response = JSONResponse(content=success_response(message="登出成功"))
    clear_auth_cookies(response)
    return response


@router.post("/refresh")
async def refresh_token(
    request: Request,
    body: Optional[RefreshRequest] = Body(default=None),
    db: AsyncSession = Depends(get_db),
):
    # Accept refresh token from body (API/tests) or cookie (browser)
    raw_refresh = None
    if body and body.refreshToken:
        raw_refresh = body.refreshToken
    if not raw_refresh:
        raw_refresh = request.cookies.get(COOKIE_REFRESH_KEY)
    if not raw_refresh:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token provided",
        )

    # Check if refresh token is blacklisted
    redis_client = await get_redis()
    is_blacklisted = await redis_client.get(f"blacklist:{raw_refresh}")
    if is_blacklisted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked",
        )

    payload = decode_token(raw_refresh)
    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    token_data = {"sub": user.id, "username": user.username, "role": user.role}
    new_access_token = create_access_token(token_data)
    new_refresh_token = create_refresh_token(token_data)

    # Refresh token rotation: blacklist the old refresh token
    await redis_client.setex(
        f"blacklist:{raw_refresh}",
        settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        "1",
    )

    body_data = success_response(data={
        "token": new_access_token,
        "refreshToken": new_refresh_token,
        "expiresIn": settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    })
    response = JSONResponse(content=body_data)
    set_auth_cookies(response, new_access_token, new_refresh_token)
    return response


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return success_response(data={
        "id": user.id,
        "name": user.name,
        "role": user.role,
        "unit": user.unit,
        "email": user.email,
        "permissions": ROLE_PERMISSIONS.get(user.role, []),
    })


# ── Password Change (T07) ───────────────────────────────────────────

async def _record_password_history(db: AsyncSession, user_id: str, old_hash: str) -> None:
    """Save old hash to password_history; trim to keep only last N entries."""
    entry = PasswordHistory(
        id=f"pwh_{uuid.uuid4().hex[:12]}",
        user_id=user_id,
        password_hash=old_hash,
    )
    db.add(entry)
    await db.flush()

    # Keep only the most recent PASSWORD_HISTORY_COUNT entries
    result = await db.execute(
        select(PasswordHistory)
        .where(PasswordHistory.user_id == user_id)
        .order_by(PasswordHistory.created_at.desc())
    )
    all_entries = result.scalars().all()
    for old_entry in all_entries[settings.PASSWORD_HISTORY_COUNT:]:
        await db.delete(old_entry)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify current password
    if not verify_password(body.currentPassword, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="目前密碼不正確",
        )

    # Validate new password strength
    strength_error = validate_password_strength(body.newPassword)
    if strength_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=strength_error)

    # Check new password != current password
    if verify_password(body.newPassword, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密碼不可與目前密碼相同",
        )

    # Check password history (last 5)
    result = await db.execute(
        select(PasswordHistory)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(settings.PASSWORD_HISTORY_COUNT)
    )
    history_entries = result.scalars().all()
    history_hashes = [e.password_hash for e in history_entries]

    if check_password_history(body.newPassword, history_hashes):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"新密碼不可與最近 {settings.PASSWORD_HISTORY_COUNT} 次使用過的密碼相同",
        )

    # Save old hash to history, update password
    await _record_password_history(db, user.id, user.password_hash)
    user.password_hash = hash_password(body.newPassword)
    user.password_changed_at = datetime.now(timezone.utc)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="變更密碼", target=user.username, status="success",
        ip=request.client.host if request.client else None,
    )

    return success_response(message="密碼已變更，請重新登入")


# ── Password Reset (T08) — configurable via env (F16) ────────────────

RESET_TOKEN_EXPIRE_MINUTES = settings.RESET_TOKEN_EXPIRE_MINUTES


@router.post("/reset-password-request")
@limiter.limit("3/minute")
async def reset_password_request(
    request: Request,
    body: ResetPasswordInitRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate a one-time reset token. In production, this would be emailed."""
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    # Always return success to prevent username enumeration
    if not user or not user.active:
        return success_response(message="若帳號存在，重設連結已發送至信箱")

    # Generate one-time token stored in Redis
    redis_client = await get_redis()
    reset_token = uuid.uuid4().hex
    redis_key = f"reset_token:{reset_token}"
    await redis_client.setex(redis_key, RESET_TOKEN_EXPIRE_MINUTES * 60, user.id)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="密碼重設請求", target=user.username, status="success",
        ip=request.client.host if request.client else None,
    )

    # Token is stored in Redis only. In production, send email with reset link.
    # Token is NOT returned in the API response for security.
    logger.info(
        "Password reset token generated for user=%s (token stored in Redis, TTL=%dm)",
        user.username, RESET_TOKEN_EXPIRE_MINUTES,
    )

    return success_response(message="若帳號存在，重設連結已發送至信箱")


@router.post("/reset-password")
async def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Consume one-time reset token and set new password."""
    redis_client = await get_redis()
    redis_key = f"reset_token:{body.token}"
    user_id = await redis_client.get(redis_key)

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="重設連結無效或已過期",
        )

    # Decode bytes from Redis if needed
    if isinstance(user_id, bytes):
        user_id = user_id.decode()

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="使用者不存在")

    # Validate new password strength
    strength_error = validate_password_strength(body.newPassword)
    if strength_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=strength_error)

    # Check password history
    hist_result = await db.execute(
        select(PasswordHistory)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(settings.PASSWORD_HISTORY_COUNT)
    )
    history_hashes = [e.password_hash for e in hist_result.scalars().all()]

    # Also check current password
    if verify_password(body.newPassword, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密碼不可與目前密碼相同",
        )

    if check_password_history(body.newPassword, history_hashes):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"新密碼不可與最近 {settings.PASSWORD_HISTORY_COUNT} 次使用過的密碼相同",
        )

    # Consume the token (one-time use)
    await redis_client.delete(redis_key)

    # Save old hash to history, update password
    await _record_password_history(db, user.id, user.password_hash)
    user.password_hash = hash_password(body.newPassword)
    user.password_changed_at = datetime.now(timezone.utc)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="密碼重設", target=user.username, status="success",
        ip=request.client.host if request.client else None,
    )

    return success_response(message="密碼已重設，請使用新密碼登入")
