"""
llm.py — Unified LLM entry point for ChatICU backend.
All LLM calls in the project MUST go through call_llm().
All embeddings MUST go through embed_texts().

Ported from ChatICU/config.py with backend Settings integration.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List

from app.config import settings

logger = logging.getLogger("chaticu")

# ── Conversation history thresholds (configurable via env: F08) ──
RECENT_MSG_WINDOW = settings.LLM_RECENT_MSG_WINDOW
COMPRESS_THRESHOLD = settings.LLM_COMPRESS_THRESHOLD

_LANG_DIRECTIVE = (
    "Always reply in Traditional Chinese (繁體中文). "
    "Use medical terminology common in Taiwan "
    "(e.g., 加護病房, not 重症监护病房; 血氧飽和度, not 血氧饱和度)."
)

TASK_PROMPTS: dict[str, str] = {
    "clinical_summary": (
        "You are a clinical summarizer for ICU patients. "
        "Given structured patient data (JSON), produce a concise clinical summary. "
        "Include: primary diagnosis, key lab findings, current medications, "
        "and clinical recommendations. "
        + _LANG_DIRECTIVE
    ),
    "patient_explanation": (
        "You are a patient educator. Rewrite clinical information "
        "in simple, empathetic language for patients and families. "
        + _LANG_DIRECTIVE
    ),
    "guideline_interpretation": (
        "You are a clinical guideline expert. Given a clinical scenario "
        "and guideline text, provide contextualized recommendations. "
        + _LANG_DIRECTIVE
    ),
    "multi_agent_decision": (
        "You are a clinical decision integrator. Synthesize multiple "
        "clinical assessments into a unified recommendation. "
        + _LANG_DIRECTIVE
    ),
    "rag_generation": (
        "You are an ICU clinical decision assistant. "
        "If patient data is provided, incorporate it into your analysis. "
        "Answer based ONLY on the provided context and patient data. "
        "Output EXACTLY two sections with these headers: "
        "【主回答】 and 【說明/補充】. "
        "For 【主回答】: provide ONE short sentence (action-first, concrete and directly executable). "
        "If this is a multiple-choice question, start with option letter format such as 'C。...'. "
        "If this is a yes/no decision question, start with '建議' or '不建議' and include the immediate next step. "
        "Avoid vague wording like '密切監測'. When monitoring is needed, specify: "
        "(1) what to monitor (e.g., RR/SpO2/RASS/BP), "
        "(2) monitoring frequency, and "
        "(3) escalation trigger. "
        "For 【說明/補充】: provide 2-4 short bullet points covering rationale, risk, and alternatives. "
        "Avoid long paragraphs and avoid repeating the same point. "
        "Cite supporting evidence. "
        + _LANG_DIRECTIVE
    ),
    "chat_partial_response": (
        "You are an ICU clinical assistant. "
        "When key patient data is missing or stale, provide a best-effort partial response. "
        "Use only the provided patient/context data and never fabricate values. "
        "Output in three short sections: "
        "(1) 目前可確認 "
        "(2) 目前無法確認 "
        "(3) 建議補充資料。 "
        "Avoid definitive treatment recommendations in this mode. "
        + _LANG_DIRECTIVE
    ),
    "clinical_polish": (
        "You are a medical documentation specialist for ICU care. "
        "Polish the given draft into professional clinical documentation. "
        "Use the patient's actual clinical data (labs, vitals, medications, "
        "ventilator settings) when available — never fabricate values. "
        "Format based on polish_type: "
        "progress_note → Full SOAP format "
        "(S: Subjective — patient/family complaints, relevant history; "
        "O: Objective — vitals, labs with values, imaging, physical exam; "
        "A: Assessment — clinical interpretation, problem list; "
        "P: Plan — treatment plan, pending studies, follow-up); "
        "medication_advice → include dosing rationale based on renal/hepatic function; "
        "nursing_record → correct typos, standardize formatting in Chinese; "
        "pharmacy_advice → formal clinical pharmacy recommendation. "
        + _LANG_DIRECTIVE
    ),
    "conversation_compress": (
        "You are a conversation summarizer for an ICU clinical AI assistant. "
        "Given a multi-turn conversation between a clinician and an AI, produce a "
        "concise summary that preserves: (1) all clinical facts discussed, "
        "(2) key decisions or recommendations made, (3) any pending questions. "
        "Keep drug names, dosages, lab values, and patient-specific details intact. "
        "Output a structured summary in 300 words or fewer. "
        + _LANG_DIRECTIVE
    ),
    "contextual_chunk": (
        "你是 ICU 醫學文獻分析助手。"
        "給定一份完整文件和其中一個片段，"
        "請用 1-2 句繁體中文簡要描述該片段在整份文件中的位置與主題。"
        "重點：該片段屬於哪個章節/主題、涵蓋什麼具體內容。"
        "只輸出簡要上下文，不要其他文字。"
    ),
    "citation_summary": (
        "你是 ICU 臨床文獻整理助手。將醫療文獻的原文段落精煉為簡潔的參考引述。\n"
        "輸入包含多個來源文獻及其原文段落。\n"
        "對每個來源，輸出 JSON 物件包含：\n"
        '  "summary": 一句話概述該文獻與查詢相關的核心建議（30字內，繁體中文）\n'
        '  "keyQuote": 原文中最關鍵的一句話（直接引述原文，60字內）\n'
        '  "relevanceNote": 為什麼這段文獻與查詢相關（15字內）\n'
        "輸出格式：一個 JSON array，每個元素對應一個來源。\n"
        "只輸出 JSON，不要其他文字。"
    ),
}


def _normalize_trace_value(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _fingerprint_payload(payload: Any) -> str:
    try:
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    except Exception:
        body = str(payload)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _model_dump_safe(payload: Any) -> Any:
    if payload is None:
        return None
    if hasattr(payload, "model_dump"):
        try:
            return payload.model_dump()
        except Exception:
            pass
    if hasattr(payload, "to_dict"):
        try:
            return payload.to_dict()
        except Exception:
            pass
    try:
        return json.loads(json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:
        return str(payload)


def _capture_dir_path() -> Path:
    raw = str(settings.LLM_AUDIT_CAPTURE_DIR or "").strip()
    default_rel = "reports/operations/llm_raw_capture"
    path = Path(raw or default_rel).expanduser()
    if path.is_absolute():
        return path
    repo_root = Path(__file__).resolve().parents[2]
    return repo_root / path


def _maybe_capture_provider_raw(
    *,
    provider: str,
    task: str,
    model: str,
    request_id: str | None,
    trace_id: str | None,
    input_payload: Any,
    response_payload: Any,
) -> None:
    if not settings.LLM_AUDIT_CAPTURE_RAW:
        return

    try:
        capture_dir = _capture_dir_path()
        capture_dir.mkdir(parents=True, exist_ok=True)
        captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        rid = request_id or "no_request_id"
        tid = trace_id or rid
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"{stamp}_{provider}_{task}_{rid[:20]}.json"
        target = capture_dir / filename
        payload = {
            "captured_at": captured_at,
            "provider": provider,
            "model": model,
            "task": task,
            "request_id": request_id,
            "trace_id": trace_id,
            "input_fingerprint": _fingerprint_payload(input_payload),
            "response_raw": _model_dump_safe(response_payload),
        }
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(
            "[INTG][AI][AUDIT] provider_raw_captured path=%s request_id=%s trace_id=%s task=%s",
            str(target),
            rid,
            tid,
            task,
        )
    except Exception:
        logger.warning("[INTG][AI][AUDIT] provider raw capture failed", exc_info=True)


def call_llm(task: str, input_data: dict[str, Any], **kwargs) -> dict[str, Any]:
    """Call LLM for a specific task. Returns {status, content, metadata}."""
    if task not in TASK_PROMPTS:
        return {"status": "error", "content": f"Unknown task: {task}", "metadata": {}}

    system_prompt = TASK_PROMPTS[task]
    temperature = kwargs.get("temperature", settings.LLM_TEMPERATURE)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))

    # Avoid calling external providers with missing credentials; return a stable error
    # that routers can translate into a proper HTTP error response.
    if settings.LLM_PROVIDER == "openai" and not (settings.OPENAI_API_KEY or "").strip():
        return {"status": "error", "content": "OPENAI_API_KEY is not set", "metadata": {}}
    if settings.LLM_PROVIDER == "anthropic" and not (settings.ANTHROPIC_API_KEY or "").strip():
        return {"status": "error", "content": "ANTHROPIC_API_KEY is not set", "metadata": {}}

    try:
        if settings.LLM_PROVIDER == "openai":
            return _call_openai(
                system_prompt,
                input_data,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        elif settings.LLM_PROVIDER == "anthropic":
            return _call_anthropic(
                system_prompt,
                input_data,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        else:
            return {"status": "error", "content": f"Unsupported provider: {settings.LLM_PROVIDER}", "metadata": {}}
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
    temperature = kwargs.get("temperature", settings.LLM_TEMPERATURE)
    max_tokens = kwargs.get("max_tokens", settings.LLM_MAX_TOKENS)
    request_id = _normalize_trace_value(kwargs.get("request_id"))
    trace_id = _normalize_trace_value(kwargs.get("trace_id"))

    # Avoid calling external providers with missing credentials; return a stable error
    # that routers can translate into a proper HTTP error response.
    if settings.LLM_PROVIDER == "openai" and not (settings.OPENAI_API_KEY or "").strip():
        return {"status": "error", "content": "OPENAI_API_KEY is not set", "metadata": {}}
    if settings.LLM_PROVIDER == "anthropic" and not (settings.ANTHROPIC_API_KEY or "").strip():
        return {"status": "error", "content": "ANTHROPIC_API_KEY is not set", "metadata": {}}

    try:
        if settings.LLM_PROVIDER == "openai":
            return _call_openai_multi(
                system_prompt,
                messages,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        elif settings.LLM_PROVIDER == "anthropic":
            return _call_anthropic_multi(
                system_prompt,
                messages,
                temperature,
                max_tokens,
                task=task,
                request_id=request_id,
                trace_id=trace_id,
            )
        else:
            return {"status": "error", "content": f"Unsupported provider: {settings.LLM_PROVIDER}", "metadata": {}}
    except Exception as e:
        return {"status": "error", "content": str(e), "metadata": {}}


def _call_openai(
    system_prompt,
    input_data,
    temperature,
    max_tokens,
    *,
    task: str,
    request_id: str | None = None,
    trace_id: str | None = None,
):
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=settings.LLM_MODEL, max_completion_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(input_data, ensure_ascii=False, default=str)},
        ],
    )
    _maybe_capture_provider_raw(
        provider="openai",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=input_data,
        response_payload=response,
    )
    content = response.choices[0].message.content or ""
    if not content.strip():
        return {"status": "error", "content": "Model returned empty response (reasoning token budget may be too low)", "metadata": {}}
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        }},
    }


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
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    api_messages = [{"role": "system", "content": system_prompt}]
    api_messages.extend(messages)
    response = client.chat.completions.create(
        model=settings.LLM_MODEL, max_completion_tokens=max_tokens,
        messages=api_messages,
    )
    _maybe_capture_provider_raw(
        provider="openai",
        task=task,
        model=settings.LLM_MODEL,
        request_id=request_id,
        trace_id=trace_id,
        input_payload=messages,
        response_payload=response,
    )
    content = response.choices[0].message.content or ""
    if not content.strip():
        return {"status": "error", "content": "Model returned empty response (reasoning token budget may be too low)", "metadata": {}}
    return {
        "status": "success",
        "content": content,
        "metadata": {"model": settings.LLM_MODEL, "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        }},
    }


def rerank_passages(
    query: str,
    passages: List[dict],
    top_k: int = 5,
) -> List[dict]:
    """Rerank retrieved passages using LLM relevance scoring.

    Over-retrieved candidates are scored by GPT-5-mini for query relevance,
    then sorted by score. Raises on failure — no silent fallback.
    """
    if not passages or len(passages) <= top_k:
        return passages[:top_k]

    if not (settings.OPENAI_API_KEY or "").strip():
        raise RuntimeError("[RAG][RERANK] OPENAI_API_KEY is not set — cannot rerank")

    # Build scoring prompt — truncate each passage to save tokens
    numbered = []
    for i, p in enumerate(passages):
        excerpt = p.get("text", "")[:300]
        numbered.append(f"[{i + 1}] {excerpt}")
    passages_text = "\n".join(numbered)

    scoring_prompt = (
        "You are a medical relevance scorer for ICU clinical queries.\n"
        "Score each passage's relevance to the query on a scale of 0-10.\n"
        "10 = perfectly relevant, 0 = completely irrelevant.\n\n"
        f"Query: {query}\n\n"
        f"Passages:\n{passages_text}\n\n"
        "Return ONLY a JSON array of integer scores, one per passage. "
        f"Example for {len(passages)} passages: [8, 3, 7, ...]\n"
        "Do not include any other text."
    )

    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=settings.RAG_RERANK_MODEL,
        max_completion_tokens=4096,  # reasoning models need ~2-3x headroom for thinking tokens
        messages=[
            {"role": "system", "content": "You are a relevance scoring assistant. Return only valid JSON."},
            {"role": "user", "content": scoring_prompt},
        ],
    )
    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        raise ValueError("[RAG][RERANK] Model returned empty response — token budget may be too low")

    # Parse JSON array of scores
    scores = json.loads(raw)
    if not isinstance(scores, list) or len(scores) != len(passages):
        raise ValueError(
            f"[RAG][RERANK] Score count mismatch: got {len(scores) if isinstance(scores, list) else 0}, "
            f"expected {len(passages)}"
        )

    # Attach rerank scores and sort
    scored = []
    for p, s in zip(passages, scores):
        entry = dict(p)
        entry["rerank_score"] = float(s) if isinstance(s, (int, float)) else 0.0
        scored.append(entry)
    scored.sort(key=lambda x: x["rerank_score"], reverse=True)

    logger.info(
        "[RAG][RERANK] Reranked %d candidates → top-%d (model=%s)",
        len(passages),
        top_k,
        settings.RAG_RERANK_MODEL,
    )
    return scored[:top_k]


def summarize_citations(
    question: str,
    citations: List[dict],
) -> List[dict]:
    """Summarize raw citation snippets into structured summaries using LLM.

    Each citation gets: summary (core recommendation), keyQuote (direct quote),
    relevanceNote (why it's relevant). Raises on failure — no silent fallback.
    """
    if not citations:
        return citations

    if not (settings.OPENAI_API_KEY or "").strip():
        raise RuntimeError("[RAG][CITATION] OPENAI_API_KEY is not set — cannot summarize citations")

    # Build batch prompt with all citations
    sources_text = []
    for i, c in enumerate(citations):
        source_file = c.get("sourceFile", "unknown")
        pages = c.get("pages", [])
        page_str = f"第 {', '.join(str(p) for p in pages)} 頁" if pages else "頁碼不明"
        # Collect all snippets for this citation
        all_snippets = c.get("snippets", [])
        if not all_snippets and c.get("snippet"):
            all_snippets = [c["snippet"]]
        snippet_text = "\n".join(all_snippets[:3])  # max 3 snippets per source
        sources_text.append(
            f"[來源 {i + 1}] {source_file} ({page_str})\n{snippet_text}"
        )

    prompt = (
        f"查詢：{question}\n\n"
        + "\n\n---\n\n".join(sources_text)
    )

    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=settings.RAG_RERANK_MODEL,  # gpt-5-mini — fast and cheap
        max_completion_tokens=4096,  # reasoning models need ~2-3x headroom for thinking tokens
        messages=[
            {"role": "system", "content": TASK_PROMPTS["citation_summary"]},
            {"role": "user", "content": prompt},
        ],
    )
    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        raise ValueError("[RAG][CITATION] Model returned empty response — token budget may be too low")

    summaries = json.loads(raw)
    if not isinstance(summaries, list):
        raise ValueError(f"[RAG][CITATION] Expected JSON array, got {type(summaries).__name__}")

    # Attach summaries to citations
    result = []
    for i, c in enumerate(citations):
        entry = dict(c)
        if i < len(summaries) and isinstance(summaries[i], dict):
            entry["summary"] = str(summaries[i].get("summary", ""))
            entry["keyQuote"] = str(summaries[i].get("keyQuote", ""))
            entry["relevanceNote"] = str(summaries[i].get("relevanceNote", ""))
        result.append(entry)

    logger.info(
        "[RAG][CITATION] Summarized %d citations (model=%s)",
        len(citations),
        settings.RAG_RERANK_MODEL,
    )
    return result


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts using OpenAI API. Raises if API key is missing or call fails."""
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required for embedding. No fallback available.")
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    batch_size = 100
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = client.embeddings.create(
            model=settings.OPENAI_EMBEDDING_MODEL, input=batch, dimensions=1536,
        )
        all_embeddings.extend([item.embedding for item in response.data])
    return all_embeddings


def generate_chunk_context(doc_text: str, chunk_text: str) -> str:
    """Generate a short contextual prefix for a chunk using LLM.

    Used by Contextual Retrieval to situate each chunk within its source
    document before embedding, improving retrieval accuracy by ~67%.

    Args:
        doc_text: Full (or truncated) source document text.
        chunk_text: The specific chunk to contextualize.

    Returns:
        A 1-2 sentence context string in Traditional Chinese.
    """
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required for contextual retrieval.")
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    system_prompt = TASK_PROMPTS["contextual_chunk"]
    max_doc = getattr(settings, "RAG_CONTEXTUAL_MAX_DOC_CHARS", 8000)
    truncated_doc = doc_text[:max_doc]
    if len(doc_text) > max_doc:
        truncated_doc += "\n...(文件已截斷)..."

    user_msg = (
        f"<document>\n{truncated_doc}\n</document>\n\n"
        f"<chunk>\n{chunk_text}\n</chunk>"
    )

    model = getattr(settings, "RAG_CONTEXTUAL_MODEL", "gpt-5")
    response = client.chat.completions.create(
        model=model,
        max_completion_tokens=2048,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
    )
    return response.choices[0].message.content.strip()


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
    from anthropic import Anthropic
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
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
    from anthropic import Anthropic
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
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
