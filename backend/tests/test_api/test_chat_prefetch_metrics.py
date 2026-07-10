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
        # M3: prod-testing-derived patterns that the original list missed.
        # Each phrase came from an actual DAY20-test LLM reply where prefetch
        # had also missed; without these the MISS_LIKELY signal wouldn't fire.
        "無法判定最近 72 小時用藥異動，因為目前系統無 MAR 資料。",
        "目前系統無相關 MAR 給藥記錄。",
        "需要的資料包括最近 24 小時的醫囑與護理紀錄。",
        "若無法即時取得 MAR，請電話確認當班護理師。",
        "目前資料無法判斷是否新增升壓劑。",
        "暫時無法評估療效，請補登最新血液氣體。",
        "查無最近 14 天的 culture 結果。",
        "未見近期培養紀錄，建議追蹤。",
        "Cannot determine renal trajectory without recent creatinine.",
        "Unable to assess fluid balance — please provide intake/output.",
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


# ---------------------------------------------------------------------------
# T3 (2026-07-10): subject-aware hedging for the MISS_LIKELY gate.
# _reply_looks_hedged stays full-text (feeds the [REPLY][HEDGED] info log);
# MISS_LIKELY only fires when the paragraph that answers the question
# subject is itself hedged. A complete answer with a responsible
# "缺少 MAR" side note in the supplement must NOT count as a miss.
# ---------------------------------------------------------------------------

from app.services.ai_chat.observability import (  # noqa: E402
    _reply_hedges_on_question_subject,
)


Q1_RENAL = "他現在的腎功能怎麼樣？給我具體數值。"
Q1_REPLY_COMPLETE = (
    "腎功能嚴重受損：肌酸酐 6.52 mg/dL、血中尿素氮 143.9 mg/dL、"
    "估計腎絲球過濾率 7.97（依【關鍵檢驗】Cr 6.52，2026-04-26 22:30）。\n\n"
    "【說明/補充】\n"
    "(1) 數值符合急性腎損傷 KDIGO 第 3 期。\n"
    "(2) 建議調整經腎排除藥物劑量。\n"
    "(3) 目前資料缺少 MAR 與尿量紀錄，若需評估腎功能趨勢請補充。"
)

Q6_DUP = "目前用藥有什麼重複或安全問題嗎？"
Q6_REPLY_COMPLETE = (
    "目前有 4 條重複用藥警示：carbapenem 類重複、benzodiazepine 併用等"
    "（依【用藥安全摘要】重複用藥警示）。\n\n"
    "【說明/補充】\n"
    "(1) meropenem 與 imipenem 同屬 carbapenem 類。\n"
    "(2) 目前資料缺少 MAR，無法確認實際給藥時間，建議補充。"
)

DAY20_MED_CHANGE = "最近 72 小時改了什麼藥？"
DAY20_REPLY_MISS = (
    "無法判定最近 72 小時的用藥異動，目前系統無 MAR 資料。\n\n"
    "需要的資料包括：72 小時內的醫囑異動與給藥紀錄。"
)


def test_complete_answer_with_side_note_is_not_subject_hedged():
    """T3 acceptance: 完整作答 + 「缺少 MAR」註記 → 不觸發。"""
    assert _reply_hedges_on_question_subject(Q1_REPLY_COMPLETE, Q1_RENAL) is False
    assert _reply_hedges_on_question_subject(Q6_REPLY_COMPLETE, Q6_DUP) is False
    # ...while the full-text scan still sees the hedge (HEDGED info log).
    assert _reply_looks_hedged(Q1_REPLY_COMPLETE) is True


def test_true_prefetch_miss_still_fires():
    """DAY20 regression: the strongest F4-trigger candidate must keep
    firing — the subject paragraph itself is hedged."""
    assert _reply_hedges_on_question_subject(DAY20_REPLY_MISS, DAY20_MED_CHANGE) is True


def test_hedge_in_main_answer_about_subject_fires():
    reply = "查無近期腎功能檢驗，無法判斷目前腎功能。\n\n建議安排抽血。"
    assert _reply_hedges_on_question_subject(reply, Q1_RENAL) is True


def test_no_subject_tokens_falls_back_to_first_paragraph():
    """Degenerate question (all stopwords) → conservatively scan the main
    answer paragraph only."""
    reply = "血壓穩定。\n\n(1) 目前資料缺少 MAR。"
    assert _reply_hedges_on_question_subject(reply, "怎麼樣了嗎？") is False
    reply_hedged_main = "目前資料不足以判斷。\n\n(1) 建議補充檢驗。"
    assert _reply_hedges_on_question_subject(reply_hedged_main, "怎麼樣了嗎？") is True


def test_empty_inputs_never_fire():
    assert _reply_hedges_on_question_subject("", Q1_RENAL) is False
    assert _reply_hedges_on_question_subject("", "") is False
    # Question-less → first-paragraph fallback; Q1 main answer is clean.
    assert _reply_hedges_on_question_subject(Q1_REPLY_COMPLETE, "") is False
