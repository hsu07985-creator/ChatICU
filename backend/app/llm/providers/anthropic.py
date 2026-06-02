"""providers/anthropic.py — OPTIONAL Anthropic adapter for ``app.llm``.

NOT ON THE PRODUCTION PATH. ChatICU production is OpenAI-only and has no
Anthropic budget; these functions are retained for completeness / parity and
are only reachable when ``settings.LLM_PROVIDER == "anthropic"``. Kept here,
isolated, so the OpenAI entrypoints are not interleaved with Anthropic
branches. Do not add Anthropic-specific optimizations (e.g. cache_control)
without an explicit budget decision.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional

from app.config import settings

from app.llm.audit import _maybe_capture_provider_raw
from app.llm.clients import _get_anthropic_async, _get_anthropic_sync


def _call_anthropic(
    system_prompt,
    input_data,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    client = _get_anthropic_sync()
    response = client.messages.create(
        model=settings.LLM_MODEL, temperature=temperature, max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": json.dumps(input_data, ensure_ascii=False, default=str)}],
    )
    _maybe_capture_provider_raw(
        provider="anthropic",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=input_data,
        response_payload=response,
    )
    return {
        "status": "success",
        "content": response.content[0].text,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }},
    }


def _call_anthropic_multi(
    system_prompt,
    messages,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    client = _get_anthropic_sync()
    response = client.messages.create(
        model=settings.LLM_MODEL, temperature=temperature, max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
    )
    _maybe_capture_provider_raw(
        provider="anthropic",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=messages,
        response_payload=response,
    )
    return {
        "status": "success",
        "content": response.content[0].text,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }},
    }


async def _stream_anthropic(
    system_prompt: str,
    messages: List[dict],
    max_tokens: int,
    *,
    task: str,
    request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from Anthropic using the async client."""
    client = _get_anthropic_async()
    full_content = ""
    usage_meta = {}

    async with client.messages.stream(
        model=settings.LLM_MODEL,
        temperature=0.3,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            full_content += text
            yield text
        # Get final message for usage info
        final_message = await stream.get_final_message()
        usage_meta = {
            "input_tokens": final_message.usage.input_tokens,
            "output_tokens": final_message.usage.output_tokens,
        }

    _maybe_capture_provider_raw(
        provider="anthropic", task=task, model=settings.LLM_MODEL,
        request_id=request_id, trace_id=trace_id,
        input_payload=messages, response_payload={"content": full_content[:500], "usage": usage_meta},
    )
    yield json.dumps({"__done__": True, "model": settings.LLM_MODEL, "usage": usage_meta})
