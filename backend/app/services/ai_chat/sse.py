"""SSE transport glue for the ICU chat stream.

This module owns the streaming-transport mechanics that are independent of the
chat business logic:

- ``_with_heartbeat`` — wraps an async LLM token stream so SSE comment-frame
  heartbeats fire during stalls (keeps proxies from killing idle connections).
- ``_web_annotations_to_citations`` — maps OpenAI ``web_search`` url_citation
  annotations into the frontend Citation shape.
- ``split_main_and_detail`` — B14: splits the assembled reply into
  content / explanation at the earliest detail marker for the done payload.

The shared SSE *frame* helpers (``format_sse`` / ``done_frame`` / headers)
live in ``app.utils.sse`` — this module deliberately does not re-implement the
wire format.
"""

import asyncio

# O-2: SSE comment-frame heartbeat. Emitted during LLM stalls so Vercel /
# Railway / nginx-style proxies don't kill an idle-looking connection.
# The frontend's parseSseFrame in src/lib/api/ai.ts:244 treats lines without
# `event:`/`data:` prefixes as no-ops, so heartbeat frames flow through
# transparently without affecting the rendered conversation.
_HEARTBEAT_INTERVAL_S = 15.0

# B14: canonical detail-section markers — mirrors _DETAIL_MARKERS in
# src/lib/api/ai.ts (the frontend keeps its copy as a fallback for
# pre-split history rows on session reload).
_DETAIL_MARKERS = ("【說明/補充】", "【說明】", "說明/補充：", "說明：", "補充：")


def split_main_and_detail(text: str):
    """Split a reply into ``(content, explanation)`` at the earliest detail
    marker. ``explanation`` keeps the marker; ``None`` when there is no
    marker or when splitting would leave the content empty (degenerate
    marker-first replies stay unsplit)."""
    if not text:
        return "", None
    earliest = -1
    for marker in _DETAIL_MARKERS:
        idx = text.find(marker)
        if idx >= 0 and (earliest == -1 or idx < earliest):
            earliest = idx
    if earliest <= 0:
        return text, None
    content = text[:earliest].strip()
    explanation = text[earliest:].strip()
    if not content or not explanation:
        return text, None
    return content, explanation


async def _with_heartbeat(stream, interval_s: float = _HEARTBEAT_INTERVAL_S):
    """Wrap an async iterator so heartbeats fire during stalls.

    Yields:
      ('chunk', value)      for every item the underlying stream emits
      ('heartbeat', None)   every ``interval_s`` seconds of inactivity

    A producer coroutine drains the upstream into an internal queue so the
    consumer can race between real chunks and the heartbeat timer. The
    upstream task is always cancelled on exit (e.g. client disconnect) so
    the LLM stream is not leaked.
    """
    queue: asyncio.Queue = asyncio.Queue()
    _DONE = object()

    async def producer() -> None:
        try:
            async for item in stream:
                await queue.put(item)
        finally:
            await queue.put(_DONE)

    task = asyncio.create_task(producer())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=interval_s)
            except asyncio.TimeoutError:
                yield ("heartbeat", None)
                continue
            if item is _DONE:
                return
            yield ("chunk", item)
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


def _web_annotations_to_citations(
    annotations: list[dict], reply_text: str
) -> list[dict]:
    """Map OpenAI web_search url_citation annotations → frontend Citation shape.

    OpenAI gives `{type: "url_citation", url_citation: {url, title,
    start_index, end_index}}`; the frontend expects an `id`, `type`, `title`,
    `source`, `url`, `relevance`, plus optional `keyQuote` (the cited passage
    from the assistant reply, derived from the index span).
    """
    from urllib.parse import urlparse
    out: list[dict] = []
    for idx, ann in enumerate(annotations):
        if (ann or {}).get("type") != "url_citation":
            continue
        cit = ann.get("url_citation") or {}
        url = cit.get("url") or ""
        host = "web"
        try:
            host = (urlparse(url).netloc or "web").replace("www.", "") or "web"
        except Exception:
            pass
        start, end = cit.get("start_index"), cit.get("end_index")
        quote = ""
        if (
            isinstance(start, int) and isinstance(end, int)
            and 0 <= start < end <= len(reply_text)
        ):
            quote = reply_text[start:end].strip()
        out.append({
            "id": f"web-{idx}",
            "type": "literature",
            "title": cit.get("title") or url or "Untitled",
            "source": host,
            "url": url,
            "relevance": 1.0,
            "keyQuote": quote or None,
        })
    return out
