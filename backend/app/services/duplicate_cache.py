"""Duplicate-medication cache layer (Wave 4a).

Wraps the pure :class:`app.services.duplicate_detector.DuplicateDetector` with a
per-patient cache backed by the ``medication_duplicate_cache`` table
(see migration 063). Cache freshness is decided purely by comparing a SHA-256
hash of the current active-medication set against the stored hash — no TTL.

Usage (from a router / background task)::

    from app.services.duplicate_cache import (
        get_cached_duplicates, refresh_patient_cache,
    )

    cached = await get_cached_duplicates(db, pid, meds, context)
    if cached is not None:
        alerts, counts = cached
    else:
        alerts, counts = await refresh_patient_cache(db, pid, meds, context)

Design notes:
  * Hash domain = sorted tuple of (medication_id, atc_code, status, updated_at).
    ``status`` catches "same drug re-activated" or "active→discontinued"
    transitions that would otherwise leave updated_at unchanged.
  * Context is part of the validity check: a cache written under "inpatient"
    does **not** satisfy a read that wants "discharge" (rules differ).
  * Every function is async and exception-safe. If the cache read fails we
    return ``None`` so the caller falls back to recomputation. If the cache
    write fails we log-warn but still return the fresh alerts/counts — the
    main flow is never blocked on a cache side-effect.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.medication import Medication
from app.models.medication_duplicate_cache import MedicationDuplicateCache
from app.services.duplicate_detector import (
    DuplicateAlert,
    DuplicateDetector,
    DuplicateMember,
)

logger = logging.getLogger(__name__)

Context = Literal["inpatient", "outpatient", "icu", "discharge"]


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------
def compute_medications_hash(meds: List[Medication]) -> str:
    """SHA-256 of sorted ``(medication_id, atc_code, status, updated_at)`` tuples.

    Accepts ORM ``Medication`` rows or dicts with equivalent attribute / key
    names. ``updated_at`` is rendered as an ISO-8601 string so the hash is
    stable regardless of timezone representation on the DB round-trip.
    """
    rows: List[Tuple[str, str, str, str]] = []
    for m in meds or []:
        if m is None:
            continue
        mid = _read_attr(m, "id", "medication_id") or ""
        atc = _read_attr(m, "atc_code", "atcCode") or ""
        status = _read_attr(m, "status") or ""
        updated = _read_attr(m, "updated_at", "updatedAt")
        updated_str = _iso(updated)
        rows.append((str(mid), str(atc), str(status), updated_str))

    rows.sort()
    canonical = "|".join("::".join(r) for r in rows)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _read_attr(obj, *names: str):
    """Read the first available attribute / dict key from ``names``."""
    if isinstance(obj, dict):
        for n in names:
            if n in obj and obj[n] is not None:
                return obj[n]
        return None
    for n in names:
        val = getattr(obj, n, None)
        if val is not None:
            return val
    return None


def _iso(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


# ---------------------------------------------------------------------------
# (de)serialisation
# ---------------------------------------------------------------------------
def alerts_to_jsonb(alerts: List[DuplicateAlert]) -> List[dict]:
    """Convert a list of :class:`DuplicateAlert` to a JSON-serialisable list.

    Uses :meth:`DuplicateAlert.to_dict`, which already emits camelCase for the
    frontend contract. Storing the same shape in the cache keeps the API
    response path identical whether the data comes from cache or fresh compute.
    """
    return [a.to_dict() for a in alerts or []]


def jsonb_to_alerts(data: List[dict]) -> List[DuplicateAlert]:
    """Reverse of :func:`alerts_to_jsonb` — reconstruct DuplicateAlert objects.

    Tolerates missing fields so a slightly older cache shape (e.g. from before
    ``auto_downgraded`` / ``downgrade_reason`` were added) still loads.
    """
    out: List[DuplicateAlert] = []
    for row in data or []:
        if not isinstance(row, dict):
            continue
        try:
            out.append(_dict_to_alert(row))
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("duplicate_cache: skip malformed cached alert: %s", exc)
    return out


def _dict_to_alert(row: dict) -> DuplicateAlert:
    members_raw = row.get("members") or []
    members: List[DuplicateMember] = []
    for mr in members_raw:
        if not isinstance(mr, dict):
            continue
        last_admin = mr.get("lastAdminAt") or mr.get("last_admin_at")
        members.append(
            DuplicateMember(
                medication_id=str(
                    mr.get("medicationId") or mr.get("medication_id") or ""
                ),
                generic_name=str(
                    mr.get("genericName") or mr.get("generic_name") or ""
                ),
                atc_code=mr.get("atcCode") or mr.get("atc_code"),
                route=mr.get("route"),
                is_prn=bool(mr.get("isPrn") or mr.get("is_prn") or False),
                last_admin_at=_coerce_dt(last_admin),
            )
        )
    return DuplicateAlert(
        fingerprint=str(row.get("fingerprint") or ""),
        level=row.get("level") or "info",  # type: ignore[arg-type]
        layer=row.get("layer") or "L1",  # type: ignore[arg-type]
        mechanism=str(row.get("mechanism") or ""),
        members=members,
        recommendation=str(row.get("recommendation") or ""),
        evidence_url=row.get("evidenceUrl") or row.get("evidence_url"),
        auto_downgraded=bool(
            row.get("autoDowngraded") or row.get("auto_downgraded") or False
        ),
        downgrade_reason=row.get("downgradeReason") or row.get("downgrade_reason"),
    )


def _coerce_dt(val) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            s = val.replace("Z", "+00:00")
            return datetime.fromisoformat(s)
        except Exception:
            return None
    return None


def _tally_counts(alerts: List[DuplicateAlert]) -> Dict[str, int]:
    counts = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}
    for a in alerts or []:
        counts[a.level] = counts.get(a.level, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# Public cache API
# ---------------------------------------------------------------------------
async def get_cached_duplicates(
    session: AsyncSession,
    patient_id: str,
    meds: List[Medication],
    context: Context,
) -> Optional[Tuple[List[DuplicateAlert], Dict[str, int]]]:
    """Return cached ``(alerts, counts)`` if and only if the cache is valid.

    A cache row is valid when:
      * a row for ``patient_id`` exists;
      * its ``medications_hash`` equals :func:`compute_medications_hash` of the
        passed ``meds`` list; and
      * its ``context`` matches the requested ``context``.

    On any DB error we log-warn and return ``None`` so the caller can fall
    back to recomputation — the cache is advisory only and must never block
    the main flow.
    """
    try:
        row = await _fetch_cache_row(session, patient_id)
    except Exception as exc:
        logger.warning(
            "duplicate_cache: read failed for patient=%s: %s", patient_id, exc
        )
        return None

    if row is None:
        return None

    expected_hash = compute_medications_hash(meds)
    if row.medications_hash != expected_hash:
        return None
    if (row.context or "") != context:
        return None

    alerts = jsonb_to_alerts(row.alerts_json or [])
    counts = dict(row.counts or {}) or _tally_counts(alerts)
    # Backfill missing severity keys so callers can index blindly.
    for lvl in ("critical", "high", "moderate", "low", "info"):
        counts.setdefault(lvl, 0)
    return alerts, counts


async def refresh_patient_cache(
    session: AsyncSession,
    patient_id: str,
    meds: Optional[List[Medication]] = None,
    context: Context = "inpatient",
) -> Tuple[List[DuplicateAlert], Dict[str, int]]:
    """Force a recompute and upsert the cache row.

    If ``meds`` is None, loads active medications for the patient.
    Always returns fresh ``(alerts, counts)`` — cache-write failures are
    swallowed (logged at WARN) so the main flow is unaffected.
    """
    if meds is None:
        meds = await _load_active_medications(session, patient_id)

    detector = DuplicateDetector(session)
    alerts = await detector.analyze(meds, context=context)  # type: ignore[arg-type]
    counts = _tally_counts(alerts)

    try:
        await _upsert_cache_row(
            session,
            patient_id=patient_id,
            meds_hash=compute_medications_hash(meds),
            alerts=alerts,
            counts=counts,
            context=context,
        )
    except Exception as exc:
        logger.warning(
            "duplicate_cache: write failed for patient=%s: %s", patient_id, exc
        )

    return alerts, counts


async def invalidate_patient_cache(
    session: AsyncSession,
    patient_id: str,
) -> None:
    """Delete the cache row for a patient. Errors are logged and swallowed."""
    try:
        row = await _fetch_cache_row(session, patient_id)
        if row is not None:
            await session.delete(row)
            await session.flush()
    except Exception as exc:
        logger.warning(
            "duplicate_cache: invalidate failed for patient=%s: %s",
            patient_id,
            exc,
        )


# ---------------------------------------------------------------------------
# DB helpers (private)
# ---------------------------------------------------------------------------
async def _fetch_cache_row(
    session: AsyncSession, patient_id: str
) -> Optional[MedicationDuplicateCache]:
    stmt = select(MedicationDuplicateCache).where(
        MedicationDuplicateCache.patient_id == patient_id
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def _upsert_cache_row(
    session: AsyncSession,
    *,
    patient_id: str,
    meds_hash: str,
    alerts: List[DuplicateAlert],
    counts: Dict[str, int],
    context: str,
) -> None:
    """Insert or update the cache row. Portable across SQLite (tests) & PG."""
    now = datetime.now(timezone.utc)
    payload = alerts_to_jsonb(alerts)

    existing = await _fetch_cache_row(session, patient_id)
    if existing is None:
        row = MedicationDuplicateCache(
            patient_id=patient_id,
            computed_at=now,
            medications_hash=meds_hash,
            alerts_json=payload,
            context=context,
            counts=counts,
        )
        session.add(row)
    else:
        existing.computed_at = now
        existing.medications_hash = meds_hash
        existing.alerts_json = payload
        existing.context = context
        existing.counts = counts
    await session.flush()


async def _load_active_medications(
    session: AsyncSession, patient_id: str
) -> List[Medication]:
    """Load active medications for a patient.

    Kept module-local (rather than imported from a router) so consumers of the
    cache layer do not need to reach into the router for the same query.
    """
    stmt = select(Medication).where(
        (Medication.patient_id == patient_id) & (Medication.status == "active")
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())
