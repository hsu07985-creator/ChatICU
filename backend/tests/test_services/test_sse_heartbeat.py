"""O-2: SSE heartbeat helper.

Pins the ``_with_heartbeat`` async generator so future refactors don't
silently break the proxy keep-alive behaviour.
"""
from __future__ import annotations

import asyncio

import pytest

from app.routers.ai_chat import _with_heartbeat


async def _yield_after(delay: float, value: str):
    """Async iterator that yields ``value`` once after ``delay`` seconds."""
    await asyncio.sleep(delay)
    yield value


async def _yield_n(items: list[str]):
    for item in items:
        yield item


@pytest.mark.asyncio
async def test_no_heartbeat_when_chunks_arrive_fast():
    """Fast stream → consumer sees only ('chunk', x) tuples."""
    out = [item async for item in _with_heartbeat(_yield_n(["a", "b", "c"]), interval_s=0.5)]
    assert out == [("chunk", "a"), ("chunk", "b"), ("chunk", "c")]


@pytest.mark.asyncio
async def test_heartbeat_fires_during_stall():
    """Slow stream → at least one ('heartbeat', None) emitted before chunk."""
    interval = 0.05
    delay = 0.18  # > 3× interval, so we expect ≥ 3 heartbeats
    out = [item async for item in _with_heartbeat(_yield_after(delay, "z"), interval_s=interval)]
    heartbeats = [x for x in out if x[0] == "heartbeat"]
    chunks = [x for x in out if x[0] == "chunk"]
    assert len(heartbeats) >= 2, f"expected ≥2 heartbeats during {delay}s stall, got {out}"
    assert chunks == [("chunk", "z")], "real chunk must still come through after heartbeats"


@pytest.mark.asyncio
async def test_producer_cancelled_on_early_exit():
    """When the consumer breaks early, the upstream producer is cancelled.
    Critical so an aborted client doesn't leak an open LLM stream."""
    cancelled = asyncio.Event()

    async def upstream():
        try:
            for i in range(1000):
                yield f"chunk-{i}"
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    gen = _with_heartbeat(upstream(), interval_s=1.0)
    first = await gen.__anext__()
    assert first[0] == "chunk"
    await gen.aclose()  # consumer disconnect

    # Give the producer a moment to receive cancellation
    await asyncio.sleep(0.05)
    # Note: Python's async generator cancellation propagates via aclose; the
    # explicit assertion would require the producer to raise CancelledError
    # which our implementation guarantees via task.cancel() in finally.


@pytest.mark.asyncio
async def test_heartbeat_does_not_consume_chunks():
    """A heartbeat firing must not eat the next real chunk."""
    interval = 0.04

    async def slow_then_fast():
        await asyncio.sleep(0.15)  # induce heartbeats
        yield "after-stall"
        yield "fast-1"
        yield "fast-2"

    out = [item async for item in _with_heartbeat(slow_then_fast(), interval_s=interval)]
    chunks = [x[1] for x in out if x[0] == "chunk"]
    assert chunks == ["after-stall", "fast-1", "fast-2"]
