"""B14: done-payload content/explanation split at 【說明/補充】.

The icu_chat prompt mandates 主回答 → blank line → 【說明/補充】 in one text
blob. The frontend has an expandable detail panel wired to
``message.explanation`` — the backend now populates it by splitting the
assembled reply at the earliest detail marker (canonical marker list
mirrors src/lib/api/ai.ts ``_DETAIL_MARKERS``).
"""

from __future__ import annotations

import json

import pytest

from app.services.ai_chat.sse import split_main_and_detail


def test_split_at_detail_marker():
    reply = "主回答一句。\n\n【說明/補充】\n(1) 機轉說明。"
    content, explanation = split_main_and_detail(reply)
    assert content == "主回答一句。"
    assert explanation == "【說明/補充】\n(1) 機轉說明。"


def test_split_uses_earliest_marker():
    reply = "結論。\n\n說明：先到的。\n\n【說明/補充】後到的。"
    content, explanation = split_main_and_detail(reply)
    assert content == "結論。"
    assert explanation.startswith("說明：先到的。")


def test_no_marker_returns_whole_content():
    reply = "單純一句回答，沒有補充段。"
    content, explanation = split_main_and_detail(reply)
    assert content == reply
    assert explanation is None


def test_marker_at_start_keeps_content_nonempty():
    """Degenerate reply that begins with the marker → don't emit an empty
    content bubble; leave the reply unsplit."""
    reply = "【說明/補充】只有補充段。"
    content, explanation = split_main_and_detail(reply)
    assert content == reply
    assert explanation is None


def test_empty_input():
    assert split_main_and_detail("") == ("", None)


@pytest.mark.asyncio
async def test_done_payload_carries_split_explanation(client, seeded_db, monkeypatch):
    """End-to-end through /ai/chat/stream with a mocked LLM stream."""

    async def fake_llm_stream(*args, **kwargs):
        yield "腎功能重度受損，建議調整劑量。\n\n"
        yield "【說明/補充】\n(1) 依 eGFR 調整。"

    monkeypatch.setattr("app.routers.ai_chat.call_llm_stream", fake_llm_stream)

    response = await client.post(
        "/ai/chat/stream",
        json={"message": "腎功能如何？", "patientId": "pat_001"},
    )
    assert response.status_code == 200

    done = None
    event = None
    for line in response.text.splitlines():
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:") and event == "done":
            done = json.loads(line[5:].strip())
    assert done is not None
    message = done["message"]
    assert message["content"] == "腎功能重度受損，建議調整劑量。"
    assert message["explanation"] == "【說明/補充】\n(1) 依 eGFR 調整。"
