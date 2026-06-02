"""CACHE-SENSITIVE prompt + user-message assembly for the ICU chat stream.

DO NOT "tidy" the string layout in this module. The OpenAI prompt cache key is
the message-array prefix that is byte-identical across requests:
``system_prompt`` + persisted history forms the stable prefix. Mutating
``system_prompt`` mid-session (which a prior ``_merged_snapshot`` helper did)
busts cache for every subsequent turn in that session — measured in canary at
hit_ratio_p50 dropping from 70% to 0%.

The fix, preserved here verbatim:
- ``_build_system_prompt`` keeps ``system_prompt`` = TASK_PROMPTS +
  critical-snapshot-only, byte-stable per session.
- Deferred / prefetch / assertion-conflict context is folded into the
  *ephemeral* ``user_message`` via the ``_maybe_inject_*`` helpers and the
  ``[使用者提問]`` marker — it goes to the LLM but is NOT persisted, so the
  byte-stable prefix is never disturbed.

Keep the ``[使用者提問]\\n`` marker and every injected-block string EXACTLY as
written.
"""

from typing import Optional

from app.config import settings
from app.llm import TASK_PROMPTS

# The marker that separates injected per-turn context from the real user
# question inside the ephemeral user_message. Several helpers split on it to
# avoid nesting question wrappers; its layout is load-bearing for prompt cache
# stability and MUST NOT change.
_QUESTION_MARKER = "[使用者提問]\n"


def _build_system_prompt(snapshot: str) -> str:
    base = TASK_PROMPTS["icu_chat"]
    return f"{base}\n\n[目前病患資料]\n{snapshot}"


def _maybe_inject_deferred_into_user_message(
    user_message: str, snapshot_metadata: Optional[dict]
) -> str:
    """B15-A1.1: prepend deferred snapshot context to the LLM-facing user
    message when the background fill has completed, so the deferred bytes
    are NEVER part of system_prompt or persisted history.

    Why this matters for OpenAI prompt cache:
      The cache key is the message-array prefix that is byte-identical
      across requests. system_prompt + persisted history forms the
      stable prefix; mutating system_prompt mid-session (which the prior
      _merged_snapshot helper did) busts cache for every subsequent turn
      in that session — measured in canary at hit_ratio_p50 dropping
      from 70% to 0%.

      A1.1 keeps system_prompt = TASK_PROMPTS + critical-snapshot-only,
      byte-stable per session. Deferred context is folded into the
      ephemeral user_message — it goes to the LLM but is NOT persisted
      via _event_stream (original_message stays clean for DB history).

    Returns user_message unchanged when:
      - SNAPSHOT_DEFERRED_ENABLED is false (legacy path)
      - snapshot_metadata is None (no session context yet)
      - deferred_status is not "ready" (background fill still pending or failed)
      - deferred text is empty (e.g. patient has no reports/scores/vent)
    """
    if not settings.SNAPSHOT_DEFERRED_ENABLED:
        return user_message
    if not snapshot_metadata:
        return user_message
    if snapshot_metadata.get("deferred_status") != "ready":
        return user_message
    deferred = (snapshot_metadata.get("clinical_snapshot_deferred") or "").strip()
    if not deferred:
        return user_message
    return (
        "[以下為背景補充資料，僅供回答本輪問題使用]\n"
        f"{deferred}\n\n"
        f"[使用者提問]\n{user_message}"
    )


def _maybe_inject_question_prefetch_into_user_message(
    user_message: str,
    prefetch_context: str,
) -> str:
    """Attach question-triggered context to the current LLM turn only.

    Like deferred snapshot injection, this must not be persisted into
    ai_messages and must not mutate the session's system prompt. If deferred
    context is already wrapped around the question, insert the prefetch block
    before the final [使用者提問] marker to avoid nested question wrappers.
    """
    context = (prefetch_context or "").strip()
    if not context:
        return user_message

    block = (
        "[以下為依本輪問題預取的資料，僅供回答本輪問題使用]\n"
        f"{context}"
    )
    marker = "[使用者提問]\n"
    if marker in user_message:
        prefix, question = user_message.rsplit(marker, 1)
        return f"{prefix.rstrip()}\n\n{block}\n\n{marker}{question}"
    return f"{block}\n\n{marker}{user_message}"


def _maybe_inject_assertion_conflict_into_user_message(
    user_message: str,
    conflict_block: str,
) -> str:
    """Inject a [系統偵測] block when the user's current message contradicts
    the snapshot. Same shape as _maybe_inject_question_prefetch_... so the
    block lands inside the ephemeral user_message — never persisted, never
    part of the byte-stable system_prompt prefix (so prompt cache stays warm).
    """
    block = (conflict_block or "").strip()
    if not block:
        return user_message
    marker = "[使用者提問]\n"
    if marker in user_message:
        prefix, question = user_message.rsplit(marker, 1)
        return f"{prefix.rstrip()}\n\n{block}\n\n{marker}{question}"
    return f"{block}\n\n{marker}{user_message}"
