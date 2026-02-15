import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── Password Hashing ─────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


# ── Password Policy (T07) ────────────────────────────────────────────

MIN_PASSWORD_LENGTH = 12


def validate_password_strength(password: str) -> Optional[str]:
    """Return error message if password fails policy, else None."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"密碼長度至少 {MIN_PASSWORD_LENGTH} 字元"
    if not re.search(r"[A-Z]", password):
        return "密碼須包含至少一個大寫字母"
    if not re.search(r"[a-z]", password):
        return "密碼須包含至少一個小寫字母"
    if not re.search(r"\d", password):
        return "密碼須包含至少一個數字"
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{}|;':\",./<>?]", password):
        return "密碼須包含至少一個特殊字元"
    return None


def check_password_history(plain_password: str, history_hashes: List[str]) -> bool:
    """Return True if plain_password matches any hash in history_hashes."""
    for h in history_hashes:
        if pwd_context.verify(plain_password, h):
            return True
    return False


# ── JWT Token Management ─────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    now = datetime.now(timezone.utc)
    to_encode = data.copy()
    expire = now + (
        expires_delta
        or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({
        "exp": expire,
        "iat": now,
        "jti": uuid.uuid4().hex,
        "type": "access",
    })
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    now = datetime.now(timezone.utc)
    to_encode = data.copy()
    expire = now + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({
        "exp": expire,
        "iat": now,
        "jti": uuid.uuid4().hex,
        "type": "refresh",
    })
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        return None
