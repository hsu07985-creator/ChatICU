"""Shared httpx.AsyncClient for outbound service calls.

Goal: stop creating a fresh ``httpx.AsyncClient`` per request inside
DrugRagClient / PadClient / source_registry health checks. A shared
client carries a connection pool across calls, which:

  - reuses keep-alive TCP/TLS connections to the same upstream host
    (drug RAG, PAD API, etc.), saving handshake RTT on every call;
  - bounds total in-flight connections via ``httpx.Limits`` so a busy
    LLM session cannot exhaust file descriptors;
  - lets us co-locate timeout / retry / circuit-breaker policy in one
    place down the line (see audit doc §7).

Lifecycle (audit doc §8.4 v3 correction):
  - The client is created lazily on first use. It is NOT a true
    module-level singleton — Python finalisers are unreliable for
    closing async resources, so we register an explicit
    ``close_shared_client`` call from the FastAPI lifespan in
    ``app/main.py`` to ``aclose()`` it cleanly on shutdown.
  - Calling ``close_shared_client`` resets the slot so the next
    ``get_shared_client`` rebuilds a fresh client; tests that
    aclose() between cases keep working.

Usage in service clients::

    from app.services._http import get_shared_client

    client = get_shared_client()
    resp = await client.post(url, json=payload, timeout=10.0)

Per-request timeouts replace the constructor-level timeout that the
old per-call ``async with httpx.AsyncClient(timeout=...)`` pattern
used.
"""

from __future__ import annotations

from typing import Optional

import httpx


# Pool sizing — generous enough for the orchestrator's parallel calls
# (drug RAG, PAD, evidence) while remaining small relative to the
# OS-default file-descriptor limit so we cannot accidentally exhaust it
# under HIS sync + AI chat concurrency.
_DEFAULT_LIMITS = httpx.Limits(
    max_connections=20,
    max_keepalive_connections=10,
)


_shared_client: Optional[httpx.AsyncClient] = None


def get_shared_client() -> httpx.AsyncClient:
    """Return the lazily-created shared ``httpx.AsyncClient``.

    Creates a new client if none exists yet, or if the previous one was
    explicitly closed (``close_shared_client``). Connection pooling is
    handled by httpx; callers should pass per-request ``timeout``.
    """
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(limits=_DEFAULT_LIMITS)
    return _shared_client


async def close_shared_client() -> None:
    """Close and discard the shared client.

    Called from the FastAPI lifespan on shutdown so connections drain
    cleanly. Idempotent — safe to call when no client has been built
    yet.
    """
    global _shared_client
    client = _shared_client
    _shared_client = None
    if client is not None and not client.is_closed:
        await client.aclose()
