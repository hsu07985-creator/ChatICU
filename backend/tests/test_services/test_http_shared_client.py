"""Lifecycle tests for the shared httpx.AsyncClient helper (#7A).

These tests pin down four behaviours the rest of the system relies on:

  1. Lazy creation — first call constructs a client; subsequent calls
     return the same instance so the connection pool is genuinely shared.
  2. close_shared_client aclose()s the live client and resets the slot
     so the next get_shared_client builds a fresh one (important for
     test isolation and for the FastAPI lifespan shutdown path).
  3. close_shared_client is idempotent and safe to call when no client
     has ever been built.
  4. After close, the next get_shared_client must rebuild — closed
     clients are not silently reused.
"""

from __future__ import annotations

import httpx
import pytest
import pytest_asyncio

from app.services import _http


@pytest_asyncio.fixture(autouse=True)
async def _reset_shared_client_module_state():
    """Each test starts and ends with no shared client, so failures
    don't leak state into the next case.
    """
    await _http.close_shared_client()
    yield
    await _http.close_shared_client()


@pytest.mark.asyncio
async def test_get_shared_client_returns_same_instance_across_calls() -> None:
    first = _http.get_shared_client()
    second = _http.get_shared_client()
    assert first is second
    assert isinstance(first, httpx.AsyncClient)
    assert not first.is_closed


@pytest.mark.asyncio
async def test_close_shared_client_closes_and_resets_slot() -> None:
    client = _http.get_shared_client()
    assert not client.is_closed

    await _http.close_shared_client()
    assert client.is_closed

    # Module slot is reset; next get_shared_client builds a fresh one.
    rebuilt = _http.get_shared_client()
    assert rebuilt is not client
    assert not rebuilt.is_closed


@pytest.mark.asyncio
async def test_close_shared_client_is_idempotent_when_never_created() -> None:
    # Never called get_shared_client — close should not raise.
    await _http.close_shared_client()
    await _http.close_shared_client()


@pytest.mark.asyncio
async def test_close_shared_client_idempotent_after_first_close() -> None:
    _http.get_shared_client()
    await _http.close_shared_client()
    # Second close, with the slot already empty, must be a no-op.
    await _http.close_shared_client()


@pytest.mark.asyncio
async def test_get_shared_client_after_external_close_rebuilds() -> None:
    """If something outside the helper closes the client (e.g. via a
    direct ``await client.aclose()``), the next get_shared_client call
    must detect the closed state and rebuild rather than returning a
    dead instance.
    """
    client = _http.get_shared_client()
    await client.aclose()
    assert client.is_closed

    rebuilt = _http.get_shared_client()
    assert rebuilt is not client
    assert not rebuilt.is_closed
