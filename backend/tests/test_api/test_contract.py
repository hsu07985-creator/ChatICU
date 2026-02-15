"""Contract tests — verify response envelope consistency across all endpoints."""

import pytest


@pytest.mark.asyncio
async def test_health_follows_envelope(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "data" in data
    assert data["data"]["status"] == "healthy"


@pytest.mark.asyncio
async def test_root_follows_envelope(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "data" in data


@pytest.mark.asyncio
async def test_success_response_has_required_fields(client):
    """Any 200 response must have success=True."""
    response = await client.get("/api/v1/rag/status")
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert data["success"] is True


@pytest.mark.asyncio
async def test_404_error_envelope(client):
    """404 must return {success: false, error: 'NOT_FOUND', message: ...}."""
    response = await client.post(
        "/api/v1/clinical/summary",
        json={"patient_id": "NONEXIST"},
    )
    assert response.status_code == 404
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "NOT_FOUND"
    assert "message" in data


@pytest.mark.asyncio
async def test_422_validation_error_envelope(client):
    """422 must return {success: false, error: 'VALIDATION_ERROR', details: [...]}."""
    # Send invalid body (missing required field)
    response = await client.post(
        "/api/v1/rules/ckd-stage",
        json={},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "VALIDATION_ERROR"
    assert "message" in data
    assert "details" in data
    assert isinstance(data["details"], list)
    assert len(data["details"]) > 0
    assert "field" in data["details"][0]
    assert "message" in data["details"][0]


@pytest.mark.asyncio
async def test_503_error_envelope(client):
    """503 must return {success: false, error: 'SERVICE_UNAVAILABLE', message: ...}."""
    response = await client.post(
        "/api/v1/rag/query",
        json={"question": "test"},
    )
    assert response.status_code == 503
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "SERVICE_UNAVAILABLE"
    assert "message" in data


@pytest.mark.asyncio
async def test_security_headers_present(client):
    """All responses must include defensive security headers (T26)."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-XSS-Protection"] == "1; mode=block"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in response.headers["Permissions-Policy"]


@pytest.mark.asyncio
async def test_all_success_endpoints_return_envelope(client):
    """Spot-check multiple success endpoints for envelope format."""
    endpoints = [
        ("GET", "/health"),
        ("GET", "/"),
        ("GET", "/api/v1/rag/status"),
        ("POST", "/api/v1/rules/ckd-stage", {"egfr": 90.0}),
    ]
    for entry in endpoints:
        method = entry[0]
        path = entry[1]
        body = entry[2] if len(entry) > 2 else None

        if method == "GET":
            resp = await client.get(path)
        else:
            resp = await client.post(path, json=body)

        data = resp.json()
        assert "success" in data, f"{method} {path} missing 'success' field"
        if resp.status_code < 400:
            assert data["success"] is True, f"{method} {path} should have success=True"
