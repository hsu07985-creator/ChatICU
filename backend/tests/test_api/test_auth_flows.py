"""Auth and permission flow tests (real JWT path)."""

from __future__ import annotations

import time

import pytest

from app.config import settings


async def _login(client, username: str, password: str) -> dict:
    response = await client.post(
        "/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] is True
    assert "data" in payload
    return payload["data"]


@pytest.mark.asyncio
async def test_mock_auth_client_bypasses_auth_for_legacy_tests(mock_auth_client):
    """Mock-auth fixture should keep existing tests green without tokens."""
    response = await mock_auth_client.get("/admin/users")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True


@pytest.mark.asyncio
async def test_real_auth_client_requires_token(real_auth_client):
    """Real-auth fixture should enforce token requirements."""
    response = await real_auth_client.get("/admin/users")
    assert response.status_code == 403
    payload = response.json()
    assert payload["success"] is False
    assert payload["error"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_login_success_returns_user_and_tokens(real_auth_client):
    data = await _login(real_auth_client, "admin", "AdminPass123!")
    assert data["user"]["id"] == "usr_admin"
    assert data["user"]["role"] == "admin"
    assert isinstance(data["token"], str) and len(data["token"]) > 20
    assert isinstance(data["refreshToken"], str) and len(data["refreshToken"]) > 20
    assert isinstance(data["expiresIn"], int) and data["expiresIn"] > 0


@pytest.mark.asyncio
async def test_refresh_rotates_token_and_revokes_old_refresh(real_auth_client):
    login_data = await _login(real_auth_client, "admin", "AdminPass123!")
    old_refresh = login_data["refreshToken"]

    refresh_response = await real_auth_client.post(
        "/auth/refresh",
        json={"refreshToken": old_refresh},
    )
    assert refresh_response.status_code == 200
    refresh_payload = refresh_response.json()
    assert refresh_payload["success"] is True
    rotated = refresh_payload["data"]
    assert rotated["refreshToken"] != old_refresh
    assert rotated["token"] != login_data["token"]

    reused_old_response = await real_auth_client.post(
        "/auth/refresh",
        json={"refreshToken": old_refresh},
    )
    assert reused_old_response.status_code == 401
    reused_payload = reused_old_response.json()
    assert reused_payload["success"] is False
    assert reused_payload["error"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_logout_revokes_access_and_refresh_tokens(real_auth_client):
    login_data = await _login(real_auth_client, "doctor", "DoctorPass123!")
    access_token = login_data["token"]
    refresh_token = login_data["refreshToken"]
    headers = {"Authorization": f"Bearer {access_token}"}

    logout_response = await real_auth_client.post(
        "/auth/logout",
        json={"refreshToken": refresh_token},
        headers=headers,
    )
    assert logout_response.status_code == 200
    assert logout_response.json()["success"] is True

    me_response = await real_auth_client.get("/auth/me", headers=headers)
    assert me_response.status_code == 401
    me_payload = me_response.json()
    assert me_payload["success"] is False
    assert me_payload["error"] == "UNAUTHORIZED"

    refresh_response = await real_auth_client.post(
        "/auth/refresh",
        json={"refreshToken": refresh_token},
    )
    assert refresh_response.status_code == 401
    refresh_payload = refresh_response.json()
    assert refresh_payload["success"] is False
    assert refresh_payload["error"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_role_based_access_denies_non_admin_user(real_auth_client):
    login_data = await _login(real_auth_client, "nurse", "NursePass123!")
    headers = {"Authorization": f"Bearer {login_data['token']}"}

    response = await real_auth_client.get("/admin/users", headers=headers)
    assert response.status_code == 403
    payload = response.json()
    assert payload["success"] is False
    assert payload["error"] == "FORBIDDEN"
    assert payload["message"] == "Insufficient permissions"


@pytest.mark.asyncio
async def test_session_idle_timeout_expires_inactive_session(real_auth_client, test_redis):
    login_data = await _login(real_auth_client, "pharmacist", "PharmPass123!")
    access_token = login_data["token"]
    user_id = login_data["user"]["id"]
    headers = {"Authorization": f"Bearer {access_token}"}

    idle_limit = settings.SESSION_IDLE_TIMEOUT_MINUTES * 60
    stale_activity_ts = int(time.time()) - idle_limit - 5
    await test_redis.setex(f"last_activity:{user_id}", idle_limit, str(stale_activity_ts))

    me_response = await real_auth_client.get("/auth/me", headers=headers)
    assert me_response.status_code == 401
    payload = me_response.json()
    assert payload["success"] is False
    assert payload["error"] == "UNAUTHORIZED"
    assert payload["message"] == "Session expired due to inactivity"

    token_blacklist = await test_redis.get(f"blacklist:{access_token}")
    assert token_blacklist == "1"
