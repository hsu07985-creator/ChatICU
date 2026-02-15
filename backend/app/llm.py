"""
llm.py — Unified LLM entry point for ChatICU backend.
All LLM calls in the project MUST go through call_llm().
All embeddings MUST go through embed_texts().

Ported from ChatICU/config.py with backend Settings integration.
"""

from __future__ import annotations

from typing import Any

from app.config import settings

TASK_PROMPTS: dict[str, str] = {
    "clinical_summary": (
        "You are a clinical summarizer for ICU patients. "
        "Given structured patient data (JSON), produce a concise clinical summary. "
        "Include: primary diagnosis, key lab findings, current medications, "
        "and clinical recommendations. Keep under 500 characters."
    ),
    "patient_explanation": (
        "You are a patient educator. Rewrite clinical information "
        "in simple, empathetic language for patients and families."
    ),
    "guideline_interpretation": (
        "You are a clinical guideline expert. Given a clinical scenario "
        "and guideline text, provide contextualized recommendations."
    ),
    "multi_agent_decision": (
        "You are a clinical decision integrator. Synthesize multiple "
        "clinical assessments into a unified recommendation."
    ),
    "rag_generation": (
        "You are a medical literature analyst. Answer based ONLY on "
        "the provided context. Cite supporting evidence."
    ),
}


def call_llm(task: str, input_data: dict[str, Any], **kwargs) -> dict[str, Any]:
    """Call LLM for a specific task. Returns {status, content, metadata}."""
    if task not in TASK_PROMPTS:
        return {"status": "error", "content": f"Unknown task: {task}", "metadata": {}}

    system_prompt = TASK_PROMPTS[task]
    temperature = kwargs.get("temperature", settings.LLM_TEMPERATURE)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)

    try:
        if settings.LLM_PROVIDER == "openai":
            return _call_openai(system_prompt, input_data, temperature, max_tokens)
        elif settings.LLM_PROVIDER == "anthropic":
            return _call_anthropic(system_prompt, input_data, temperature, max_tokens)
        else:
            return {"status": "error", "content": f"Unsupported provider: {settings.LLM_PROVIDER}", "metadata": {}}
    except Exception as e:
        return {"status": "error", "content": str(e), "metadata": {}}


def _call_openai(system_prompt, input_data, temperature, max_tokens):
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=settings.LLM_MODEL, temperature=temperature, max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": str(input_data)},
        ],
    )
    return {
        "status": "success",
        "content": response.choices[0].message.content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        }},
    }


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts. Uses OpenAI when API key set, TF-IDF fallback otherwise."""
    if settings.OPENAI_API_KEY and settings.LLM_PROVIDER == "openai":
        return _embed_openai(texts)
    return _embed_tfidf(texts)


def _embed_openai(texts: list[str]) -> list[list[float]]:
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    batch_size = 100
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = client.embeddings.create(model=settings.OPENAI_EMBEDDING_MODEL, input=batch)
        all_embeddings.extend([item.embedding for item in response.data])
    return all_embeddings


def _embed_tfidf(texts: list[str]) -> list[list[float]]:
    """Lightweight local embedding using TF-IDF with hashing (256-d)."""
    import hashlib
    import math

    dim = 256
    vectors: list[list[float]] = []

    for text in texts:
        vec = [0.0] * dim
        words = text.lower().split()
        if not words:
            vectors.append(vec)
            continue
        for word in words:
            # SHA-256 avoids weak-hash findings while keeping deterministic hashing.
            h = int(hashlib.sha256(word.encode("utf-8")).hexdigest(), 16)
            idx = h % dim
            sign = 1.0 if (h // dim) % 2 == 0 else -1.0
            vec[idx] += sign
        # L2 normalize
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        vectors.append(vec)

    return vectors


def _call_anthropic(system_prompt, input_data, temperature, max_tokens):
    from anthropic import Anthropic
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=settings.LLM_MODEL, temperature=temperature, max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": str(input_data)}],
    )
    return {
        "status": "success",
        "content": response.content[0].text,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }},
    }
