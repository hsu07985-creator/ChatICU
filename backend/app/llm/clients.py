"""clients.py — Lazy-initialized provider client singletons for ``app.llm``.

Clients are created on first use (not at import) to avoid a TLS handshake per
request and to keep import cheap.

The singleton *state* lives on the ``app.llm`` facade module, not here. This
is deliberate: existing tests reset the cached client via
``monkeypatch.setattr(app.llm, "_openai_sync_client", None)`` (see
``tests/test_services/test_embedding.py``). Keeping the four
``_<provider>_<sync|async>_client`` globals on the facade preserves that
contract, while the construction logic stays factored out here.
"""

from __future__ import annotations

from app.config import settings


def _facade():
    """Return the ``app.llm`` facade module that owns the singleton globals.

    Imported lazily to avoid a circular import at module load time.
    """
    import app.llm as facade  # noqa: WPS433 (intentional lazy import)
    return facade


def _get_openai_sync():
    facade = _facade()
    if facade._openai_sync_client is None:
        from openai import OpenAI
        facade._openai_sync_client = OpenAI(api_key=settings.OPENAI_API_KEY)
    return facade._openai_sync_client


def _get_openai_async():
    facade = _facade()
    if facade._openai_async_client is None:
        from openai import AsyncOpenAI
        facade._openai_async_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return facade._openai_async_client


def _get_anthropic_sync():
    facade = _facade()
    if facade._anthropic_sync_client is None:
        from anthropic import Anthropic
        facade._anthropic_sync_client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return facade._anthropic_sync_client


def _get_anthropic_async():
    facade = _facade()
    if facade._anthropic_async_client is None:
        from anthropic import AsyncAnthropic
        facade._anthropic_async_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return facade._anthropic_async_client
