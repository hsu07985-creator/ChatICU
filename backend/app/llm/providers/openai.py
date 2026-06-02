"""providers/openai.py — OpenAI adapter for ``app.llm`` (production path).

Collapses the former single-turn / multi-turn copy-paste pair into one
``_openai_chat`` (single-turn is multi-turn with one synthesized user
message) and one streaming entrypoint. The reasoning-vs-temperature decision
lives on the ``app.llm`` facade (``_build_openai_reasoning_param_block``) so
its module-level ``_REASONING_EFFORT`` binding stays monkeypatchable by tests.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, List, Optional

from app.config import settings

from app.llm.audit import _maybe_capture_provider_raw
from app.llm.clients import _get_openai_async, _get_openai_sync

logger = logging.getLogger("chaticu")


def _reasoning_param_block(**kwargs) -> dict:
    """Proxy to the facade helper so the patched ``_REASONING_EFFORT`` is read.

    Imported lazily to (a) avoid an import cycle and (b) honor
    ``monkeypatch.setattr(app.llm, "_REASONING_EFFORT", ...)`` in tests.
    """
    import app.llm as facade
    return facade._build_openai_reasoning_param_block(**kwargs)


def _single_turn_messages(input_data: Any) -> List[dict]:
    """Single-turn input == one user message carrying the JSON payload."""
    return [{"role": "user", "content": json.dumps(input_data, ensure_ascii=False, default=str)}]


def _log_cache_stats(task: str, usage) -> tuple[int, int]:
    cached_tokens = 0
    details = getattr(usage, "prompt_tokens_details", None)
    if details is not None:
        cached_tokens = getattr(details, "cached_tokens", 0) or 0
    prompt_tokens = usage.prompt_tokens
    if prompt_tokens:
        logger.info(
            "[LLM][CACHE] task=%s prompt_tokens=%d cached_tokens=%d hit_ratio=%.0f%% completion_tokens=%d",
            task,
            prompt_tokens,
            cached_tokens,
            (cached_tokens / prompt_tokens * 100),
            usage.completion_tokens,
        )
    return prompt_tokens, cached_tokens


def _openai_chat(
    system_prompt,
    messages: List[dict],
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
    disable_reasoning: bool = False,
    capture_input_payload: Any = None,
):
    """Unified non-streaming OpenAI call (covers single- and multi-turn).

    ``capture_input_payload`` is what gets fingerprinted in the audit capture;
    callers pass the original ``input_data`` for single-turn or ``messages``
    for multi-turn to preserve the prior per-path capture behavior.
    """
    client = _get_openai_sync()
    api_messages = [{"role": "system", "content": system_prompt}]
    api_messages.extend(messages)
    create_kwargs: dict = dict(
        model=settings.LLM_MODEL,
        max_completion_tokens=max_tokens,
        messages=api_messages,
    )
    create_kwargs.update(_reasoning_param_block(
        task=task,
        temperature=temperature,
        disable_reasoning=disable_reasoning,
    ))
    response = client.chat.completions.create(**create_kwargs)
    _maybe_capture_provider_raw(
        provider="openai",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=capture_input_payload if capture_input_payload is not None else messages,
        response_payload=response,
    )
    content = response.choices[0].message.content or ""
    if not content.strip():
        return {"status": "error", "content": "Model returned empty response (reasoning token budget may be too low)", "metadata": {}}
    prompt_tokens, cached_tokens = _log_cache_stats(task, response.usage)
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "cached_tokens": cached_tokens,
        }},
    }


def _call_openai(
    system_prompt,
    input_data,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
    disable_reasoning: bool = False,
):
    """Single-turn OpenAI call (back-compat wrapper over ``_openai_chat``)."""
    return _openai_chat(
        system_prompt,
        _single_turn_messages(input_data),
        temperature,
        max_tokens,
        task=task,
        request_id=request_id,
        trace_id=trace_id,
        disable_reasoning=disable_reasoning,
        capture_input_payload=input_data,
    )


def _call_openai_multi(
    system_prompt,
    messages,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    """Multi-turn OpenAI call (back-compat wrapper over ``_openai_chat``).

    W2-T3: the gpt-5 reasoning fallback that this path used to be missing now
    lives in the shared ``_build_openai_reasoning_param_block`` helper, so the
    single-turn and multi-turn paths stay aligned.
    """
    return _openai_chat(
        system_prompt,
        messages,
        temperature,
        max_tokens,
        task=task,
        request_id=request_id,
        trace_id=trace_id,
        disable_reasoning=False,
        capture_input_payload=messages,
    )


async def _stream_openai(
    system_prompt: str,
    messages: List[dict],
    max_tokens: int,
    *,
    task: str,
    request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    disable_reasoning: bool = False,
) -> AsyncGenerator[str, None]:
    """Stream tokens from OpenAI using the async client."""
    client = _get_openai_async()
    api_messages = [{"role": "system", "content": system_prompt}]
    api_messages.extend(messages)

    # Web-search PoC: only icu_chat reroutes to the search-capable model.
    # Search model rejects reasoning_effort, so we skip the param block
    # entirely on that path.
    use_web_search = settings.LLM_WEB_SEARCH_ENABLED and task == "icu_chat"
    effective_model = settings.LLM_WEB_SEARCH_MODEL if use_web_search else settings.LLM_MODEL

    create_kwargs: dict = dict(
        model=effective_model,
        max_completion_tokens=max_tokens,
        messages=api_messages,
        stream=True,
        stream_options={"include_usage": True},
    )
    if not use_web_search:
        create_kwargs.update(_reasoning_param_block(
            task=task,
            temperature=0.3,
            disable_reasoning=disable_reasoning,
            icu_chat_skips_reasoning=True,
        ))
    stream = await client.chat.completions.create(**create_kwargs)

    full_content = ""
    usage_meta = {}
    annotations: list[dict] = []
    async for chunk in stream:
        if chunk.usage:
            cached_tokens = 0
            details = getattr(chunk.usage, "prompt_tokens_details", None)
            if details is not None:
                cached_tokens = getattr(details, "cached_tokens", 0) or 0
            usage_meta = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "cached_tokens": cached_tokens,
            }
        if chunk.choices and chunk.choices[0].delta:
            delta = chunk.choices[0].delta
            if delta.content:
                full_content += delta.content
                yield delta.content
            delta_anns = getattr(delta, "annotations", None)
            if delta_anns:
                for a in delta_anns:
                    annotations.append(a.model_dump() if hasattr(a, "model_dump") else dict(a))

    _maybe_capture_provider_raw(
        provider="openai", task=task, model=effective_model,
        request_id=request_id, trace_id=trace_id,
        input_payload=messages, response_payload={"content": full_content[:500], "usage": usage_meta},
    )
    done_payload: dict = {"__done__": True, "model": effective_model, "usage": usage_meta}
    if annotations:
        done_payload["annotations"] = annotations
    yield json.dumps(done_payload)
