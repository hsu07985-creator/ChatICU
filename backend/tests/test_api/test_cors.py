"""CORS contract tests for browser preflight behavior."""

import pytest


@pytest.mark.asyncio
async def test_cors_preflight_allows_local_4173(client):
    """Vite dev server at 127.0.0.1:4173 must be allowed."""
    response = await client.options(
        "/auth/login",
        headers={
            "Origin": "http://127.0.0.1:4173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://127.0.0.1:4173"
    assert "POST" in response.headers.get("access-control-allow-methods", "")


@pytest.mark.asyncio
async def test_cors_preflight_blocks_unknown_origin(client):
    """Unlisted origins must be rejected to keep CORS policy strict."""
    response = await client.options(
        "/auth/login",
        headers={
            "Origin": "http://127.0.0.1:9999",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )

    assert response.status_code == 400
    assert response.text == "Disallowed CORS origin"
