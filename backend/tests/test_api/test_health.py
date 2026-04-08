"""Tests for /health and / endpoints."""

import pytest
import pytest_asyncio


@pytest.mark.asyncio
async def test_health_check(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["status"] == "healthy"
    assert "service" in body["data"]
    assert "version" in body["data"]


@pytest.mark.asyncio
async def test_root(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["docs"] == "/docs"
    assert body["data"]["health"] == "/health"
