"""app.llm — Unified LLM entry point for ChatICU backend.

All LLM calls in the project MUST go through ``call_llm`` /
``call_llm_multi_turn`` / ``call_llm_stream``. All embeddings MUST go through
``embed_texts``.

Ported from ChatICU/config.py with backend Settings integration.

This is a facade package. The implementation is split across sibling modules:

    prompts.py            — clinical system-prompt prose (TASK_PROMPTS)
    audit.py              — observability / raw-capture helpers
    clients.py            — lazy provider client construction
    providers/openai.py   — OpenAI adapter (production path)
    providers/anthropic.py— OPTIONAL Anthropic adapter (no prod budget)

The public API and several internal symbols are re-exported from this module
so existing imports (``from app.llm import call_llm, TASK_PROMPTS, ...``) and
test monkeypatches (``app.llm._openai_sync_client``, ``app.llm._REASONING_EFFORT``)
keep working unchanged.
"""

from __future__ import annotations

import logging
from typing import Any, AsyncGenerator, List, Optional

from app.config import settings

# ── Re-exported helpers (kept importable from app.llm) ────────────────────────
from app.llm.prompts import _LANG_DIRECTIVE, TASK_PROMPTS
from app.llm.audit import (
    _capture_dir_path,
    _fingerprint_payload,
    _maybe_capture_provider_raw,
    _model_dump_safe,
    _normalize_trace_value,
)
from app.llm import clients as _clients
from app.llm.providers import openai as _openai
from app.llm.providers import anthropic as _anthropic

logger = logging.getLogger("chaticu")


# ── Lazy-initialized client singletons (avoid TLS handshake per request) ──────
# State lives here on the facade so tests can reset it via
# ``monkeypatch.setattr(app.llm, "_openai_sync_client", None)``.
_openai_sync_client = None
_openai_async_client = None
_anthropic_sync_client = None
_anthropic_async_client = None

# Client getters (construction logic in clients.py; state above).
_get_openai_sync = _clients._get_openai_sync
_get_openai_async = _clients._get_openai_async
_get_anthropic_sync = _clients._get_anthropic_sync
_get_anthropic_async = _clients._get_anthropic_async

# Provider call/stream adapters (re-exported for back-compat).
_call_openai = _openai._call_openai
_call_openai_multi = _openai._call_openai_multi
_stream_openai = _openai._stream_openai
_call_anthropic = _anthropic._call_anthropic
_call_anthropic_multi = _anthropic._call_anthropic_multi
_stream_anthropic = _anthropic._stream_anthropic


# ── Conversation history thresholds (configurable via env: F08) ──
RECENT_MSG_WINDOW = settings.LLM_RECENT_MSG_WINDOW
COMPRESS_THRESHOLD = settings.LLM_COMPRESS_THRESHOLD

# Reasoning models (o-series, gpt-5.4-mini) don't support temperature
_REASONING_EFFORT = (settings.LLM_REASONING_EFFORT or "").strip() or None


def _build_openai_reasoning_param_block(
    *,
    task: str,
    temperature: float,
    disable_reasoning: bool = False,
    icu_chat_skips_reasoning: bool = False,
) -> dict:
    """Single source of truth for OpenAI reasoning_effort vs temperature.

    Returns a partial kwargs dict to merge into ``client.chat.completions.create``.

    - If reasoning is wanted and the call qualifies, sets ``reasoning_effort``
      from ``LLM_REASONING_EFFORT``.
    - Else if model is gpt-5.x, sets ``reasoning_effort="none"``. Required
      because gpt-5.x without an explicit field falls back to the server
      default (medium), which can consume the entire ``max_completion_tokens``
      budget and yield empty output. (W2-T3 fix: previously _call_openai_multi
      did not have this fallback and would silently emit temperature, which
      reasoning models reject and which then triggered the empty-output trap.)
      Note: pre-5.5 gpt-5 used ``"minimal"`` for this slot; gpt-5.5+ replaced
      that with ``"none"`` and rejects ``"minimal"`` outright (HTTP 400).
    - Else (non-reasoning models like gpt-4o), passes ``temperature``.

    ``icu_chat_skips_reasoning=True`` is the streaming-chat TTFT carve-out:
    user-facing chat skips reasoning to avoid the 2-5s pause before the
    first visible token. Only ``_stream_openai`` sets this; non-streaming
    paths keep reasoning for answer quality.
    """
    use_reasoning = (
        bool(_REASONING_EFFORT)
        and not disable_reasoning
        and not (icu_chat_skips_reasoning and task == "icu_chat")
    )
    if use_reasoning:
        return {"reasoning_effort": _REASONING_EFFORT}
    if settings.LLM_MODEL.startswith("gpt-5"):
        return {"reasoning_effort": "none"}
    return {"temperature": temperature}


# ── Provider-adapter registry ─────────────────────────────────────────────────
# Each provider entry maps to its single-turn / multi-turn / streaming adapter.
# Dispatch below is data-driven instead of a 3-way if/elif per entrypoint.
_PROVIDER_ADAPTERS: dict[str, dict[str, Any]] = {
    "openai": {
        "api_key_attr": "OPENAI_API_KEY",
        "api_key_error": "OPENAI_API_KEY is not set",
        "single": _openai._call_openai,
        "multi": _openai._call_openai_multi,
        "stream": _openai._stream_openai,
        "single_supports_disable_reasoning": True,
        "stream_supports_disable_reasoning": True,
    },
    "anthropic": {
        "api_key_attr": "ANTHROPIC_API_KEY",
        "api_key_error": "ANTHROPIC_API_KEY is not set",
        "single": _anthropic._call_anthropic,
        "multi": _anthropic._call_anthropic_multi,
        "stream": _anthropic._stream_anthropic,
        "single_supports_disable_reasoning": False,
        "stream_supports_disable_reasoning": False,
    },
}


def _missing_api_key_error() -> Optional[str]:
    """Return a stable error string if the active provider lacks credentials."""
    adapter = _PROVIDER_ADAPTERS.get(settings.LLM_PROVIDER)
    if adapter is None:
        return None
    key = (getattr(settings, adapter["api_key_attr"], "") or "").strip()
    if not key:
        return adapter["api_key_error"]
    return None


def call_llm(task: str, input_data: dict[str, Any], **kwargs) -> dict[str, Any]:
    """Call LLM for a specific task. Returns {status, content, metadata}.

    kwargs:
        disable_reasoning (bool): when True, skip reasoning_effort (used for
            grammar-only polish modes where deep reasoning adds 3–5s with no
            quality gain).
    """
    if task not in TASK_PROMPTS:
        return {"status": "error", "content": f"Unknown task: {task}", "metadata": {}}

    system_prompt = TASK_PROMPTS[task]
    temperature = kwargs.get("temperature", 0.3)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))
    disable_reasoning = bool(kwargs.get("disable_reasoning", False))

    # Avoid calling external providers with missing credentials; return a stable error
    # that routers can translate into a proper HTTP error response.
    key_error = _missing_api_key_error()
    if key_error:
        return {"status": "error", "content": key_error, "metadata": {}}

    adapter = _PROVIDER_ADAPTERS.get(settings.LLM_PROVIDER)
    if adapter is None:
        return {"status": "error", "content": f"Unsupported provider: {settings.LLM_PROVIDER}", "metadata": {}}

    try:
        call_kwargs: dict[str, Any] = dict(
            task=task, request_id=request_id, trace_id=trace_id,
        )
        if adapter["single_supports_disable_reasoning"]:
            call_kwargs["disable_reasoning"] = disable_reasoning
        return adapter["single"](
            system_prompt, input_data, temperature, max_tokens, **call_kwargs,
        )
    except Exception as e:
        return {"status": "error", "content": str(e), "metadata": {}}


def call_llm_multi_turn(
    task: str,
    messages: List[dict[str, str]],
    **kwargs,
) -> dict[str, Any]:
    """Call LLM with a multi-turn conversation history.

    Args:
        task: Task name from TASK_PROMPTS (used as system prompt).
        messages: List of {"role": "user"|"assistant", "content": "..."}.
        **kwargs: temperature, max_tokens overrides.

    Returns:
        {status, content, metadata} — same shape as call_llm().
    """
    if task not in TASK_PROMPTS:
        return {"status": "error", "content": f"Unknown task: {task}", "metadata": {}}

    system_prompt = TASK_PROMPTS[task]
    temperature = kwargs.get("temperature", 0.3)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))

    # Avoid calling external providers with missing credentials; return a stable error
    # that routers can translate into a proper HTTP error response.
    key_error = _missing_api_key_error()
    if key_error:
        return {"status": "error", "content": key_error, "metadata": {}}

    adapter = _PROVIDER_ADAPTERS.get(settings.LLM_PROVIDER)
    if adapter is None:
        return {"status": "error", "content": f"Unsupported provider: {settings.LLM_PROVIDER}", "metadata": {}}

    try:
        return adapter["multi"](
            system_prompt, messages, temperature, max_tokens,
            task=task, request_id=request_id, trace_id=trace_id,
        )
    except Exception as e:
        return {"status": "error", "content": str(e), "metadata": {}}


async def call_llm_stream(
    task: str,
    messages: List[dict],
    **kwargs,
) -> AsyncGenerator[str, None]:
    """Stream LLM tokens for a multi-turn conversation.

    Yields individual text chunks as they arrive from the provider's
    streaming API. The final yield is a JSON metadata string prefixed
    with ``[DONE]`` containing usage statistics.

    Optional kwargs:
        system_prompt_override: str — replaces the TASK_PROMPTS[task] system prompt.
        disable_reasoning: bool — when True, skip reasoning_effort (used for
            grammar-only polish modes where deep reasoning adds 3–5s with no
            quality gain).
    """
    system_prompt_override = kwargs.get("system_prompt_override")
    if system_prompt_override:
        system_prompt = system_prompt_override
    elif task in TASK_PROMPTS:
        system_prompt = TASK_PROMPTS[task]
    else:
        yield "[ERROR] Unknown task: " + task
        return
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))
    disable_reasoning = bool(kwargs.get("disable_reasoning", False))

    key_error = _missing_api_key_error()
    if key_error:
        yield "[ERROR] " + key_error
        return

    adapter = _PROVIDER_ADAPTERS.get(settings.LLM_PROVIDER)
    if adapter is None:
        yield f"[ERROR] Unsupported provider: {settings.LLM_PROVIDER}"
        return

    try:
        stream_kwargs: dict[str, Any] = dict(
            task=task, request_id=request_id, trace_id=trace_id,
        )
        if adapter["stream_supports_disable_reasoning"]:
            stream_kwargs["disable_reasoning"] = disable_reasoning
        async for chunk in adapter["stream"](
            system_prompt, messages, max_tokens, **stream_kwargs,
        ):
            yield chunk
    except Exception as e:
        logger.error("[LLM][STREAM] Streaming failed: %s", str(e)[:500])
        yield f"[ERROR] {str(e)}"


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts using OpenAI API. Raises if API key is missing or call fails."""
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required for embedding. No fallback available.")
    client = _get_openai_sync()
    batch_size = 100
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = client.embeddings.create(
            model=settings.OPENAI_EMBEDDING_MODEL, input=batch, dimensions=1536,
        )
        all_embeddings.extend([item.embedding for item in response.data])
    return all_embeddings


__all__ = [
    "TASK_PROMPTS",
    "call_llm",
    "call_llm_multi_turn",
    "call_llm_stream",
    "embed_texts",
]
