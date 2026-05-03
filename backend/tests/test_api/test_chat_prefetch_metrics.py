"""M1: hedging-detection helper used to gate the [CHAT][PREFETCH][MISS_LIKELY]
signal log. Pure function, no DB / no LLM — fast unit tests so we don't
silently regress the F4 trigger heuristic.
"""
from __future__ import annotations

import pytest

from app.routers.ai_chat import _reply_looks_hedged


@pytest.mark.parametrize(
    "reply",
    [
        "看到的資料缺少最近 culture 結果。",
        "若有更多檢驗資料，可以更精準調整。",
        "請提供病患的最近 X 光報告以協助判讀。",
        "目前資料不足以判斷感染來源。",
        "尚無提及該床的過敏史，建議補充後再評估。",
        "如果有最近 24 小時的 vital signs 趨勢，能更準確判斷。",
        "I don't have enough information about renal function.",
        "Without more recent labs I can't recommend de-escalation.",
        "Insufficient information to confirm dosing change.",
        "Please provide the most recent CT report.",
    ],
)
def test_hedged_phrases_detected(reply: str):
    assert _reply_looks_hedged(reply) is True


@pytest.mark.parametrize(
    "reply",
    [
        "病患目前血壓穩定，建議繼續觀察。",
        "可考慮 vancomycin 1g IV q12h。",
        "這位患者的腎功能適合給予該劑量。",
        "Vancomycin trough level 18 ug/mL — within target.",
        "",  # empty
        "   ",  # whitespace only
    ],
)
def test_normal_replies_not_hedged(reply: str):
    assert _reply_looks_hedged(reply) is False


def test_case_insensitive_for_english_patterns():
    """English hedging patterns must match regardless of case so a model
    capitalizing differently between turns doesn't slip past detection."""
    assert _reply_looks_hedged("PLEASE PROVIDE the latest culture.") is True
    assert _reply_looks_hedged("Please Provide the latest culture.") is True
    assert _reply_looks_hedged("please provide the latest culture.") is True


def test_chinese_patterns_are_substring_matches():
    """Chinese patterns appear inside longer paragraphs; we don't require
    the phrase to anchor at start/end."""
    embedded = (
        "首先看一下這位患者的狀況。\n"
        "雖然 CRP 偏高但暫時無發燒，目前資料不足以判定是否需要調整抗生素。\n"
        "建議追蹤 12 小時 vital signs 變化。"
    )
    assert _reply_looks_hedged(embedded) is True
