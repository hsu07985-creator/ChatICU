"""Snapshot build / refresh lifecycle for the ICU chat stream.

Two endpoints (``chat_stream`` first turn, ``refresh_session_snapshot``) build
the per-session clinical snapshot metadata the SAME way; that duplicated block
lives here. The fire-and-forget background deferred-fill task also lives here.

Monkeypatch contract (preserved):
  Tests patch ``app.routers.ai_chat.build_critical_snapshot`` and
  ``app.routers.ai_chat._fill_deferred_snapshot_bg``. To keep those patch
  points effective, the router passes its OWN module-level references for the
  critical-snapshot builder and the deferred-fill task into the helpers here
  (resolved at call time), rather than this module importing them directly.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional, Tuple

from sqlalchemy import select

from app.database import async_session
from app.models.ai_session import AISession
from app.services.patient_context_builder import build_deferred_snapshot

logger = logging.getLogger("chaticu")


async def _fill_deferred_snapshot_bg(
    session_id: str, patient_id: str, intubated: bool
) -> None:
    """Fire-and-forget background task: fetch deferred snapshot sections
    (vent / reports / scores) and persist into AISession.snapshot_metadata.

    Runs on its own AsyncSession (the request session is already closed
    by the time this fires). Failures are non-fatal — chat keeps working
    with critical-only snapshot if this background fill never completes.

    W3-T2: writes via PostgreSQL JSONB ``||`` merge so concurrent writers
    can't last-write-wins each other. SQLite (tests) falls back to the
    classic read-modify-write because it has no JSONB merge operator;
    the test harness has no concurrent writers so the race window is
    moot anyway.
    """
    try:
        async with async_session() as bg_db:
            deferred_text = await build_deferred_snapshot(
                patient_id, bg_db, intubated=intubated
            )
            payload = {
                "clinical_snapshot_deferred": deferred_text,
                "deferred_status": "ready" if deferred_text else "empty",
                "deferred_filled_at": datetime.now(timezone.utc).isoformat(),
            }
            dialect = bg_db.bind.dialect.name if bg_db.bind is not None else ""
            if dialect == "postgresql":
                # Atomic merge — UPDATE ... SET col = COALESCE(col, '{}') || :payload
                # so we never read-then-write. Returns rowcount; 0 means session
                # was deleted between create_task() and now.
                from sqlalchemy import text as sa_text
                result = await bg_db.execute(
                    sa_text(
                        "UPDATE ai_sessions "
                        "SET snapshot_metadata = COALESCE(snapshot_metadata, '{}'::jsonb) || CAST(:payload AS jsonb) "
                        "WHERE id = :sid"
                    ),
                    {"payload": json.dumps(payload), "sid": session_id},
                )
                if result.rowcount == 0:
                    logger.warning(
                        "[CHAT][DEFERRED] session=%s gone before deferred fill landed",
                        session_id,
                    )
                    return
            else:
                # SQLite test fallback — read-modify-write in one txn.
                sess = (await bg_db.execute(
                    select(AISession).where(AISession.id == session_id)
                )).scalar_one_or_none()
                if sess is None:
                    logger.warning(
                        "[CHAT][DEFERRED] session=%s gone before deferred fill landed",
                        session_id,
                    )
                    return
                merged = {**(sess.snapshot_metadata or {}), **payload}
                sess.snapshot_metadata = merged
            await bg_db.commit()
            logger.info(
                "[CHAT][DEFERRED] session=%s deferred_chars=%d status=%s",
                session_id, len(deferred_text), payload["deferred_status"],
            )
    except Exception as exc:  # pragma: no cover - background fault tolerance
        logger.warning(
            "[CHAT][DEFERRED] background fill failed session=%s: %s",
            session_id, exc,
        )


async def build_session_snapshot_meta(
    patient_id: str,
    db,
    *,
    deferred_enabled: bool,
    critical_builder: Callable[..., Awaitable[Tuple[str, dict, dict]]],
    clinical_builder: Callable[..., Awaitable[str]],
    latest_lab_getter: Callable[..., Awaitable[object]],
    active_meds_getter: Callable[..., Awaitable[list]],
    key_values_extractor: Callable[..., dict],
) -> Tuple[dict, Optional[bool]]:
    """Build the ``snapshot_metadata`` dict for a session.

    Shared by ``chat_stream`` (first turn) and ``refresh_session_snapshot``.
    The builder callables are injected by the caller (the router) so that
    test monkeypatches on ``app.routers.ai_chat.build_critical_snapshot``
    remain effective.

    Returns ``(snapshot_metadata, intubated)`` where ``intubated`` is the
    deferred-fill flag when the deferred path is active, else ``None`` (the
    caller only needs it to spawn the background fill).
    """
    if deferred_enabled:
        # B15-A1 fast path: critical-only synchronously, deferred in
        # background. Goal is first-turn snapshot_ms ~3s vs ~6s.
        critical, key_vals, deferred_meta = await critical_builder(patient_id, db)
        intubated = deferred_meta.get("intubated", False)
        meta = {
            "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_key_values": key_vals,
            "clinical_snapshot": critical,
            "deferred_status": "pending",
            "deferred_intubated": intubated,
        }
        return meta, intubated

    # Existing v1 path (full snapshot up front). Keep request-session
    # DB work sequential; AsyncSession does not support concurrent
    # operations and failures here happen before SSE starts.
    snapshot = await clinical_builder(patient_id, db)
    lab = await latest_lab_getter(db, patient_id)
    meds = await active_meds_getter(db, patient_id)
    key_vals = key_values_extractor(lab, meds)
    meta = {
        "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_key_values": key_vals,
        "clinical_snapshot": snapshot,
    }
    return meta, None
