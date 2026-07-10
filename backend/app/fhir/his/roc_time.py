"""Date/time helpers for HIS data (民國年 / ROC calendar) plus small id utils."""

import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional


def _roc_to_date(roc_str: Optional[str]) -> Optional[date]:
    """民國年字串 → date。支援格式：YYYMMDD (7碼) 或 YYMMDD (6碼)。

    Examples:
        "1150407" → 2026-04-07
        "0530405" → 1964-04-05
        "1140101" → 2025-01-01
    """
    if not roc_str or not roc_str.strip():
        return None
    s = roc_str.strip()
    # Remove any separators
    s = s.replace("/", "").replace("-", "")
    if not s.isdigit():
        return None
    if len(s) == 7:
        roc_year = int(s[:3])
        month = int(s[3:5])
        day = int(s[5:7])
    elif len(s) == 6:
        roc_year = int(s[:2])
        month = int(s[2:4])
        day = int(s[4:6])
    else:
        return None
    western_year = roc_year + 1911
    try:
        return date(western_year, month, day)
    except ValueError:
        return None


def _roc_to_datetime(roc_date: Optional[str], time_str: Optional[str] = None) -> Optional[datetime]:
    """民國年日期 + HHMM 時間 → datetime(UTC)。

    HIS timestamps are Taiwan local time (UTC+8).  We parse as local
    then convert to UTC for storage.
    """
    d = _roc_to_date(roc_date)
    if d is None:
        return None
    hour, minute = 0, 0
    if time_str and len(time_str) >= 4 and time_str[:4].isdigit():
        hour = int(time_str[:2])
        minute = int(time_str[2:4])
    _TW = timezone(timedelta(hours=8))
    try:
        return datetime(d.year, d.month, d.day, hour, minute, tzinfo=_TW).astimezone(timezone.utc)
    except ValueError:
        return datetime(d.year, d.month, d.day, tzinfo=_TW).astimezone(timezone.utc)


def _roc_birthday_to_age(birthday: Optional[str]) -> Optional[int]:
    """民國年生日 → 年齡。"""
    bd = _roc_to_date(birthday)
    if bd is None:
        return None
    today = date.today()
    age = today.year - bd.year
    if (today.month, today.day) < (bd.month, bd.day):
        age -= 1
    return max(0, min(age, 200))


def _gen_id(prefix: str, *parts: str) -> str:
    """Generate a deterministic short ID from parts."""
    raw = "|".join(str(p) for p in parts)
    # Deterministic fingerprint for ID generation, not a security control.
    h = hashlib.md5(raw.encode(), usedforsecurity=False).hexdigest()[:8]
    return f"{prefix}_{h}"


def _normalize_patient_gender(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"m", "male", "男"}:
        return "男"
    if raw in {"f", "female", "女"}:
        return "女"
    return "Other"
