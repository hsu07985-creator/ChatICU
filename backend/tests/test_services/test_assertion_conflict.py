"""Tests for the LLM-free user-vs-snapshot assertion-conflict detector.

These pin down the exact behaviour that supports the AI-chat fact-
checking pipeline: detection must catch the meropenem-style case that
motivated the feature, and must NOT fire on common false-positive
phrasings (negation aimed at a symptom, negation about dose rather
than drug presence, etc.).
"""

import pytest

from app.services.assertion_conflict import (
    detect_med_negation_conflict,
    format_med_conflict_block,
)


ACTIVE_MEDS = ["Meropenem", "Tygacil", "Levophed", "Pantoloc", "Insulin", "Acetal"]


# Cases that MUST be detected.
@pytest.mark.parametrize(
    "msg,expected_med,expected_cue",
    [
        # The motivating real-world case (DAY16 meropenem incident).
        ("病人目前沒有meropenem", "Meropenem", "沒有"),
        ("病人目前沒有 meropenem", "Meropenem", "沒有"),
        # User explicitly says stopped — still flag, LLM resolves whether
        # the verbal update is detailed enough to accept.
        ("已停 Tygacil 昨晚 22:00", "Tygacil", "已停"),
        # English phrasing.
        ("Patient is not on insulin currently", "Insulin", "not on"),
        ("No Acetal needed right now", "Acetal", "no"),
        # Multiple negation cues — last one (closest) should win and match.
        ("這個病人沒在使用 Pantoloc", "Pantoloc", "沒在使用"),
    ],
)
def test_detects_conflict(msg, expected_med, expected_cue):
    conflicts = detect_med_negation_conflict(msg, ACTIVE_MEDS)
    assert conflicts, f"expected to detect conflict in: {msg!r}"
    assert conflicts[0]["med_name"] == expected_med
    assert conflicts[0]["matched_cue"] == expected_cue


# Cases that MUST NOT trigger a false positive.
@pytest.mark.parametrize(
    "msg,reason",
    [
        # Clause boundary (comma) separates the negation from the drug.
        ("病人沒有發燒，meropenem 是否繼續？", "negation belongs to a different clause"),
        # Negation aimed at dose/route, not the drug's presence.
        ("Levophed 沒有調量", "negation comes AFTER the drug, not before"),
        # No drug mentioned anywhere.
        ("沒有發燒沒有咳嗽", "no drug name in the message"),
        # Plain question, no negation.
        ("病人最近改了什麼藥？", "no negation cue"),
        # Drug appears with surrounding text but no negation cue near it.
        ("Meropenem 劑量需要調整嗎？", "no negation cue"),
    ],
)
def test_no_false_positive(msg, reason):
    conflicts = detect_med_negation_conflict(msg, ACTIVE_MEDS)
    assert not conflicts, f"unexpected match in {msg!r} — {reason}"


def test_multiple_conflicts_in_one_message():
    conflicts = detect_med_negation_conflict(
        "沒有用 Levophed 也沒有 Pantoloc", ACTIVE_MEDS
    )
    names = {c["med_name"] for c in conflicts}
    assert names == {"Levophed", "Pantoloc"}


def test_empty_inputs_are_safe():
    assert detect_med_negation_conflict("", ACTIVE_MEDS) == []
    assert detect_med_negation_conflict("anything", []) == []
    assert detect_med_negation_conflict(None, ACTIVE_MEDS) == []  # type: ignore[arg-type]


def test_format_block_includes_record_detail():
    conflicts = detect_med_negation_conflict("病人目前沒有 meropenem", ACTIVE_MEDS)
    records = [
        {
            "name": "Meropenem",
            "dose": "2.0",
            "unit": "瓶",
            "frequency": "q12h",
            "route": "IV infusion",
            "updated_at_str": "2026-04-27 23:56 UTC",
        }
    ]
    block = format_med_conflict_block(conflicts, records)
    # The block must surface specifics the LLM can cite back to the user.
    assert "[系統偵測：使用者聲明與目前資料不一致]" in block
    assert "Meropenem" in block
    assert "q12h" in block
    assert "2026-04-27 23:56 UTC" in block
    assert "沒有" in block  # the cue is shown
    # Must include the "what to do" instruction so the LLM (per step-1
    # prompt rules) is reminded to cite + ask, not silently agree.
    assert "事實核對規則" in block


def test_format_block_without_records_still_useful():
    conflicts = detect_med_negation_conflict("病人目前沒有 meropenem", ACTIVE_MEDS)
    block = format_med_conflict_block(conflicts, med_records=None)
    assert "Meropenem" in block
    assert "active 用藥清單中" in block


def test_format_block_empty_when_no_conflicts():
    assert format_med_conflict_block([], []) == ""
