"""Shared Server-Sent Events (SSE) helpers.

Captures the COMMON wire shape used by the streaming endpoints in
``app/routers/ai_chat.py`` and ``app/routers/clinical.py`` WITHOUT changing the
bytes any endpoint currently emits. Minimal and unopinionated — callers keep
full control over event names and payload contents.

Wire format reminders (do not "improve" these — the frontend
``parseSseFrame`` in ``src/lib/api/ai.ts`` depends on them exactly):
- A frame is ``event: <name>\\ndata: <payload>\\n\\n`` for named events, or
  ``data: <payload>\\n\\n`` when ``event`` is omitted.
- Dict payloads are JSON-encoded with ``ensure_ascii=False`` so Chinese text
  is emitted verbatim (not ``\\uXXXX`` escaped).
- The stream terminator is a named ``done`` event (there is NO literal
  ``[DONE]`` sentinel string in this codebase).
"""

import json
from typing import Any, Dict, Optional, Union

__all__ = [
    "format_sse",
    "done_frame",
    "SSE_HEADERS",
    "SSE_HEADERS_KEEPALIVE",
    "SSE_MEDIA_TYPE",
]

SSE_MEDIA_TYPE = "text/event-stream"

# Standard StreamingResponse headers. Matches ai_chat.py exactly.
SSE_HEADERS: Dict[str, str] = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}

# Variant used by clinical.py (adds the explicit keep-alive hint).
SSE_HEADERS_KEEPALIVE: Dict[str, str] = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


def format_sse(
    data: Union[Dict[str, Any], str],
    event: Optional[str] = None,
) -> str:
    """Format a single SSE frame.

    ``data`` is JSON-encoded (``ensure_ascii=False``) when a dict is passed, or
    emitted as-is when already a string. ``event`` adds an ``event:`` line.

    Produces byte-for-byte what the existing endpoints emit, e.g.::

        format_sse({"chunk": text}, event="delta")
        # -> 'event: delta\\ndata: {"chunk": "..."}\\n\\n'
    """
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    if event is None:
        return f"data: {payload}\n\n"
    return f"event: {event}\ndata: {payload}\n\n"


def done_frame(data: Union[Dict[str, Any], str]) -> str:
    """The stream terminator: a named ``done`` event carrying a final payload.

    Equivalent to ``format_sse(data, event="done")``.
    """
    return format_sse(data, event="done")
