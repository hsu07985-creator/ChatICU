"""Tests for POST /admin/his-sync — manual HIS sync trigger."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.routers import admin_his_sync as router_mod


_FAKE_STDOUT = (
    "=== HIS SNAPSHOT SYNC: 1 patients ===\n"
    "16312169\n"
    "  action        : forced\n"
    "  snapshot_id   : 20260414_010000\n"
    "--- Summary ---\n"
    "  forced=1, new=0, changed=0, timestamp-only=0, unchanged=0, synced=1\n"
    "  errors=0\n"
)


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_SYNC_TOKEN", "test-token-abc")
    return "test-token-abc"


@pytest.fixture
def stub_env(monkeypatch, tmp_path):
    """Pretend patient/ folder and wrapper script both exist."""
    fake_patient = tmp_path / "patient"
    fake_patient.mkdir()
    fake_wrapper = tmp_path / "run_his_snapshot_sync.sh"
    fake_wrapper.write_text("#!/bin/sh\necho stub\n")
    fake_wrapper.chmod(0o755)

    monkeypatch.setattr(router_mod, "_PATIENT_BASE", fake_patient)
    monkeypatch.setattr(router_mod, "_WRAPPER_SCRIPT", fake_wrapper)
    return fake_patient, fake_wrapper


@pytest.mark.asyncio
async def test_his_sync_disabled_without_token(client):
    # ADMIN_SYNC_TOKEN unset → 503, regardless of anything else
    original = settings.ADMIN_SYNC_TOKEN
    settings.ADMIN_SYNC_TOKEN = ""
    try:
        response = await client.post(
            "/admin/his-sync", headers={"X-Admin-Token": "anything"}
        )
    finally:
        settings.ADMIN_SYNC_TOKEN = original
    assert response.status_code == 503
    assert "disabled" in response.json()["message"].lower()


@pytest.mark.asyncio
async def test_his_sync_missing_patient_folder(client, token, tmp_path, monkeypatch):
    # token set but patient/ folder does not exist → 503
    ghost = tmp_path / "nope"
    monkeypatch.setattr(router_mod, "_PATIENT_BASE", ghost)
    response = await client.post(
        "/admin/his-sync", headers={"X-Admin-Token": token}
    )
    assert response.status_code == 503
    assert "patient/ folder" in response.json()["message"]


@pytest.mark.asyncio
async def test_his_sync_rejects_wrong_token(client, token, stub_env):
    response = await client.post(
        "/admin/his-sync", headers={"X-Admin-Token": "wrong"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_his_sync_detect_mode_parses_summary(client, token, stub_env):
    fake_proc = AsyncMock()
    fake_proc.communicate.return_value = (_FAKE_STDOUT.encode(), b"")
    fake_proc.returncode = 0

    with patch(
        "asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)
    ) as mock_spawn:
        response = await client.post(
            "/admin/his-sync", headers={"X-Admin-Token": token}
        )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["mode"] == "detect"
    assert payload["success"] is True
    assert payload["counts"] == {
        "forced": 1,
        "new": 0,
        "changed": 0,
        "timestamp_only": 0,
        "unchanged": 0,
        "synced": 1,
        "errors": 0,
    }

    # wrapper invoked without --force
    called_args = mock_spawn.call_args.args
    assert "--force" not in called_args


@pytest.mark.asyncio
async def test_his_sync_force_mode_passes_flag(client, token, stub_env):
    fake_proc = AsyncMock()
    fake_proc.communicate.return_value = (_FAKE_STDOUT.encode(), b"")
    fake_proc.returncode = 0

    with patch(
        "asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)
    ) as mock_spawn:
        response = await client.post(
            "/admin/his-sync?force=true&patient=16312169",
            headers={"X-Admin-Token": token},
        )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["mode"] == "force"
    assert payload["patient"] == "16312169"
    called_args = mock_spawn.call_args.args
    assert "--force" in called_args
    assert "-p" in called_args
    assert "16312169" in called_args


@pytest.mark.asyncio
async def test_his_sync_single_flight_returns_409(client, token, stub_env):
    # Simulate a run already in progress by manually acquiring the lock.
    await router_mod._sync_lock.acquire()
    try:
        response = await client.post(
            "/admin/his-sync", headers={"X-Admin-Token": token}
        )
    finally:
        router_mod._sync_lock.release()
    assert response.status_code == 409
    assert "already running" in response.json()["message"].lower()


@pytest.mark.asyncio
async def test_his_sync_patient_param_validates_numeric(client, token, stub_env):
    response = await client.post(
        "/admin/his-sync?patient=not-a-number",
        headers={"X-Admin-Token": token},
    )
    assert response.status_code == 422
