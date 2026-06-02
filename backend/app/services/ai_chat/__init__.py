"""ai_chat service package.

Extracted from the formerly-monolithic ``app/routers/ai_chat.py`` so the
router stays a thin transport layer. Submodules:

- ``sse``                — SSE transport glue (heartbeat wrapper, web-citation
                           mapping). The shared wire helpers live in
                           ``app.utils.sse``.
- ``prompt_assembly``    — CACHE-SENSITIVE prompt/user-message assembly
                           helpers. The ``[使用者提問]`` marker layout and the
                           four ``_maybe_inject_*`` helpers MUST keep their
                           exact string layout (see module docstring for the
                           70%→0% prompt-cache regression note).
- ``snapshot_lifecycle`` — snapshot build/refresh shared between
                           ``chat_stream`` and ``refresh_session_snapshot``,
                           plus the background deferred-fill task.
- ``observability``      — hedging detection + citation-audit / assertion-
                           conflict logging glue.

Public symbols are re-exported here for convenience, but the router keeps its
own module-level re-exports so existing ``app.routers.ai_chat.<name>`` import
and monkeypatch sites keep working unchanged.
"""
