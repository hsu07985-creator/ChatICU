import time
import logging
from typing import Optional

import redis.asyncio as redis
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.utils.security import decode_token

security = HTTPBearer()
logger = logging.getLogger("chaticu")

_redis_client: Optional[redis.Redis] = None


class _InMemoryRedis:
    """Development fallback when Redis is unavailable.

    Keeps key/value state in-process only, with basic expiry support.
    """

    def __init__(self) -> None:
        self._store: dict[str, str] = {}
        self._expires_at: dict[str, int] = {}

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
        real_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        try:
            await real_client.ping()
            _redis_client = real_client
        except Exception:
            if not settings.DEBUG:
                logger.error(
                    "Redis unavailable at %s — refusing to start without Redis in production.",
                    settings.REDIS_URL,
                )
                raise RuntimeError(
                    f"Redis connection failed ({settings.REDIS_URL}). "
                    "Set DEBUG=true for in-memory fallback (dev only)."
                )
            logger.warning(
                "Redis unavailable at %s; falling back to in-memory cache (DEBUG mode only).",
                settings.REDIS_URL,
            )
            _redis_client = _InMemoryRedis()  # type: ignore[assignment]
    return _redis_client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials

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
