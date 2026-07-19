"""AI-OPT #4: _dismiss_alias_suspects — light-model alias filter.

Contract: alias/dose-form variants of listed meds are dismissed from the
suspect list; anything the LLM can't confirm stays; every failure mode is
fail-open (keep all suspects) so observability never shrinks silently.
"""
from __future__ import annotations

import json

import pytest

import app.services.ai_chat.observability as obs

SUSPECTS = [
    {"section": "用藥", "token": "Unfractionated Heparin",
     "reason": "drug_not_in_active_meds", "content": "Unfractionated Heparin 5000U"},
    {"section": "用藥", "token": "Warfarin",
     "reason": "drug_not_in_active_meds", "content": "Warfarin 5mg"},
]
MEDS = ["Heparin", "Pantoprazole", "Vancomycin"]


def _patch_llm(monkeypatch, response):
    def fake_call_llm(task, input_data, **kwargs):
        assert task == "citation_alias_check"
        assert kwargs.get("model_override")  # must run on the light model
        return response
    monkeypatch.setattr("app.llm.call_llm", fake_call_llm)


@pytest.mark.asyncio
async def test_alias_dismissed_real_suspect_kept(monkeypatch):
    _patch_llm(monkeypatch, {
        "status": "success",
        "content": json.dumps({"decisions": [
            {"token": "Unfractionated Heparin", "alias_of": "Heparin"},
            {"token": "Warfarin", "alias_of": None},
        ]}),
    })
    kept, dismissed = await obs._dismiss_alias_suspects(SUSPECTS, MEDS)
    assert [s["token"] for s in kept] == ["Warfarin"]
    assert dismissed[0]["token"] == "Unfractionated Heparin"
    assert dismissed[0]["alias_of"] == "Heparin"


@pytest.mark.asyncio
async def test_llm_error_keeps_all(monkeypatch):
    _patch_llm(monkeypatch, {"status": "error", "content": "boom"})
    kept, dismissed = await obs._dismiss_alias_suspects(SUSPECTS, MEDS)
    assert kept == SUSPECTS and dismissed == []


@pytest.mark.asyncio
async def test_malformed_json_keeps_all(monkeypatch):
    _patch_llm(monkeypatch, {"status": "success", "content": "not json at all"})
    kept, dismissed = await obs._dismiss_alias_suspects(SUSPECTS, MEDS)
    assert kept == SUSPECTS and dismissed == []


@pytest.mark.asyncio
async def test_fenced_json_is_parsed(monkeypatch):
    fenced = "```json\n" + json.dumps({"decisions": [
        {"token": "Unfractionated Heparin", "alias_of": "Heparin"},
        {"token": "Warfarin", "alias_of": None},
    ]}) + "\n```"
    _patch_llm(monkeypatch, {"status": "success", "content": fenced})
    kept, dismissed = await obs._dismiss_alias_suspects(SUSPECTS, MEDS)
    assert len(kept) == 1 and len(dismissed) == 1
