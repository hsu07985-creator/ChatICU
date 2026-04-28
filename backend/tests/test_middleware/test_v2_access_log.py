"""Verify the /v2/patients access logger never leaks PHI.

Audit doc §4.1 lists exactly what is allowed in the log line: HTTP
method, route template, status, user_hash, user-agent prefix, ISO
timestamp. Anything else (raw URL with substituted patient_id, query
strings, request body, response body, raw user id, MRN, patient name)
is forbidden.

These tests exercise the middleware against a tiny FastAPI app that
mimics the real router shape, then assert what is and is not present
in the captured log records.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.middleware.v2_access_log import V2AccessLogMiddleware


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(V2AccessLogMiddleware)

    @app.get("/v2/patients")
    async def list_patients():
        return {"ok": True}

    @app.get("/v2/patients/{patient_id}")
    async def get_patient(patient_id: str):
        return {"id": patient_id}

    @app.get("/v2/patients/{patient_id}/medications/{medication_id}")
    async def get_medication(patient_id: str, medication_id: str):
        return {"pid": patient_id, "mid": medication_id}

    @app.get("/auth/me")
    async def auth_me():
        return {"user": "x"}

    return app


@pytest.fixture
def captured_logs(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    """Capture chaticu.v2_access records via caplog.

    main.py declares ``chaticu`` with ``propagate=False`` to keep app
    logging out of test stderr noise. caplog's handler lives on the
    root logger, so we re-enable propagation for the duration of the
    test and restore it afterwards.
    """
    chaticu_logger = logging.getLogger("chaticu")
    original_propagate = chaticu_logger.propagate
    chaticu_logger.propagate = True
    caplog.set_level(logging.INFO, logger="chaticu.v2_access")
    try:
        yield caplog
    finally:
        chaticu_logger.propagate = original_propagate


@pytest.mark.asyncio
async def test_logs_v2_request_with_route_template_not_raw_url(
    captured_logs: pytest.LogCaptureFixture,
) -> None:
    app = _build_app()
    secret_id = "pat_secret_b00e859b"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.get(f"/v2/patients/{secret_id}?search=should-not-leak")

    v2_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    assert len(v2_records) == 1
    msg = v2_records[0].getMessage()

    # Route TEMPLATE is logged …
    assert "route=/v2/patients/{patient_id}" in msg
    # … and the substituted id is NOT.
    assert secret_id not in msg
    # Query string values are NOT logged either.
    assert "should-not-leak" not in msg
    # Status code is captured.
    assert "status=200" in msg
    # Method too.
    assert "method=GET" in msg


@pytest.mark.asyncio
async def test_logs_anonymous_request_with_user_hash_anon(
    captured_logs: pytest.LogCaptureFixture,
) -> None:
    app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.get("/v2/patients")

    v2_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    assert len(v2_records) == 1
    assert "user_hash=anon" in v2_records[0].getMessage()


@pytest.mark.asyncio
async def test_logs_user_hash_for_valid_jwt_without_db_lookup(
    captured_logs: pytest.LogCaptureFixture,
) -> None:
    """A valid JWT subject becomes a SHA256 hash truncated to 16 chars.
    The raw user id must NOT appear anywhere in the log line.
    """
    from app.utils.security import create_access_token

    app = _build_app()
    raw_user_id = "usr_test_abc123"
    token = create_access_token({"sub": raw_user_id})

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://t",
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        await c.get("/v2/patients")

    v2_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    assert len(v2_records) == 1
    msg = v2_records[0].getMessage()

    # Raw subject id MUST NOT appear in log
    assert raw_user_id not in msg

    # A 16-char hex hash is present
    import re
    match = re.search(r"user_hash=([0-9a-f]+)", msg)
    assert match is not None, f"no user_hash in {msg!r}"
    user_hash = match.group(1)
    assert len(user_hash) == 16
    assert user_hash != "anon"


@pytest.mark.asyncio
async def test_logs_user_hash_for_valid_auth_cookie(
    captured_logs: pytest.LogCaptureFixture,
) -> None:
    """The middleware must read the same cookie name that auth.py uses
    (``chaticu_access``) — not a generic ``access_token``. Otherwise
    browser-cookie callers (the only realistic v2 traffic in production
    if any exists) would all be tagged anon and we lose the ability to
    distinguish callers in the 1-2 week observation window.

    Regression test for the hotfix on top of 52fd9cb9a.
    """
    from app.middleware.auth import COOKIE_ACCESS_KEY
    from app.utils.security import create_access_token

    app = _build_app()
    raw_user_id = "usr_cookie_caller_xyz"
    token = create_access_token({"sub": raw_user_id})

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://t",
        cookies={COOKIE_ACCESS_KEY: token},
    ) as c:
        await c.get("/v2/patients")

    v2_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    assert len(v2_records) == 1
    msg = v2_records[0].getMessage()

    # Raw subject id must NOT appear
    assert raw_user_id not in msg

    # A real 16-char hex hash is present, NOT the anon sentinel
    import re
    match = re.search(r"user_hash=([0-9a-f]+)", msg)
    assert match is not None, f"no user_hash in {msg!r}"
    user_hash = match.group(1)
    assert len(user_hash) == 16
    assert user_hash != "anon"

    # The legacy "access_token" cookie name must NOT pick up the token
    # (sanity-check that the test is exercising the new behaviour, not
    # accidentally passing because of fallback).
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://t",
        cookies={"access_token": token},
    ) as c2:
        await c2.get("/v2/patients")
    legacy_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    # Two log records total now; the second one must be anon.
    assert len(legacy_records) == 2
    assert "user_hash=anon" in legacy_records[1].getMessage()


@pytest.mark.asyncio
async def test_does_not_log_non_v2_paths(
    captured_logs: pytest.LogCaptureFixture,
) -> None:
    app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.get("/auth/me")

    v2_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    assert len(v2_records) == 0


@pytest.mark.asyncio
async def test_truncates_user_agent_to_80_chars(
    captured_logs: pytest.LogCaptureFixture,
) -> None:
    """An arbitrarily long User-Agent header must not bloat the log line
    or — worse — let a probe stuff PHI / fingerprintable data into the
    audit trail via that header. The middleware caps at 80 chars.
    """
    app = _build_app()
    long_ua = "X" * 500

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://t",
        headers={"User-Agent": long_ua},
    ) as c:
        await c.get("/v2/patients")

    v2_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    assert len(v2_records) == 1
    msg = v2_records[0].getMessage()

    import re
    match = re.search(r"ua=(.*)$", msg)
    assert match is not None
    captured_ua = match.group(1)
    assert len(captured_ua) <= 80
    assert "X" * 81 not in captured_ua


@pytest.mark.asyncio
async def test_logs_unmatched_v2_path_without_leaking_segments(
    captured_logs: pytest.LogCaptureFixture,
) -> None:
    """A 404 under /v2/patients/... still gets logged for visibility,
    but the unmatched URL segments (which could be a probed MRN /
    scraping fingerprint) MUST NOT appear in the log message.
    """
    app = _build_app()
    suspicious = "MRN_50480738_probe"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.get(f"/v2/patients/{suspicious}/nonexistent-subresource")

    v2_records = [r for r in captured_logs.records if r.name == "chaticu.v2_access"]
    assert len(v2_records) == 1
    msg = v2_records[0].getMessage()
    assert suspicious not in msg
    assert "status=404" in msg
