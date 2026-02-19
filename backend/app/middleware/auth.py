import time
import logging
from typing import Dict, Optional

import redis.asyncio as redis
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.utils.security import decode_token

security = HTTPBearer(auto_error=False)
logger = logging.getLogger("chaticu")

COOKIE_ACCESS_KEY = "chaticu_access"
COOKIE_REFRESH_KEY = "chaticu_refresh"
COOKIE_LOGGED_IN_KEY = "chaticu_logged_in"

_redis_client: Optional[redis.Redis] = None


class _InMemoryRedis:
    """Development fallback when Redis is unavailable.

    Keeps key/value state in-process only, with basic expiry support.
    """

    def __init__(self) -> None:
        self._store: Dict[str, str] = {}
        self._expires_at: Dict[str, int] = {}

    def _purge_if_expired(self, key: str) -> None:
        expire_ts = self._expires_at.get(key)
        if expire_ts is not None and int(time.time()) >= expire_ts:
            self._store.pop(key, None)
            self._expires_at.pop(key, None)

    async def get(self, key: str):
        self._purge_if_expired(key)
        return self._store.get(key)

    async def setex(self, key: str, ttl_seconds: int, value: str):
        self._store[key] = str(value)
        self._expires_at[key] = int(time.time()) + int(ttl_seconds)
        return True

    async def delete(self, *keys: str):
        removed = 0
        for key in keys:
            existed = key in self._store or key in self._expires_at
            self._store.pop(key, None)
            self._expires_at.pop(key, None)
            if existed:
                removed += 1
        return removed

    async def incr(self, key: str):
        self._purge_if_expired(key)
        current = int(self._store.get(key, "0"))
        current += 1
        self._store[key] = str(current)
        return current

    async def expire(self, key: str, ttl_seconds: int):
        if key not in self._store:
            return False
        self._expires_at[key] = int(time.time()) + int(ttl_seconds)
        return True

    async def ping(self):
        return True

    async def close(self):
        return None


async def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        redis_kwargs = {"decode_responses": True}
        if settings.REDIS_URL.startswith("rediss://"):
            import ssl as _ssl
            _cert_map = {"required": _ssl.CERT_REQUIRED, "optional": _ssl.CERT_OPTIONAL, "none": _ssl.CERT_NONE}
            redis_kwargs["ssl_cert_reqs"] = _cert_map.get(settings.REDIS_SSL_CERT_REQS, _ssl.CERT_REQUIRED)
        real_client = redis.from_url(settings.REDIS_URL, **redis_kwargs)
        try:
            await real_client.ping()
            _redis_client = real_client
        except Exception as exc:
            if not settings.DEBUG:
                logger.error(
                    "[F02] Redis unavailable at %s — refusing to start without Redis in production. %s",
                    settings.REDIS_URL, exc,
                )
                raise RuntimeError(
                    f"Redis connection failed ({settings.REDIS_URL}). "
                    "Set DEBUG=true for in-memory fallback (dev only)."
                )
            logger.warning(
                "[F02] SECURITY: Using InMemoryRedis fallback — "
                "token blacklist, account lockout, and idle timeout are NOT persistent. "
                "Redis unavailable at %s: %s",
                settings.REDIS_URL, exc,
            )
            _redis_client = _InMemoryRedis()  # type: ignore[assignment]
    return _redis_client


def _extract_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials],
) -> str:
    """Extract access token from httpOnly cookie (preferred) or Authorization header."""
    cookie_token = request.cookies.get(COOKIE_ACCESS_KEY)
    if cookie_token:
        return cookie_token
    if credentials:
        return credentials.credentials
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = _extract_token(request, credentials)

    # Check if token is blacklisted
    redis_client = await get_redis()
    is_blacklisted = await redis_client.get(f"blacklist:{token}")
    if is_blacklisted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # ── Idle timeout check ──
    idle_key = f"last_activity:{user_id}"
    last_activity = await redis_client.get(idle_key)
    idle_limit = settings.SESSION_IDLE_TIMEOUT_MINUTES * 60
    now = int(time.time())

    if last_activity and (now - int(last_activity)) > idle_limit:
        # Blacklist the current token so it can't be reused
        await redis_client.setex(
            f"blacklist:{token}",
            settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "1",
        )
        await redis_client.delete(idle_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired due to inactivity",
        )

    # Update last activity timestamp
    await redis_client.setex(idle_key, idle_limit, str(now))

    return user


def require_roles(*roles: str):
    async def role_checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user
    return role_checker


def set_auth_cookies(response, access_token: str, refresh_token: str) -> None:
    """Set httpOnly JWT cookies on a response object."""
    secure = not settings.DEBUG and settings.COOKIE_SECURE
    samesite = settings.COOKIE_SAMESITE
    response.set_cookie(
        key=COOKIE_ACCESS_KEY,
        value=access_token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key=COOKIE_REFRESH_KEY,
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth",
    )
    # Non-httpOnly indicator so frontend can check login state without /auth/me
    response.set_cookie(
        key=COOKIE_LOGGED_IN_KEY,
        value="1",
        httponly=False,
        secure=secure,
        samesite=samesite,
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/",
    )


def clear_auth_cookies(response) -> None:
    """Clear all auth cookies."""
    response.delete_cookie(COOKIE_ACCESS_KEY, path="/")
    response.delete_cookie(COOKIE_REFRESH_KEY, path="/auth")
    response.delete_cookie(COOKIE_LOGGED_IN_KEY, path="/")
