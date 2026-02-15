import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog

logger = logging.getLogger("chaticu.audit")

# ── Sensitive field masking ──
SENSITIVE_KEYS = {"password", "password_hash", "token", "refreshToken", "resetToken",
                  "currentPassword", "newPassword", "secret", "apiKey", "api_key"}
SENSITIVE_PATTERN = re.compile(r"(password|token|secret|key)", re.IGNORECASE)


def _mask_sensitive(data: Optional[dict]) -> Optional[dict]:
    """Recursively mask sensitive fields in details dict."""
    if not data:
        return data
    masked = {}
    for k, v in data.items():
        if k.lower() in SENSITIVE_KEYS or SENSITIVE_PATTERN.search(k):
            masked[k] = "***MASKED***"
        elif isinstance(v, dict):
            masked[k] = _mask_sensitive(v)
        else:
            masked[k] = v
    return masked


async def create_audit_log(
    db: AsyncSession,
    user_id: str,
    user_name: str,
    role: str,
    action: str,
    target: Optional[str] = None,
    status: str = "success",
    ip: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    # Mask sensitive fields before persisting
    safe_details = _mask_sensitive(details)

    log = AuditLog(
        id=f"audit_{uuid.uuid4().hex[:12]}",
        timestamp=datetime.now(timezone.utc),
        user_id=user_id,
        user_name=user_name,
        role=role,
        action=action,
        target=target,
        status=status,
        ip=ip,
        details=safe_details,
    )
    db.add(log)
    await db.flush()

    # Structured JSON log output for SIEM/log aggregator
    logger.info(json.dumps({
        "event": "audit",
        "ts": log.timestamp.isoformat(),
        "user_id": user_id,
        "user_name": user_name,
        "role": role,
        "action": action,
        "target": target,
        "status": status,
        "ip": ip,
        "details": safe_details,
    }, ensure_ascii=False))
