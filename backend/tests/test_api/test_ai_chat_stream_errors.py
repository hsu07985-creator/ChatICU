"""AI chat stream error-contract regressions."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_chat_stream_internal_setup_failure_is_not_generic(
    client, seeded_db, monkeypatch,  # noqa: ARG001
):
    from app.config import settings

    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)
    monkeypatch.setattr(settings, "DEBUG", False)

    async def boom(patient_id, db):  # noqa: ARG001
        raise RuntimeError("raw database detail should stay server-side")

    monkeypatch.setattr("app.routers.ai_chat.build_critical_snapshot", boom)

    from app.main import app

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/ai/chat/stream",
            json={"message": "bilirubin 和目前用藥有關嗎？", "patientId": "pat_001"},
            headers={"X-Request-ID": "req_ai_setup_test"},
        )

    assert response.status_code == 500
    body = response.json()
    assert body["success"] is False
    assert body["request_id"] == "req_ai_setup_test"
    assert "AI 臨床夥伴準備病患資料時失敗" in body["message"]
    assert "An unexpected error occurred" not in body["message"]
    assert "raw database detail" not in body["message"]
