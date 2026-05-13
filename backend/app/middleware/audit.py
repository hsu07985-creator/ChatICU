import json
import logging
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

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


# ── Diff helper for update audits ──
_DEFAULT_MAX_VALUE_CHARS = 200


def _normalize_for_diff(value: Any, max_chars: int) -> Any:
    """Make a value safe for JSONB storage and bounded in size.

    - datetime/date → ISO 8601 string (UTC for datetimes)
    - long strings → truncated with ellipsis marker
    - non-primitive containers passed through unchanged (caller responsible)
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str) and len(value) > max_chars:
        return value[:max_chars] + "…"
    return value


def diff_dict(
    before: dict,
    after: dict,
    *,
    include: Optional[Iterable[str]] = None,
    exclude: Optional[Iterable[str]] = None,
    max_value_chars: int = _DEFAULT_MAX_VALUE_CHARS,
) -> dict:
    """Compute a JSONB-safe diff between two state snapshots.

    Returns ``{"changes": {field: {"from": old, "to": new}, ...},
                "fields_changed": [field, ...]}``.

    - Only keys present in ``after`` are inspected (intended for partial
      updates where ``before`` is a full snapshot but ``after`` may be a
      subset of changed fields).
    - ``include`` / ``exclude`` further narrow the inspected key set.
    - Datetimes / dates are normalized to ISO strings; strings over
      ``max_value_chars`` are truncated with an ellipsis marker so JSONB
      rows don't blow up on long clinical assessments.
    - Sensitive keys (password/token/...) are masked downstream by
      ``_mask_sensitive`` when this dict is passed into ``create_audit_log``.
    """
    include_set = set(include) if include is not None else None
    exclude_set = set(exclude) if exclude is not None else set()

    changes: dict = {}
    for key in after.keys():
        if include_set is not None and key not in include_set:
            continue
        if key in exclude_set:
            continue
        old = before.get(key)
        new = after.get(key)
        if old == new:
            continue
        changes[key] = {
            "from": _normalize_for_diff(old, max_value_chars),
            "to": _normalize_for_diff(new, max_value_chars),
        }
    return {"changes": changes, "fields_changed": list(changes.keys())}


def snapshot_fields(obj: Any, fields: Iterable[str]) -> dict:
    """Read named attributes from an ORM object / dict into a plain dict.

    Used to capture the *before* state right before applying an update,
    so a later ``diff_dict(before, after)`` call can produce a clean diff.
    """
    if isinstance(obj, dict):
        return {f: obj.get(f) for f in fields}
    return {f: getattr(obj, f, None) for f in fields}


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
