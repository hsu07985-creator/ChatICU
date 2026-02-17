"""Helpers for turning LLM configuration/runtime issues into user-safe messages."""

from __future__ import annotations

from app.config import settings


def llm_unavailable_detail() -> str:
    """Return a user-facing message for LLM unavailability.

    This avoids leaking upstream/provider raw error payloads into the UI.
    """
    if settings.LLM_PROVIDER == "openai" and not (settings.OPENAI_API_KEY or "").strip():
        return "AI 服務尚未設定：缺少 OPENAI_API_KEY。請在 backend/.env 設定後重啟後端。"
    if settings.LLM_PROVIDER == "anthropic" and not (settings.ANTHROPIC_API_KEY or "").strip():
        return "AI 服務尚未設定：缺少 ANTHROPIC_API_KEY。請在 backend/.env 設定後重啟後端。"
    return "AI 服務暫時不可用，請稍後再試。"

