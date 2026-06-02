"""Pure helper functions for duplicate detection.

Normalisation, datetime coercion, ATC wildcard matching, fingerprinting,
salt-suffix stripping and overlap/spread window predicates. No DB access,
no DuplicateDetector state.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from .knowledge import _ACTIVE_WINDOW_HOURS, _SALT_SUFFIXES
from .models import DuplicateMember


def _normalize_med(m: Any) -> dict:
    """Normalise an ORM Medication or fixture dict into a uniform dict.

    Supported source shapes:
      * ORM ``Medication`` — uses .id / .generic_name / .atc_code / .route /
        .prn; last_admin_at falls back to .end_date or .updated_at.
      * dict — either ORM-style keys or fixture-style keys (medication_id,
        generic_name, atc_code, route, is_prn, last_admin_at).
    """
    if m is None:
        raise ValueError("medication is None")

    if isinstance(m, dict):
        med_id = m.get("medication_id") or m.get("id")
        generic = m.get("generic_name") or m.get("genericName") or m.get("name") or ""
        atc = m.get("atc_code") or m.get("atcCode")
        route = m.get("route")
        is_prn = bool(m.get("is_prn", m.get("prn", False)))
        last_admin = m.get("last_admin_at") or m.get("lastAdminAt")
    else:
        med_id = getattr(m, "id", None)
        generic = (
            getattr(m, "generic_name", None)
            or getattr(m, "name", None)
            or ""
        )
        atc = getattr(m, "atc_code", None)
        route = getattr(m, "route", None)
        is_prn = bool(getattr(m, "prn", False))
        # P0-1 fix: ORM Medication has no last_admin_at column. The previous
        # `or getattr(m, "updated_at", None)` fallback silently dropped chronic
        # active meds whose row hadn't been HIS-synced in 48h (chronic ACEI +
        # ARB became invisible to the duplicate detector → 0 alerts on a
        # genuine RAAS-blockade patient).
        #
        # Conservative behaviour: leave last_admin_at None when no real
        # admin-time field exists. _is_inactive() already returns False on
        # None ("we cannot prove it is inactive, keep it"), so chronic meds
        # stay in the dedup pool. Cost: a truly inactive med whose row
        # somehow still has status='active' would not be filtered — but the
        # status filter at the cache layer already gates that, and a false
        # positive alert is far safer than a silent miss.
        last_admin = getattr(m, "last_admin_at", None)

    return {
        "medication_id": str(med_id) if med_id is not None else "",
        "generic_name": (generic or "").strip(),
        "atc_code": (atc or "").strip() or None if atc else None,
        "route": (route or "").strip() or None if route else None,
        "is_prn": is_prn,
        "last_admin_at": _coerce_datetime(last_admin),
    }


def _coerce_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            v = value.replace("Z", "+00:00")
            dt = datetime.fromisoformat(v)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _is_inactive(m: dict, ref_time: datetime) -> bool:
    """Treat a medication as inactive when its last_admin_at is > 48h old."""
    last = m.get("last_admin_at")
    if last is None:
        # No admin timestamp — keep the med; we cannot prove it is inactive.
        return False
    try:
        delta = ref_time - last
    except TypeError:
        return False
    return delta > timedelta(hours=_ACTIVE_WINDOW_HOURS)


def _is_valid_atc(atc: Optional[str], *, min_len: int) -> bool:
    if not atc:
        return False
    s = atc.strip()
    return len(s) >= min_len


def _to_duplicate_member(m: dict) -> DuplicateMember:
    return DuplicateMember(
        medication_id=m["medication_id"],
        generic_name=m["generic_name"],
        atc_code=m.get("atc_code"),
        route=m.get("route"),
        is_prn=bool(m.get("is_prn")),
        last_admin_at=m.get("last_admin_at"),
    )


def _make_fingerprint(members: List[DuplicateMember]) -> str:
    """SHA-256(sorted medication_ids)[:16] — deterministic per member set."""
    ids = sorted((m.medication_id or "") for m in members)
    joined = "|".join(ids)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def _atc_match(atc: str, pattern: str) -> bool:
    """ATC wildcard matcher.

    - ``pattern`` ending in ``*`` → prefix match (e.g. ``A02BC*``).
    - otherwise exact-string match.
    """
    if not atc or not pattern:
        return False
    if pattern.endswith("*"):
        return atc.startswith(pattern[:-1])
    return atc == pattern


def _pair_matches(a: str, b: str, pat1: str, pat2: str) -> bool:
    """Unordered pair match against (pat1, pat2)."""
    return (
        (_atc_match(a, pat1) and _atc_match(b, pat2))
        or (_atc_match(a, pat2) and _atc_match(b, pat1))
    )


def _strip_salt_suffix(name: str) -> str:
    """Best-effort ingredient salt stripping for display.

    Handles common salts: sodium, potassium, magnesium, calcium, hydrochloride,
    sulfate, tartrate, maleate, mesylate, phosphate, succinate, fumarate.
    """
    if not name:
        return name
    lowered = name.lower()
    for suffix in _SALT_SUFFIXES:
        if lowered.endswith(" " + suffix):
            return name[: -(len(suffix) + 1)].strip()
    return name.strip()


def _salt_differs(members: List[DuplicateMember]) -> bool:
    """Detect salt-form switch heuristically: same stripped ingredient,
    different raw generic_name tail."""
    raws = {(m.generic_name or "").strip().lower() for m in members}
    stripped = {_strip_salt_suffix((m.generic_name or "").strip()).lower() for m in members}
    return len(raws) > 1 and len(stripped) == 1


def _overlap_within(members: List[DuplicateMember], hours: int) -> bool:
    """True if the spread of last_admin_at values across members ≤ `hours`."""
    times = [m.last_admin_at for m in members if m.last_admin_at]
    if len(times) < 2:
        return False
    try:
        spread = max(times) - min(times)
    except TypeError:
        return False
    return spread <= timedelta(hours=hours)


def _spread_at_least(members: List[DuplicateMember], hours: int) -> bool:
    """True if the spread of last_admin_at values across members ≥ `hours`."""
    times = [m.last_admin_at for m in members if m.last_admin_at]
    if len(times) < 2:
        return False
    try:
        spread = max(times) - min(times)
    except TypeError:
        return False
    return spread >= timedelta(hours=hours)


def _any_member_discontinued(
    members: List[DuplicateMember], ref_time: datetime
) -> bool:
    """True if any member has an explicit discontinuation signal.

    Today DuplicateMember only carries a coarse ``last_admin_at`` proxy and does
    not surface ``status`` / ``end_date`` from the source Medication row; we
    deliberately return False rather than inferring "stale last_admin_at ≈
    stopped", because Phase 3 will plumb the real administrations table and we
    don't want to silently downgrade duplicates based on a proxy that may be
    weeks out of date for chronic meds.

    TODO(Phase 3): extend DuplicateMember + _normalize_med to carry
    ``end_date`` and ``status`` (e.g. "active" / "discontinued" / "held"), then
    return True when any member is explicitly discontinued before ref_time.
    """
    _ = (members, ref_time)  # reserved for Phase 3
    return False
