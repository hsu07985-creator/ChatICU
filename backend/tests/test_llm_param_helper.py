"""W2-T3: cover the OpenAI reasoning_effort vs temperature decision helper.

Locks in the three regressions that the helper exists to prevent:
  1. icu_chat streaming MUST skip reasoning even when LLM_REASONING_EFFORT is
     set (TTFT carve-out).
  2. gpt-5.x without reasoning MUST send reasoning_effort="minimal" — never
     temperature — or the server defaults to medium and burns the entire
     completion budget on reasoning tokens.
  3. The non-streaming multi-turn path used to be missing rule (2). The
     helper now centralises it so all three call sites stay aligned.
"""
from __future__ import annotations

import importlib

import pytest

import app.llm as llm_module


def _reload_with(monkeypatch, *, model: str, reasoning_effort: str) -> None:
    """Re-import llm with patched settings + module-level _REASONING_EFFORT."""
    monkeypatch.setattr(llm_module.settings, "LLM_MODEL", model, raising=False)
    # _REASONING_EFFORT is bound at import time to settings.LLM_REASONING_EFFORT;
    # patch the module-level binding directly.
    monkeypatch.setattr(llm_module, "_REASONING_EFFORT", reasoning_effort, raising=False)


# ── Streaming path (icu_chat carve-out) ────────────────────────────────────────

def test_streaming_icu_chat_on_gpt5_uses_minimal_even_when_reasoning_set(monkeypatch):
    _reload_with(monkeypatch, model="gpt-5.4-mini", reasoning_effort="low")
    block = llm_module._build_openai_reasoning_param_block(
        task="icu_chat",
        temperature=0.3,
        icu_chat_skips_reasoning=True,
    )
    assert block == {"reasoning_effort": "minimal"}


def test_streaming_other_task_on_gpt5_uses_low_when_set(monkeypatch):
    _reload_with(monkeypatch, model="gpt-5.4-mini", reasoning_effort="low")
    block = llm_module._build_openai_reasoning_param_block(
        task="clinical_summary",
        temperature=0.3,
        icu_chat_skips_reasoning=True,
    )
    assert block == {"reasoning_effort": "low"}


# ── Non-streaming single-turn path ─────────────────────────────────────────────

def test_call_openai_disable_reasoning_on_gpt5_falls_back_to_minimal(monkeypatch):
    _reload_with(monkeypatch, model="gpt-5.4-mini", reasoning_effort="low")
    block = llm_module._build_openai_reasoning_param_block(
        task="pharmacist_polish",
        temperature=0.3,
        disable_reasoning=True,
    )
    # disable_reasoning=True turns off reasoning_effort; gpt-5.x then needs
    # minimal explicitly.
    assert block == {"reasoning_effort": "minimal"}


def test_call_openai_no_reasoning_on_non_gpt5_uses_temperature(monkeypatch):
    _reload_with(monkeypatch, model="gpt-4o", reasoning_effort="")
    block = llm_module._build_openai_reasoning_param_block(
        task="clinical_summary",
        temperature=0.42,
    )
    assert block == {"temperature": 0.42}


# ── Non-streaming multi-turn path (the regression W2-T3 was added for) ─────────

def test_call_openai_multi_on_gpt5_with_empty_reasoning_uses_minimal(monkeypatch):
    """Pre-W2-T3 bug: _call_openai_multi sent temperature on gpt-5.x when
    LLM_REASONING_EFFORT was empty, triggering empty output."""
    _reload_with(monkeypatch, model="gpt-5.4-mini", reasoning_effort="")
    block = llm_module._build_openai_reasoning_param_block(
        task="clinical_summary",
        temperature=0.3,
    )
    assert block == {"reasoning_effort": "minimal"}
    assert "temperature" not in block


def test_call_openai_multi_on_gpt5_with_low_reasoning_uses_low(monkeypatch):
    _reload_with(monkeypatch, model="gpt-5.4-mini", reasoning_effort="low")
    block = llm_module._build_openai_reasoning_param_block(
        task="clinical_summary",
        temperature=0.3,
    )
    assert block == {"reasoning_effort": "low"}


# ── Defensive: the helper never sends both temperature and reasoning_effort ───

@pytest.mark.parametrize("model,reasoning", [
    ("gpt-5.4-mini", "low"),
    ("gpt-5.4-mini", ""),
    ("gpt-4o", "low"),
    ("gpt-4o", ""),
])
@pytest.mark.parametrize("disable", [True, False])
@pytest.mark.parametrize("icu_skip", [True, False])
@pytest.mark.parametrize("task", ["icu_chat", "clinical_summary"])
def test_helper_never_emits_both_keys(monkeypatch, model, reasoning, disable, icu_skip, task):
    _reload_with(monkeypatch, model=model, reasoning_effort=reasoning)
    block = llm_module._build_openai_reasoning_param_block(
        task=task,
        temperature=0.3,
        disable_reasoning=disable,
        icu_chat_skips_reasoning=icu_skip,
    )
    assert not ("temperature" in block and "reasoning_effort" in block)
