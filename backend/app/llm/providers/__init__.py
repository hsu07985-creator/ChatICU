"""providers — per-provider LLM adapters for ``app.llm``.

``openai`` is the production adapter (the project is OpenAI-only). ``anthropic``
is an OPTIONAL, isolated adapter kept for completeness — there is no Anthropic
budget in production, so it is never on the default path. The facade
(``app.llm``) wires these into a small provider-adapter registry.
"""
