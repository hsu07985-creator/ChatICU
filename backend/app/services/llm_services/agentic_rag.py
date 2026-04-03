"""Agentic RAG — LLM-driven multi-round retrieval for ICU clinical queries.

Instead of a fixed single-shot retrieve → generate pipeline, the LLM
decides whether to rewrite the query, search again, or answer directly.
This improves retrieval quality for complex multi-faceted questions.

Feature-flagged via ``settings.RAG_AGENTIC_ENABLED``.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings

logger = logging.getLogger("chaticu")

# ── Tool definitions for the agentic loop ─────────────────────────────

AGENTIC_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_evidence",
            "description": "Search ICU clinical guidelines and medical literature. Use different queries to cover multiple aspects of the question.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query — be specific and use medical terminology",
                    },
                    "focus": {
                        "type": "string",
                        "enum": ["dosing", "interaction", "guideline", "general"],
                        "description": "Focus area to optimize retrieval",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ready_to_answer",
            "description": "Signal that you have gathered sufficient evidence to answer the question",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of why evidence is sufficient",
                    },
                },
                "required": ["reason"],
            },
        },
    },
]

ROUTER_SYSTEM_PROMPT = (
    "You are an ICU clinical search strategist. Your job is to decide the best "
    "search strategy for answering a clinical question.\n\n"
    "Strategy:\n"
    "1. Analyze the question to identify what evidence is needed\n"
    "2. Use search_evidence() with specific medical queries\n"
    "3. If the first search doesn't cover all aspects, search again with a different query\n"
    "4. When you have enough evidence, call ready_to_answer()\n\n"
    "Guidelines:\n"
    "- Rewrite vague questions into specific medical queries\n"
    "- For drug questions, search both the generic name and mechanism\n"
    "- For dosing questions, include patient population (ICU, renal impairment, etc.)\n"
    "- Maximum 3 search rounds — don't over-search simple questions\n"
    "- For simple factual questions, 1 search is often enough\n"
)


async def agentic_retrieve(
    question: str,
    retrieve_fn,
    *,
    max_rounds: Optional[int] = None,
    trace_kwargs: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Run multi-round agentic retrieval.

    Args:
        question: The user's clinical question.
        retrieve_fn: Async callable(query, top_k) -> (rag_context, citations).
            This wraps the existing evidence_client + fallback logic.
        max_rounds: Override for RAG_AGENTIC_MAX_ROUNDS.
        trace_kwargs: Request tracing metadata.

    Returns:
        (combined_rag_context, deduplicated_citations)
    """
    rounds = max_rounds or settings.RAG_AGENTIC_MAX_ROUNDS
    all_contexts: List[str] = []
    all_citations: List[Dict[str, Any]] = []
    seen_chunk_ids: set = set()

    # Build initial message
    messages = [
        {"role": "user", "content": f"Clinical question: {question}"},
    ]

    for round_num in range(rounds):
        # Ask LLM what to search
        tool_call = await _get_tool_decision(messages)

        if tool_call is None or tool_call["name"] == "ready_to_answer":
            logger.info(
                "[AGENTIC_RAG] Round %d/%d: ready_to_answer (reason=%s)",
                round_num + 1, rounds,
                tool_call.get("args", {}).get("reason", "N/A") if tool_call else "no_tool_call",
            )
            break

        if tool_call["name"] == "search_evidence":
            search_query = tool_call["args"].get("query", question)
            focus = tool_call["args"].get("focus", "general")
            logger.info(
                "[AGENTIC_RAG] Round %d/%d: search_evidence(query='%s', focus='%s')",
                round_num + 1, rounds, search_query[:80], focus,
            )

            # Execute retrieval
            try:
                context, citations = await retrieve_fn(search_query, top_k=5)
            except Exception as exc:
                logger.warning("[AGENTIC_RAG] Retrieval failed in round %d: %s", round_num + 1, exc)
                context, citations = "", []

            # Deduplicate citations by chunk_id
            new_citations = []
            for c in citations:
                chunk_id = c.get("chunkId") or c.get("id", "")
                if chunk_id not in seen_chunk_ids:
                    seen_chunk_ids.add(chunk_id)
                    new_citations.append(c)

            if context:
                all_contexts.append(f"[Search {round_num + 1}: {search_query}]\n{context}")
            all_citations.extend(new_citations)

            # Feed results back to LLM for next decision
            result_summary = f"Found {len(new_citations)} new citations. "
            if new_citations:
                result_summary += "Topics: " + ", ".join(
                    c.get("title", "")[:30] for c in new_citations[:3]
                )
            messages.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": f"call_{round_num}",
                    "type": "function",
                    "function": {"name": "search_evidence", "arguments": json.dumps(tool_call["args"])},
                }],
            })
            messages.append({
                "role": "tool",
                "tool_call_id": f"call_{round_num}",
                "content": result_summary,
            })

    combined_context = "\n\n---\n\n".join(all_contexts) if all_contexts else ""
    logger.info(
        "[AGENTIC_RAG] Complete: %d rounds, %d total citations, context_len=%d",
        min(round_num + 1, rounds) if 'round_num' in dir() else 0,
        len(all_citations),
        len(combined_context),
    )
    return combined_context, all_citations


async def _get_tool_decision(messages: List[dict]) -> Optional[Dict[str, Any]]:
    """Ask the router LLM which tool to call next."""
    from openai import AsyncOpenAI

    if not (settings.OPENAI_API_KEY or "").strip():
        return None

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    try:
        response = await client.chat.completions.create(
            model=settings.RAG_AGENTIC_MODEL,
            messages=[{"role": "system", "content": ROUTER_SYSTEM_PROMPT}] + messages,
            tools=AGENTIC_TOOLS,
            tool_choice="auto",
            max_completion_tokens=1024,
        )
    except Exception as exc:
        logger.warning("[AGENTIC_RAG] Router LLM call failed: %s", exc)
        return None

    choice = response.choices[0]
    if choice.message.tool_calls:
        tc = choice.message.tool_calls[0]
        try:
            args = json.loads(tc.function.arguments)
        except json.JSONDecodeError:
            args = {}
        return {"name": tc.function.name, "args": args}

    # No tool call — treat as ready to answer
    return {"name": "ready_to_answer", "args": {"reason": "LLM chose to answer directly"}}
