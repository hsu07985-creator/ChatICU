"""AI-OPT #1/#2 (2026-07-20): per-task model routing + prompt_cache_key.

Locks in:
  1. resolve_model precedence: caller override > LLM_TASK_MODEL_OVERRIDES > LLM_MODEL.
  2. The OpenAI adapter sends prompt_cache_key and the routed model to
     chat.completions.create, and reports the effective model in metadata.
  3. call_llm defaults cache_key to the task-scoped key.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.llm as llm_module
from app.llm import resolve_model
from app.llm.providers import openai as openai_provider


# ── resolve_model precedence ──────────────────────────────────────────────────

def test_resolve_model_default(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "LLM_TASK_MODEL_OVERRIDES", {}, raising=False)
    assert resolve_model("clinical_summary") == llm_module.settings.LLM_MODEL


def test_resolve_model_task_map(monkeypatch):
    monkeypatch.setattr(
        llm_module.settings, "LLM_TASK_MODEL_OVERRIDES",
        {"clinical_summary": "gpt-5.4-mini"}, raising=False,
    )
    assert resolve_model("clinical_summary") == "gpt-5.4-mini"
    assert resolve_model("icu_chat") == llm_module.settings.LLM_MODEL


def test_resolve_model_caller_override_wins(monkeypatch):
    monkeypatch.setattr(
        llm_module.settings, "LLM_TASK_MODEL_OVERRIDES",
        {"clinical_polish": "gpt-5.4-mini"}, raising=False,
    )
    assert resolve_model("clinical_polish", "gpt-5.4-nano") == "gpt-5.4-nano"


# ── adapter passes model + prompt_cache_key ──────────────────────────────────

class _FakeCompletions:
    def __init__(self, sink):
        self._sink = sink

    def create(self, **kwargs):
        self._sink.update(kwargs)
        usage = SimpleNamespace(
            prompt_tokens=10, completion_tokens=5,
            prompt_tokens_details=SimpleNamespace(cached_tokens=4),
        )
        msg = SimpleNamespace(content="ok")
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=usage)


def _fake_client(sink):
    return SimpleNamespace(chat=SimpleNamespace(completions=_FakeCompletions(sink)))


@pytest.fixture()
def captured(monkeypatch):
    sink: dict = {}
    monkeypatch.setattr(openai_provider, "_get_openai_sync", lambda: _fake_client(sink))
    return sink


def test_openai_chat_sends_cache_key_and_model(captured):
    result = openai_provider._openai_chat(
        "sys", [{"role": "user", "content": "hi"}], 0.3, 100,
        task="clinical_polish", model="gpt-5.4-mini", cache_key="chaticu:clinical_polish",
    )
    assert captured["model"] == "gpt-5.4-mini"
    assert captured["prompt_cache_key"] == "chaticu:clinical_polish"
    assert result["metadata"]["model"] == "gpt-5.4-mini"
    # routed gpt-5.x model still gets the reasoning fallback, never temperature
    assert captured.get("reasoning_effort") is not None
    assert "temperature" not in captured


def test_openai_chat_omits_cache_key_when_absent(captured):
    openai_provider._openai_chat(
        "sys", [{"role": "user", "content": "hi"}], 0.3, 100,
        task="clinical_polish",
    )
    assert captured["model"] == llm_module.settings.LLM_MODEL
    assert "prompt_cache_key" not in captured


def test_call_llm_defaults_task_scoped_cache_key(monkeypatch, captured):
    monkeypatch.setattr(llm_module.settings, "OPENAI_API_KEY", "sk-test", raising=False)
    monkeypatch.setattr(llm_module.settings, "LLM_PROVIDER", "openai", raising=False)
    monkeypatch.setattr(llm_module.settings, "LLM_TASK_MODEL_OVERRIDES", {}, raising=False)
    out = llm_module.call_llm("clinical_polish", {"draft": "x"})
    assert out["status"] == "success"
    assert captured["prompt_cache_key"] == "chaticu:clinical_polish"


def test_call_llm_model_override_kwarg(monkeypatch, captured):
    monkeypatch.setattr(llm_module.settings, "OPENAI_API_KEY", "sk-test", raising=False)
    monkeypatch.setattr(llm_module.settings, "LLM_PROVIDER", "openai", raising=False)
    llm_module.call_llm("clinical_polish", {"draft": "x"}, model_override="gpt-5.4-mini")
    assert captured["model"] == "gpt-5.4-mini"
