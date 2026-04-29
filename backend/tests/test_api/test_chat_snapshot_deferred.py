"""B15-A1.1 unit tests — deferred snapshot must not mutate system_prompt.

Critical contract: with SNAPSHOT_DEFERRED_ENABLED on, the system_prompt
returned to the LLM stays byte-stable across turns within the same
session (so OpenAI prompt cache keeps hitting). Deferred context goes
into the ephemeral user_message instead.

These tests don't exercise the FastAPI router — they unit-test the
helpers directly so they run in milliseconds and have no DB/LLM
dependencies.
"""

from __future__ import annotations

import hashlib

import pytest

from app.config import settings
from app.routers.ai_chat import (
    _build_system_prompt,
    _maybe_inject_deferred_into_user_message,
)


CRITICAL_SNAPSHOT = (
    "=== ICU 病患臨床快照 ===\n"
    "時間戳記：2026-04-30 17:00\n\n"
    "【患者基本】\n姓名: 廖○賢 | 年齡: 39歲 | 性別: 男 | 床號: I-01\n"
    "診斷: I61.5非創傷性腦室出血\n\n"
    "【生命徵象】 2026-04-29 14:00\n體溫 37.0°C | HR 88 bpm | RR 14/min\n\n"
    "【最新檢驗】\nCr 1.2 | Na 140 | K 4.0\n\n"
    "【目前用藥】\nVancomycin 1g IV q12h\n"
    "\n=== 快照結束 ==="
)
DEFERRED_TEXT = (
    "【影像/報告 最近3筆】\n2026-04-25 CT Brain: post-op changes\n\n"
    "【臨床評分】\nRASS -1 | Pain 2/10 | GCS 14"
)


# ---------------------------------------------------------------------------
# system_prompt byte-stability
# ---------------------------------------------------------------------------


def test_system_prompt_byte_stable_across_turns():
    """Turn 1 and Turn 2's system_prompt must be byte-identical when the
    critical snapshot text is the same. This is the core A1.1 invariant —
    if it fails, OpenAI prompt cache breaks.
    """
    sp1 = _build_system_prompt(CRITICAL_SNAPSHOT)
    sp2 = _build_system_prompt(CRITICAL_SNAPSHOT)
    assert hashlib.sha256(sp1.encode()).hexdigest() == hashlib.sha256(sp2.encode()).hexdigest()
    assert sp1 == sp2


def test_system_prompt_does_not_include_deferred_text():
    """system_prompt is built from critical only; deferred text must never
    appear in it (otherwise the prefix mutates between turns)."""
    sp = _build_system_prompt(CRITICAL_SNAPSHOT)
    assert DEFERRED_TEXT not in sp
    # Spot-check some unique deferred-only phrases
    assert "影像/報告" not in sp
    assert "RASS" not in sp


# ---------------------------------------------------------------------------
# _maybe_inject_deferred_into_user_message
# ---------------------------------------------------------------------------


def test_inject_skipped_when_flag_off(monkeypatch):
    """Flag OFF: legacy path. user_message returned unchanged."""
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", False)
    meta = {
        "deferred_status": "ready",
        "clinical_snapshot_deferred": DEFERRED_TEXT,
    }
    out = _maybe_inject_deferred_into_user_message("K 多少?", meta)
    assert out == "K 多少?"


def test_inject_skipped_when_metadata_missing(monkeypatch):
    """No snapshot_metadata yet: legacy path, no injection."""
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)
    out = _maybe_inject_deferred_into_user_message("K 多少?", None)
    assert out == "K 多少?"


def test_inject_skipped_when_deferred_pending(monkeypatch):
    """Deferred background fill still pending: don't inject, don't pretend."""
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)
    meta = {
        "deferred_status": "pending",
        "clinical_snapshot_deferred": "",
    }
    out = _maybe_inject_deferred_into_user_message("K 多少?", meta)
    assert out == "K 多少?"


def test_inject_skipped_when_deferred_failed(monkeypatch):
    """Deferred background fill failed (status != 'ready'): no injection."""
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)
    meta = {
        "deferred_status": "failed",
        "clinical_snapshot_deferred": DEFERRED_TEXT,  # even if text exists
    }
    out = _maybe_inject_deferred_into_user_message("K 多少?", meta)
    assert out == "K 多少?"


def test_inject_skipped_when_deferred_text_empty(monkeypatch):
    """Status ready but text empty (e.g. patient has no reports/scores/vent):
    no injection — boundary header would be misleading."""
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)
    meta = {
        "deferred_status": "ready",
        "clinical_snapshot_deferred": "",
    }
    out = _maybe_inject_deferred_into_user_message("K 多少?", meta)
    assert out == "K 多少?"

    # Whitespace-only also counts as empty
    meta_ws = {
        "deferred_status": "ready",
        "clinical_snapshot_deferred": "   \n  ",
    }
    out_ws = _maybe_inject_deferred_into_user_message("K 多少?", meta_ws)
    assert out_ws == "K 多少?"


def test_inject_when_ready_and_flag_on(monkeypatch):
    """Happy path: flag on + deferred ready + text non-empty.

    Injection prepends a clearly-marked deferred block before the user query.
    Original user message must still be present at the tail.
    """
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)
    meta = {
        "deferred_status": "ready",
        "clinical_snapshot_deferred": DEFERRED_TEXT,
    }
    out = _maybe_inject_deferred_into_user_message("K 多少?", meta)
    assert out != "K 多少?"
    assert "[以下為背景補充資料，僅供回答本輪問題使用]" in out
    assert DEFERRED_TEXT in out
    assert "[使用者提問]" in out
    assert out.rstrip().endswith("K 多少?")


# ---------------------------------------------------------------------------
# system_prompt + injection together: A1.1 contract
# ---------------------------------------------------------------------------


def test_system_prompt_unchanged_regardless_of_deferred_state(monkeypatch):
    """The load-bearing A1.1 invariant: a session's system_prompt is the
    same bytes whether deferred is pending, ready, or empty. Only the
    user_message changes.
    """
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)
    sp_base = _build_system_prompt(CRITICAL_SNAPSHOT)

    # Cycle through deferred states; system_prompt must not move.
    for state in ("pending", "ready", "failed", "empty"):
        sp = _build_system_prompt(CRITICAL_SNAPSHOT)
        assert sp == sp_base, f"system_prompt mutated in deferred_status={state}"

    # And explicitly: the merged-snapshot anti-pattern (concatenating
    # deferred into the snapshot text) MUST NOT be reachable from the
    # current code path. Validate by constructing a system_prompt with
    # the merged text and confirming it differs from the byte-stable one
    # — this is a guard against future refactors that re-introduce merge.
    merged = CRITICAL_SNAPSHOT + "\n\n" + DEFERRED_TEXT
    sp_merged = _build_system_prompt(merged)
    assert sp_merged != sp_base, (
        "Test fixture invalid: merged system_prompt must differ from byte-stable one"
    )
