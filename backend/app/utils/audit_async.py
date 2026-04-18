"""Background audit-log writer for SSE streaming endpoints.

Streaming endpoints yield the ``event: done`` frame last, so any
``await create_audit_log(...)`` in the generator body blocks the user
from seeing the final payload for the duration of the INSERT + flush
(~30–80 ms on production Postgres).

`schedule_audit_log` runs the write in a detached task with a fresh DB
session. The caller returns immediately; errors are swallowed to a
warning log. Use this only from SSE generators after the final ``done``
frame has been yielded — the fire-and-forget semantics mean an audit
row can be lost on abrupt process shutdown, which is an accepted
defense-in-depth tradeoff for these endpoints.
"""

import asyncio
import logging
from typing import Any, Dict, Optional

from app.database import async_session
from app.middleware.audit import create_audit_log

logger = logging.getLogger(__name__)


def schedule_audit_log(
    *,
    user_id: str,
    user_name: str,
    role: str,
    action: str,
    target: Optional[str] = None,
    status: str = "success",
    ip: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    async def _write() -> None:
        try:
            async with async_session() as session:
                await create_audit_log(
                    session,
                    user_id=user_id,
                    user_name=user_name,
                    role=role,
                    action=action,
                    target=target,
                    status=status,
                    ip=ip,
                    details=details,
                )
                await session.commit()
        except Exception as exc:
            logger.warning(
                "[AUDIT][BG] Background audit write failed action=%s target=%s: %s",
                action, target, str(exc)[:200],
            )

    asyncio.create_task(_write())
