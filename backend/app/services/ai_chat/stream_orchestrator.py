"""SSE stream orchestrator for /ai/chat/stream(B3 下沉,2026-07-20)。

從 app.routers.ai_chat 原樣搬入:LLM 串流→delta frame→done payload 組裝
(B14 切分、F02 citations、F04 guardrail、F19 graphMeta)→持久化→
post-stream 觀測(citation audit / hedging)。router 只負責請求解析、
session/ACL/prefetch,再把本 generator 交給 StreamingResponse。

Request 物件在此僅作資料依賴(is_disconnected / request.state 追蹤 id),
不承載路由職責。
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, List, Optional

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import call_llm_stream
from app.models.ai_session import AIMessage
from app.models.user import User
from app.services.ai_chat.observability import log_hedging_signal, run_citation_audit
from app.services.ai_chat.sse import (
    _web_annotations_to_citations,
    _with_heartbeat,
    split_main_and_detail,
)
from app.services.citation_audit import extract_citations
from app.services.safety_guardrail import apply_safety_guardrail
from app.utils.sse import done_frame, format_sse

logger = logging.getLogger("chaticu")


# ── F02/F19 done-payload helpers ──────────────────────────────────────────────

def _snapshot_source_citations(full_reply: str) -> list:
    """F02:把回覆內的快照段落引用(【用藥】(依【用藥】)等)轉成前端
    Citation 形狀,type='patient-data'。與 web citation 併列於「參考來源」。"""
    out = []
    for i, c in enumerate(extract_citations(full_reply or "")):
        section = (c.get("section") or "").strip()
        if not section:
            continue
        snippet = (c.get("content") or "").strip()[:160]
        out.append({
            "id": f"snap-{i}",
            "type": "patient-data",
            "title": f"【{section}】",
            "source": "病人資料快照",
            "relevance": 1.0,
            "snippet": snippet or None,
        })
    return out


def _graph_meta_from_prefetch(prefetch_meta: Optional[dict]) -> Optional[dict]:
    """F19:B09 prefetch 已算好的 interaction findings → GraphMeta。
    無資料回 None(前端不渲染 badge 區)。"""
    refs = (prefetch_meta or {}).get("interactionRefs") or []
    if not refs:
        return None
    return {
        "interactions": refs,
        "has_risk_x": any((r.get("risk") or "").upper() == "X" for r in refs),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────


async def stream_chat_events(
    user_message: str,
    system_prompt: str,
    history: List[dict],
    session_id: str,
    db: AsyncSession,
    request: Request,
    timings: Optional[dict] = None,
    prefetch_meta: Optional[dict] = None,
    prefetch_fired: bool = False,
    had_patient_context: bool = False,
    current_user: Optional[User] = None,
    patient_id: Optional[str] = None,
    active_med_aliases: Optional[List[str]] = None,
    original_message: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Generate SSE events from the LLM stream and persist the reply.

    The user message is already persisted by chat_stream() before this
    generator runs (W1-T3), so client disconnects mid-stream do not lose
    the user's question. Only the assistant reply is written here, and only
    when generation completes successfully.

    SSE protocol (matches frontend parseSseFrame expectations):
      event: delta  → {"chunk": "text"}         (streaming tokens)
      event: done   → {"message": "...", "sessionId": "..."}  (final)
      event: error  → {"message": "error text"}  (on failure)
    """
    messages = list(history)
    messages.append({"role": "user", "content": user_message})

    request_id = getattr(request.state, "request_id", None)
    trace_id = getattr(request.state, "trace_id", None)

    full_reply = ""
    token_count = 0
    prompt_tokens = 0
    cached_tokens = 0
    first_token_logged = False
    t_pre_llm = time.perf_counter()
    web_annotations: list[dict] = []

    try:
        llm_stream = call_llm_stream(
            "icu_chat",
            messages,
            system_prompt_override=system_prompt,
            request_id=request_id,
            trace_id=trace_id,
            # AI-OPT #2:chat 的可快取前綴 = system_prompt + 歷史,per-session 穩定
            cache_key=f"icu_chat:{session_id}",
        )
        async for kind, chunk in _with_heartbeat(llm_stream):
            if kind == "heartbeat":
                # SSE comment frame — keeps proxy connections warm during
                # LLM thinking pauses; frontend ignores it.
                yield ": heartbeat\n\n"
                continue
            if chunk.startswith("{") and "__done__" in chunk:
                try:
                    meta = json.loads(chunk)
                    usage = meta.get("usage", {}) or {}
                    token_count = (
                        usage.get("completion_tokens")
                        or usage.get("output_tokens")
                        or 0
                    )
                    prompt_tokens = usage.get("prompt_tokens") or 0
                    cached_tokens = usage.get("cached_tokens") or 0
                    web_annotations = meta.get("annotations") or []
                except Exception:
                    pass
                break
            elif chunk.startswith("[ERROR]"):
                error_msg = chunk[7:].strip() if len(chunk) > 7 else "AI service error"
                yield format_sse({"message": error_msg}, event="error")
                return
            else:
                if not first_token_logged:
                    first_token_logged = True
                    t_first = time.perf_counter()
                    if timings:
                        t0 = timings.get("t0", t_pre_llm)
                        t_session = timings.get("t_session", t_pre_llm)
                        t_snapshot = timings.get("t_snapshot", t_pre_llm)
                        logger.info(
                            "[CHAT][TIMING] session=%.0fms snapshot=%.0fms pre_llm=%.0fms ttft=%.0fms total=%.0fms sys_prompt_chars=%d",
                            (t_session - t0) * 1000,
                            (t_snapshot - t_session) * 1000,
                            (t_pre_llm - t_snapshot) * 1000,
                            (t_first - t_pre_llm) * 1000,
                            (t_first - t0) * 1000,
                            len(system_prompt),
                        )
                    else:
                        logger.info(
                            "[CHAT][TIMING] ttft=%.0fms sys_prompt_chars=%d",
                            (t_first - t_pre_llm) * 1000,
                            len(system_prompt),
                        )
                full_reply += chunk
                yield format_sse({"chunk": chunk}, event="delta")

    except Exception as e:
        logger.error("[AI_CHAT] Stream error: %s", str(e)[:500])
        yield format_sse({"message": str(e)}, event="error")
        return

    if prompt_tokens:
        cache_ratio = (cached_tokens / prompt_tokens * 100) if prompt_tokens else 0
        logger.info(
            "[CHAT][CACHE] prompt_tokens=%d cached_tokens=%d hit_ratio=%.0f%% completion_tokens=%d",
            prompt_tokens,
            cached_tokens,
            cache_ratio,
            token_count,
        )
        # O-1: alert on regression. Skip first turn (cache always 0% on first
        # request of a session — no prior identical prefix exists). On any
        # subsequent turn we expect hit_ratio ≥50% under normal operation; a
        # value below that with a non-trivial prompt usually means the
        # byte-stable system_prompt boundary was broken (see the
        # _merged_snapshot incident referenced in prompt_assembly where canary
        # dropped 70% → 0%). Threshold is conservative — adjust if it's noisy.
        if prompt_tokens >= 500 and cached_tokens > 0 and cache_ratio < 50:
            logger.warning(
                "[CHAT][CACHE][LOW_HIT] hit_ratio=%.0f%% prompt_tokens=%d cached_tokens=%d "
                "session=%s — possible byte-stable prefix regression, check recent llm.py / "
                "ai_chat.py edits to system_prompt assembly",
                cache_ratio, prompt_tokens, cached_tokens, session_id,
            )

    # F04:post-stream guardrail(純 regex,便宜)。內容已原樣串流給前端,
    # 這裡只取旗標/警語,不回寫 content。
    guardrail = apply_safety_guardrail(
        full_reply,
        user_role=getattr(current_user, "role", None),
        include_disclaimer=False,
    )

    # F02:來源歸因 = web-search 引註 + 回覆中的快照段落引用(【用藥】等)。
    citations = _web_annotations_to_citations(web_annotations, full_reply)
    citations.extend(_snapshot_source_citations(full_reply))

    # Persist assistant reply only (user message was already committed by
    # chat_stream before the generator started, see W1-T3).
    assistant_msg_id = f"msg_{uuid.uuid4().hex[:16]}"
    if full_reply:
        db.add(AIMessage(
            id=assistant_msg_id,
            session_id=session_id,
            role="assistant",
            content=full_reply,
            citations=citations or None,
            token_count=token_count or None,
        ))
        try:
            await db.commit()
        except Exception as e:
            logger.warning("[AI_CHAT] Failed to persist assistant reply: %s", str(e))
            await db.rollback()

    # Sycophancy step — post-stream citation audit (read-only, never blocks).
    await run_citation_audit(
        db,
        request,
        full_reply=full_reply,
        current_user=current_user,
        active_med_aliases=active_med_aliases or [],
        session_id=session_id,
        patient_id=patient_id,
    )

    # M1: F4 trigger signal — hedged reply + patient context + no prefetch.
    log_hedging_signal(
        full_reply,
        had_patient_context=had_patient_context,
        prefetch_fired=prefetch_fired,
        session_id=session_id,
        user_question=original_message,
    )

    # Send done event — frontend expects ChatResponse shape:
    # { message: ChatMessage, sessionId: string, prefetchRefs?: {...} }
    # F3: prefetchRefs surfaces deep-link metadata (currently advice records)
    # so the chat UI can render clickable chips below the assistant bubble.
    # Live-only — not persisted to ai_messages, so the chips disappear on
    # page reload. Persistence is a future enhancement (would need either
    # a new JSONB column or co-opting suggested_actions).
    now_iso = datetime.now(timezone.utc).isoformat()
    # B14: split at 【說明/補充】 so the frontend detail panel gets a real
    # `explanation`. The persisted AIMessage keeps the FULL text — session
    # reload re-splits client-side (splitMainAndDetail in src/lib/api/ai.ts),
    # and LLM history continuity needs the unsplit blob anyway.
    main_content, detail = split_main_and_detail(full_reply)
    done_payload = {
        "message": {
            "id": assistant_msg_id,
            "role": "assistant",
            "content": main_content,
            "timestamp": now_iso,
            "explanation": detail,
            "citations": citations,
            "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
            "requiresExpertReview": bool(guardrail["requiresExpertReview"]),
            "degraded": False,
            "degradedReason": None,
            "upstreamStatus": None,
            "dataFreshness": None,
            # F19:B09 prefetch 的 findings 餵 DrugInteractionBadges(live-only)
            "graphMeta": _graph_meta_from_prefetch(prefetch_meta),
        },
        "sessionId": session_id,
        "prefetchRefs": prefetch_meta or {},
    }
    yield done_frame(done_payload)


# ── Endpoint ──────────────────────────────────────────────────────────────────
