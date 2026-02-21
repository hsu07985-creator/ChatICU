"""AI Chat endpoints — database-backed, LLM-powered (Phase 3).

P2-1: Supports multi-turn conversation history with automatic compression.
- Recent messages (last RECENT_MSG_WINDOW) are sent verbatim to LLM.
- Older messages are periodically compressed into a summary stored on AISession.
- Compression is incremental: new messages merge with existing summary.
"""

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.config import settings
from app.llm import (
    COMPRESS_THRESHOLD,
    RECENT_MSG_WINDOW,
    call_llm,
    call_llm_multi_turn,
    summarize_citations,
)
from app.middleware.auth import get_current_user
from app.middleware.audit import create_audit_log
from app.routers.clinical import _get_patient_dict
from app.models.ai_session import AIMessage, AISession
from app.models.user import User
from app.schemas.clinical import AIChatRequest
from app.services.evidence_client import evidence_client
from app.services.llm_services.rag_service import RAG_DOCS_PATH, rag_service
from app.services.safety_guardrail import apply_safety_guardrail
from app.utils.data_freshness import build_data_freshness
from app.utils.evidence_gate import evaluate_evidence_gate
from app.utils.llm_errors import llm_unavailable_detail
from app.utils.request_context import evidence_trace_kwargs
from app.middleware.rate_limit import limiter
from app.utils.response import success_response
from pydantic import BaseModel, Field

logger = logging.getLogger("chaticu")

router = APIRouter(prefix="/ai", tags=["AI"])


_CHAT_INTENT_RECOMMENDATION_KEYWORDS = (
    "recommendation",
    "suggestion",
    "should we",
    "should i",
    "dose",
    "dosing",
    "adjust",
    "建議",
    "應該",
    "該不該",
    "劑量",
    "調整",
)

_CHAT_INTENT_MEDICATION_KEYWORDS = (
    "medication",
    "medications",
    "drug",
    "drugs",
    "用藥",
    "藥物",
    "藥單",
)

_CHAT_INTENT_STABILITY_KEYWORDS = (
    "stable",
    "unstable",
    "vital",
    "vitals",
    "血壓",
    "心跳",
    "呼吸",
    "spo2",
    "生命徵象",
    "還好嗎",
    "穩定",
)

_LOCAL_RAG_INDEX_ATTEMPTED = False


def _classify_chat_intent(message: str) -> str:
    text = (message or "").strip().lower()
    if any(keyword in text for keyword in _CHAT_INTENT_RECOMMENDATION_KEYWORDS):
        return "recommendation"
    if any(keyword in text for keyword in _CHAT_INTENT_MEDICATION_KEYWORDS):
        return "medication_fact"
    if any(keyword in text for keyword in _CHAT_INTENT_STABILITY_KEYWORDS):
        return "patient_stability"
    return "general_qa"


def _evidence_gate_overrides(intent: str) -> Dict[str, Any]:
    # High-risk recommendation questions keep strict AO-03 thresholds.
    if intent == "recommendation":
        return {}
    # For fact lookup / status clarification, do not hard-block on citations/confidence.
    return {"min_citations": 0, "min_confidence": 0.0}


def _ensure_local_rag_index() -> bool:
    """Best-effort lazy index for local RAG fallback when hybrid RAG is unavailable."""
    global _LOCAL_RAG_INDEX_ATTEMPTED

    if rag_service.is_indexed:
        return True
    if _LOCAL_RAG_INDEX_ATTEMPTED:
        return rag_service.is_indexed
    _LOCAL_RAG_INDEX_ATTEMPTED = True

    candidates: List[str] = []
    configured = str(settings.RAG_DOCS_PATH or "").strip()
    if configured:
        candidates.append(configured)
    fallback = str(RAG_DOCS_PATH or "").strip()
    if fallback and fallback not in candidates:
        candidates.append(fallback)

    for docs_path in candidates:
        try:
            resolved = Path(docs_path).expanduser()
            if not resolved.exists():
                continue
            chunks = rag_service.load_and_chunk(str(resolved))
            result = rag_service.index(chunks)
            total_chunks = int(result.get("total_chunks") or 0)
            if total_chunks > 0:
                logger.info(
                    "[INTG][AI][API] Local RAG lazy-index ready: %d chunks (%s)",
                    total_chunks,
                    str(resolved),
                )
                return True
        except Exception:
            logger.warning(
                "[INTG][AI][API] Local RAG lazy-index failed for path=%s",
                docs_path,
                exc_info=True,
            )

    return rag_service.is_indexed


def _stability_data_gap_reason(data_freshness: Optional[dict]) -> Optional[str]:
    if not isinstance(data_freshness, dict):
        return "缺少病患資料，無法判斷病況穩定性。"

    sections = data_freshness.get("sections")
    if not isinstance(sections, dict):
        return "缺少病患資料，無法判斷病況穩定性。"

    vital_section = sections.get("vital_signs")
    if not isinstance(vital_section, dict):
        return "缺少 vital_signs，無法判斷病況穩定性。"

    status = str(vital_section.get("status") or "unknown").lower()
    if status in {"missing", "unknown"}:
        return "缺少 vital_signs，無法判斷病況穩定性。"
    if status == "stale":
        ts = vital_section.get("timestamp")
        if ts:
            return f"vital_signs 較舊（最後更新：{ts}），無法可靠判斷病況穩定性。"
        return "vital_signs 較舊，無法可靠判斷病況穩定性。"
    return None


def _iso_z(dt: Optional[datetime]) -> Optional[str]:
    """Return an RFC3339/ISO timestamp suitable for JS Date parsing.

    NOTE: datetime.isoformat() for tz-aware values already includes an offset
    (e.g. +00:00). Appending 'Z' would produce an invalid string like
    '+00:00Z', which breaks the frontend session list parsing.
    """
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt_utc = dt.astimezone(timezone.utc)
    return dt_utc.isoformat().replace("+00:00", "Z")


def _sse_event(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


def _chunk_text_for_stream(text: str, chunk_size: int = 24) -> List[str]:
    if not text:
        return []
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]


_MAIN_SECTION_MARKERS = ("【主回答】", "主回答：", "主回答:")
_DETAIL_SECTION_MARKERS = ("【說明/補充】", "【說明】", "說明/補充：", "說明：", "補充：")
_MCQ_KEYWORDS = ("下列何者", "最適當", "最可能", "何者", "哪一項", "選項")


def _strip_markers(text: str, markers: Tuple[str, ...]) -> str:
    cleaned = text
    for marker in markers:
        cleaned = cleaned.replace(marker, "")
    return cleaned.strip()


def _split_first_sentence(text: str) -> Tuple[str, str]:
    normalized = str(text or "").strip()
    if not normalized:
        return "", ""

    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    if len(lines) > 1 and len(lines[0]) <= 120:
        return lines[0], "\n".join(lines[1:]).strip()

    sentence_match = re.search(r"[。！？!?]", normalized)
    if sentence_match:
        boundary = sentence_match.end()
        # Keep the first full clinical sentence for multiple-choice style like "C。..."
        # instead of truncating to only the option letter.
        if re.match(r"^[A-Da-d][。.]", normalized) and boundary <= 2:
            next_match = re.search(r"[。！？!?]", normalized[boundary:])
            if next_match:
                boundary += next_match.end()
        return normalized[:boundary].strip(), normalized[boundary:].strip()

    return normalized, ""


def _shorten_main_answer(text: str, max_chars: int = 180) -> str:
    candidate = str(text or "").strip()
    if not candidate:
        return ""
    first_sentence, _ = _split_first_sentence(candidate)
    compact = first_sentence or candidate
    if len(compact) <= max_chars:
        return compact
    return compact[:max_chars].rstrip("，,、;；:.。！？!? ") + "…"


def _looks_like_multiple_choice(question: str) -> bool:
    text = str(question or "")
    if any(keyword in text for keyword in _MCQ_KEYWORDS):
        return True
    option_hits = len(re.findall(r"(?:^|[\s\n])[A-Da-d][。.．]", text))
    if option_hits >= 2:
        return True
    if all(marker in text for marker in ("A.", "B.", "C.", "D.")):
        return True
    return False


def _normalize_main_answer_prefix(main_answer: str, question: str) -> str:
    """Remove stray option-letter prefix for non-MCQ prompts."""
    answer = str(main_answer or "").strip()
    if not answer:
        return ""
    if _looks_like_multiple_choice(question):
        return answer
    stripped = re.sub(r"^\s*[A-Da-d][。.．]\s*", "", answer).strip()
    return stripped or answer


def _extract_main_and_explanation(text: str) -> tuple[str, Optional[str]]:
    normalized = str(text or "").strip()
    if not normalized:
        return "", None

    main_part = normalized
    detail_part = ""
    for marker in _DETAIL_SECTION_MARKERS:
        if marker in normalized:
            left, right = normalized.split(marker, 1)
            main_part = left
            detail_part = right
            break

    main_part = _strip_markers(main_part, _MAIN_SECTION_MARKERS + _DETAIL_SECTION_MARKERS)
    detail_part = _strip_markers(detail_part, _MAIN_SECTION_MARKERS + _DETAIL_SECTION_MARKERS) if detail_part else ""

    if main_part and detail_part:
        return _shorten_main_answer(main_part), detail_part

    body = _strip_markers(normalized, _MAIN_SECTION_MARKERS + _DETAIL_SECTION_MARKERS)
    fallback_main, fallback_rest = _split_first_sentence(body)
    main_answer = _shorten_main_answer(fallback_main or body)
    explanation = fallback_rest.strip() or None
    return main_answer, explanation


def _citation_title(source_file: Any) -> str:
    source = str(source_file or "").strip()
    if not source:
        return "unknown"
    return source.split("/")[-1] if "/" in source else source


def _normalize_page(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_page_from_text(text: Any) -> Optional[int]:
    content = str(text or "")
    if not content:
        return None
    match = re.search(r"\[Page\s*(\d+)\]", content, re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


_SNIPPET_MAX_CHARS = 1500
_SNIPPET_SENTENCE_ENDS = re.compile(r"[。！？\n]")


def _clean_snippet_text(text: Any) -> str:
    raw = str(text or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    if not raw.strip():
        return ""

    cleaned = re.sub(r"^\s*\[Page\s*\d+\]\s*", "", raw, flags=re.IGNORECASE)
    cleaned = re.sub(r"-\n(?=[A-Za-z])", "", cleaned)
    cleaned = re.sub(r"(?<=[A-Za-z])\n(?=[A-Za-z])", " ", cleaned)
    cleaned = re.sub(r"(?<=[\u4e00-\u9fff])\n(?=[\u4e00-\u9fff])", "", cleaned)
    cleaned = re.sub(r"\n{2,}", "\n", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n[ \t]+", "\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    lines = [line.strip() for line in cleaned.split("\n") if line.strip()]
    for _ in range(2):
        if len(lines) <= 1:
            break
        first = lines[0]
        if re.fullmatch(r"\d+", first):
            lines.pop(0)
            continue
        if (
            not re.search(r"[\u4e00-\u9fff]", first)
            and re.search(r"(resuscitation|intensive care|med\b|\d{4})", first, re.IGNORECASE)
        ):
            lines.pop(0)
            continue
        break
    result = "\n".join(lines).strip()

    # Trim long chunks at sentence boundary to keep display focused
    if len(result) > _SNIPPET_MAX_CHARS:
        window = result[:_SNIPPET_MAX_CHARS]
        # Find the last sentence-ending character in the trimmed window
        best_pos = -1
        for m in _SNIPPET_SENTENCE_ENDS.finditer(window):
            if m.start() > _SNIPPET_MAX_CHARS // 3:
                best_pos = m.end()
        if best_pos > 0:
            return result[:best_pos].rstrip() + "…"
        return window.rstrip() + "…"

    return result


def _score_snippet_quality(snippet: str, page: Optional[int], relevance: float) -> float:
    text = str(snippet or "")
    if not text:
        return -1.0
    score = 0.0
    if page is not None:
        score += 1.5
    if 80 <= len(text) <= 900:
        score += 1.0
    if re.search(r"[。！？.!?]", text):
        score += 0.6
    if re.match(r"^[a-z]\w*", text):
        score -= 0.8
    score += max(0.0, min(1.0, float(relevance or 0.0))) * 0.5
    return score


def _merge_citations_by_source(
    citations: List[Dict[str, Any]],
    *,
    max_sources: int = 4,
) -> List[Dict[str, Any]]:
    """Merge repeated citations from the same source file into one display entry."""
    merged_by_source: Dict[str, Dict[str, Any]] = {}

    for raw in sorted(citations, key=lambda c: float(c.get("relevance", 0) or 0), reverse=True):
        source_file = str(raw.get("sourceFile") or "").strip()
        title = str(raw.get("title") or "").strip()
        key = source_file or title or str(raw.get("id") or "")
        if not key:
            continue

        snippet = _clean_snippet_text(raw.get("snippet"))
        page = _normalize_page(raw.get("page")) or _extract_page_from_text(raw.get("snippet"))

        item = merged_by_source.get(key)
        if item is None:
            item = {
                "id": raw.get("id"),
                "type": raw.get("type", "guideline"),
                "title": title or _citation_title(source_file),
                "source": raw.get("source", ""),
                "sourceFile": source_file,
                "chunkId": raw.get("chunkId"),
                "relevance": float(raw.get("relevance", 0) or 0),
                "_pages": set(),
                "_snippet_candidates": [],
                "_snippet_set": set(),
            }
            merged_by_source[key] = item
        else:
            if float(raw.get("relevance", 0) or 0) > float(item.get("relevance", 0) or 0):
                item["relevance"] = float(raw.get("relevance", 0) or 0)
                item["chunkId"] = raw.get("chunkId") or item.get("chunkId")

        if page is not None:
            item["_pages"].add(page)
        if snippet and snippet not in item["_snippet_set"]:
            item["_snippet_set"].add(snippet)
            item["_snippet_candidates"].append(
                (
                    _score_snippet_quality(snippet, page, float(raw.get("relevance", 0) or 0)),
                    snippet,
                )
            )

    merged: List[Dict[str, Any]] = []
    for item in sorted(merged_by_source.values(), key=lambda c: float(c.get("relevance", 0) or 0), reverse=True)[:max_sources]:
        pages = sorted(int(p) for p in item.pop("_pages", set()))
        snippet_candidates = item.pop("_snippet_candidates", [])
        item.pop("_snippet_set", None)
        item["relevance"] = round(float(item.get("relevance", 0) or 0), 3)
        item["page"] = pages[0] if pages else None
        item["pages"] = pages
        snippets = [s for _, s in sorted(snippet_candidates, key=lambda x: x[0], reverse=True)]
        item["snippet"] = snippets[0] if snippets else ""
        item["snippets"] = snippets  # All individual chunk texts, best-scored first
        item["snippetCount"] = len(snippets)
        merged.append(item)

    return merged


def _build_snippet_fallback_citations(snippets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Build renderable citations when hybrid response has snippets but no citation objects."""
    citations: List[Dict[str, Any]] = []
    for index, snippet in enumerate(snippets):
        if not isinstance(snippet, dict):
            continue
        snippet_text = _clean_snippet_text(snippet.get("text"))
        if not snippet_text:
            continue

        source_file = str(snippet.get("source_file") or "").strip()
        score = snippet.get("score")
        try:
            relevance = round(float(score), 3) if score is not None else 0.0
        except (TypeError, ValueError):
            relevance = 0.0

        citations.append(
            {
                "id": f"fallback_snippet_{index}",
                "type": "guideline",
                "title": _citation_title(source_file),
                "source": str(snippet.get("topic") or ""),
                "sourceFile": source_file,
                "chunkId": str(snippet.get("chunk_id") or "").strip() or None,
                "page": _normalize_page(snippet.get("page")) or _extract_page_from_text(snippet_text),
                "snippet": snippet_text,
                "relevance": relevance,
            }
        )
    return citations


async def _build_hybrid_citations(
    raw_citations: List[Dict[str, Any]],
    request: Request,
) -> List[Dict[str, Any]]:
    trace_kwargs = evidence_trace_kwargs(request)

    async def _build_one(index: int, raw: Dict[str, Any]) -> Dict[str, Any]:
        chunk_id = str(raw.get("chunk_id") or "").strip()
        source_detail: Dict[str, Any] = {}
        if chunk_id:
            try:
                source_detail = await asyncio.to_thread(
                    evidence_client.source_by_chunk_id,
                    chunk_id,
                    **trace_kwargs,
                )
            except Exception:
                logger.info(
                    "[INTG][AI][API] Citation source lookup failed for chunk_id=%s",
                    chunk_id,
                )

        source_file = str(raw.get("source_file") or source_detail.get("source_file") or "").strip()
        snippet = source_detail.get("text") or raw.get("snippet") or ""
        snippet_text = _clean_snippet_text(snippet if isinstance(snippet, str) else str(snippet))

        try:
            relevance = round(float(raw.get("score", 0)), 3)
        except (TypeError, ValueError):
            relevance = 0.0

        return {
            "id": raw.get("citation_id", f"cite_{index}"),
            "type": "guideline",
            "title": _citation_title(source_file),
            "source": str(raw.get("topic") or source_detail.get("topic") or ""),
            "sourceFile": source_file,
            "chunkId": chunk_id or None,
            "page": _normalize_page(raw.get("page") if raw.get("page") is not None else source_detail.get("page"))
            or _extract_page_from_text(snippet_text),
            "snippet": snippet_text,
            "relevance": relevance,
        }

    tasks = [
        _build_one(i, citation)
        for i, citation in enumerate(raw_citations)
        if isinstance(citation, dict)
    ]
    if not tasks:
        return []
    return await asyncio.gather(*tasks)


# ── Helper: build multi-turn messages for LLM ──────────────────────────

def _build_chat_messages(
    session_summary: Optional[str],
    history: List[AIMessage],
    current_question: str,
    rag_context: str,
    patient_context: Optional[dict],
) -> List[dict]:
    """Build a multi-turn messages array for the LLM.

    Structure:
      [summary context pair] + [recent history] + [current user message with RAG/patient]
    """
    messages: List[dict] = []

    # 1. Inject compressed summary as context (if exists)
    if session_summary:
        messages.append({
            "role": "user",
            "content": (
                f"[先前對話摘要]\n{session_summary}\n\n"
                "請基於以上摘要的上下文繼續對話。"
            ),
        })
        messages.append({
            "role": "assistant",
            "content": "好的，我已了解先前對話的內容，將基於此上下文繼續協助您。",
        })

    # 2. Add recent history messages (capped at RECENT_MSG_WINDOW)
    recent = history[-RECENT_MSG_WINDOW:] if len(history) > RECENT_MSG_WINDOW else history
    for msg in recent:
        messages.append({"role": msg.role, "content": msg.content})

    # 3. Build current user message with RAG + patient context
    parts: List[str] = []
    if patient_context:
        parts.append(
            f"[病患資料]\n{json.dumps(patient_context, ensure_ascii=False, default=str)}"
        )
    if rag_context:
        parts.append(f"[參考文獻]\n{rag_context}")
    parts.append(current_question)

    messages.append({"role": "user", "content": "\n\n".join(parts)})
    return messages


# ── Helper: compress older conversation history ────────────────────────

async def _maybe_compress_history(
    session: AISession,
    all_messages: List[AIMessage],
) -> None:
    """Compress older messages into session.summary if threshold exceeded.

    Only compresses messages outside the recent window that haven't been
    compressed yet (tracked by session.summary_up_to). Compression is
    incremental — combines existing summary with new messages.
    """
    total = len(all_messages)
    if total < COMPRESS_THRESHOLD:
        return

    # Messages outside recent window
    to_compress = all_messages[:-RECENT_MSG_WINDOW]
    already_compressed = session.summary_up_to or 0

    # Only compress if there are new messages beyond what's already summarized
    new_messages = to_compress[already_compressed:]
    if not new_messages:
        return

    lines: List[str] = []
    if session.summary:
        lines.append(f"[先前摘要]\n{session.summary}")

    lines.append("[新增對話]")
    for msg in new_messages:
        role_label = "使用者" if msg.role == "user" else "AI助手"
        # Truncate very long messages to keep compression input manageable
        content = msg.content[:500] if len(msg.content) > 500 else msg.content
        lines.append(f"{role_label}: {content}")

    conv_text = "\n".join(lines)

    try:
        result = await asyncio.to_thread(
            call_llm,
            task="conversation_compress",
            input_data={"conversation": conv_text},
        )
        if result.get("status") == "success":
            session.summary = result["content"]
            session.summary_up_to = len(to_compress)
            logger.info(
                "Compressed %d messages for session %s (total: %d)",
                len(new_messages), session.id, total,
            )
    except Exception:
        logger.warning(
            "Failed to compress history for session %s", session.id, exc_info=True,
        )


# ── Main chat endpoint ─────────────────────────────────────────────────

@router.post("/chat")
@limiter.limit("15/minute")
async def ai_chat(
    req: AIChatRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_id = req.sessionId or f"session_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    trace_kwargs = evidence_trace_kwargs(request)
    request_id = trace_kwargs.get("request_id", "unknown")
    trace_id = trace_kwargs.get("trace_id", request_id)

    # Get or create session
    result = await db.execute(select(AISession).where(AISession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        session = AISession(
            id=session_id,
            user_id=user.id,
            patient_id=req.patientId,
            title=req.message[:50],
        )
        db.add(session)
        await db.flush()

    # Query existing conversation history (before adding current message)
    history_result = await db.execute(
        select(AIMessage)
        .where(AIMessage.session_id == session_id)
        .order_by(AIMessage.created_at.asc())
    )
    all_messages = list(history_result.scalars().all())

    # Store user message
    user_msg_id = f"msg_{uuid.uuid4().hex[:8]}"
    user_msg = AIMessage(
        id=user_msg_id,
        session_id=session_id,
        role="user",
        content=req.message,
    )
    db.add(user_msg)

    # AO-06: Always derive offline data freshness/missing-value hints when patient context exists.
    patient_context = None
    data_freshness = None
    if req.patientId:
        try:
            patient_context = await _get_patient_dict(req.patientId, db)
            data_freshness = build_data_freshness(patient_context)
        except HTTPException:
            logger.warning(
                "[INTG][AI][API][AO-06] Patient %s not found for data freshness check",
                req.patientId,
            )

    chat_intent = _classify_chat_intent(req.message)
    logger.info(
        "[INTG][AI][API] /ai/chat request_id=%s trace_id=%s session_id=%s user_id=%s patient_id=%s intent=%s",
        request_id,
        trace_id,
        session_id,
        user.id,
        req.patientId,
        chat_intent,
    )
    stability_gap_reason = (
        _stability_data_gap_reason(data_freshness)
        if chat_intent == "patient_stability"
        else None
    )

    # RAG-augmented LLM response — try hybrid RAG (func/) first, fallback to local RAG
    citations = []
    rag_context = ""
    evidence_confidence = None
    try:
        hybrid_result = await asyncio.to_thread(
            evidence_client.query,
            req.message,
            top_k=5,
            **trace_kwargs,
        )
        evidence_confidence = hybrid_result.get("confidence")
        rag_context = hybrid_result.get("answer", "")
        # Also gather evidence snippets for richer context
        snippets = hybrid_result.get("evidence_snippets", [])
        if snippets:
            snippet_texts = [s.get("text", "") for s in snippets if s.get("text")]
            if snippet_texts:
                rag_context += "\n\n---\n\n" + "\n\n---\n\n".join(snippet_texts[:3])
        citations = await _build_hybrid_citations(
            [c for c in hybrid_result.get("citations", []) if isinstance(c, dict)],
            request,
        )
        if not citations:
            citations = _build_snippet_fallback_citations(
                [s for s in snippets if isinstance(s, dict)]
            )
        logger.info("[INTG][AI][API] Hybrid RAG returned %d citations", len(citations))
    except Exception as exc:
        logger.warning(
            "[INTG][AI][API][F07] Hybrid RAG unavailable for ai_chat, falling back to local RAG: %s",
            exc,
        )
        if _ensure_local_rag_index():
            # Retrieve more candidates then enforce source diversity (max 2 chunks per doc)
            try:
                _raw_sources = rag_service.retrieve(req.message, top_k=8)
            except Exception as local_rag_exc:
                logger.error(
                    "[INTG][AI][API][F07] Local RAG retrieve failed, continuing without citations: %s",
                    local_rag_exc,
                    exc_info=True,
                )
                _raw_sources = []
            _source_counts: Dict[str, int] = {}
            sources = []
            for _s in _raw_sources:
                _doc = str(_s.get("doc_id") or "")
                if _source_counts.get(_doc, 0) < 2:
                    sources.append(_s)
                    _source_counts[_doc] = _source_counts.get(_doc, 0) + 1
                if len(sources) >= 6:
                    break
            rag_context = "\n\n---\n\n".join([s["text"] for s in sources])
            citations = [
                {
                    "id": f"cite_{i}",
                    "type": "guideline",
                    "title": _citation_title(s.get("doc_id")),
                    "source": s.get("category", ""),
                    "sourceFile": s.get("doc_id"),
                    "chunkId": (
                        f"{s.get('doc_id')}#{s.get('chunk_index')}"
                        if s.get("doc_id") is not None and s.get("chunk_index") is not None
                        else None
                    ),
                    "page": _normalize_page(s.get("page")) or _extract_page_from_text(s.get("text")),
                    "snippet": _clean_snippet_text(s.get("text", "")),
                    "relevance": round(s["score"], 3),
                }
                for i, s in enumerate(sources)
            ]

    citations = _merge_citations_by_source(citations)

    evidence_gate = evaluate_evidence_gate(
        citations=citations,
        confidence=evidence_confidence,
        **_evidence_gate_overrides(chat_intent),
    )
    ai_content = ""
    ai_explanation: Optional[str] = None
    llm_result = {}
    if stability_gap_reason:
        llm_status = "partial_due_to_patient_data"
        degraded = True
        degraded_reason = "insufficient_patient_data"
        llm_result = await asyncio.to_thread(
            call_llm,
            task="chat_partial_response",
            input_data={
                "question": req.message,
                "intent": chat_intent,
                "patient": patient_context,
                "data_freshness": data_freshness,
                "missing_reason": stability_gap_reason,
                "evidence_context": rag_context,
            },
            request_id=request_id,
            trace_id=trace_id,
        )

        if llm_result.get("status") == "success":
            raw_content = llm_result.get("content", "")
        else:
            logger.warning(
                "[INTG][AI][API] partial chat generation failed [status=%s], fallback to deterministic partial reply",
                llm_result.get("status"),
            )
            raw_content = (
                f"{stability_gap_reason}\n"
                "目前僅能提供部分資訊，請先補齊最新生命徵象後再評估是否穩定。"
            )

        guardrail_result = apply_safety_guardrail(raw_content, include_disclaimer=False, user_role=user.role)
        ai_content = guardrail_result["content"]
    elif not evidence_gate["passed"]:
        llm_status = "blocked_by_evidence_gate"
        degraded = True
        degraded_reason = "insufficient_evidence"
        logger.warning(
            "[INTG][AI][API][AO-03] Evidence gate blocked chat response citations=%d confidence=%.3f thresholds=%s",
            evidence_gate["citation_count"],
            evidence_gate["confidence"],
            evidence_gate["thresholds"],
        )
        ai_content = "目前可用證據不足，暫不提供具體建議，請補充臨床條件或改問更具體問題。"
        guardrail_result = {
            "content": ai_content,
            "flagged": False,
            "warnings": None,
            "requiresExpertReview": False,
        }
    else:
        # Build multi-turn messages with history + summary + current question
        chat_messages = _build_chat_messages(
            session_summary=session.summary,
            history=all_messages,
            current_question=req.message,
            rag_context=rag_context,
            patient_context=patient_context,
        )

        # Run LLM generation and citation summarization in parallel
        async def _run_citation_summary() -> List[Dict[str, Any]]:
            if not settings.RAG_CITATION_SUMMARY_ENABLED or not citations:
                return citations
            try:
                return await asyncio.to_thread(
                    summarize_citations, req.message, citations,
                )
            except Exception as exc:
                logger.warning("[INTG][AI][API] Citation summary failed, using raw: %s", exc)
                return citations

        llm_task = asyncio.to_thread(
            call_llm_multi_turn,
            task="rag_generation",
            messages=chat_messages,
            request_id=request_id,
            trace_id=trace_id,
        )
        citation_task = _run_citation_summary()
        llm_result, citations = await asyncio.gather(llm_task, citation_task)

        llm_status = llm_result.get("status")
        degraded = llm_status != "success"
        degraded_reason = "llm_unavailable" if degraded else None
        if degraded:
            # Chat is a critical UI flow (T27). When LLM is unavailable, we still return a
            # user-friendly message and persist the conversation so the UI remains usable.
            logger.error(
                "[INTG][AI][API] LLM chat failed [status=%s]: %s",
                llm_status,
                (llm_result.get("content") or "")[:500],
            )
            raw_content = llm_unavailable_detail()
            ai_content = raw_content
            citations = []  # Avoid implying an evidence-based answer when LLM did not run.
            guardrail_result = {
                "content": ai_content,
                "flagged": False,
                "warnings": None,
                "requiresExpertReview": False,
            }
        else:
            raw_content = llm_result.get("content", "Unable to generate response.")
            # Apply medical safety guardrail (T30)
            # Skip inline disclaimer for chat — frontend shows a persistent banner instead
            guardrail_result = apply_safety_guardrail(raw_content, include_disclaimer=False, user_role=user.role)
            parsed_main, parsed_explanation = _extract_main_and_explanation(
                str(guardrail_result["content"]),
            )
            normalized_main = _normalize_main_answer_prefix(parsed_main, req.message)
            ai_content = normalized_main or parsed_main or str(guardrail_result["content"]).strip()
            ai_explanation = parsed_explanation

    ai_msg_id = f"msg_{uuid.uuid4().hex[:8]}"
    guardrail_meta = {
        "guardrail": {
            "warnings": guardrail_result.get("warnings") if guardrail_result.get("flagged") else None,
            "flagged": guardrail_result.get("flagged", False),
            "requiresExpertReview": guardrail_result.get("requiresExpertReview", False),
        },
        "delivery": {
            "degraded": degraded,
            "degradedReason": degraded_reason if degraded else None,
            "upstreamStatus": llm_status,
        },
        "queryPolicy": {
            "intent": chat_intent,
            "stabilityDataGapReason": stability_gap_reason,
        },
        "response": {
            "explanation": ai_explanation,
        },
        "evidenceGate": evidence_gate,
        "dataFreshness": data_freshness,
    }
    ai_msg = AIMessage(
        id=ai_msg_id,
        session_id=session_id,
        role="assistant",
        content=ai_content,
        citations=citations or None,
        suggested_actions=guardrail_meta,
    )
    db.add(ai_msg)

    # Check if conversation history needs compression
    # all_messages + user_msg + ai_msg = total messages in session
    all_messages.append(user_msg)
    all_messages.append(ai_msg)
    await _maybe_compress_history(session, all_messages)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="AI 對話", target=session_id, status="success" if llm_status == "success" else "failed",
        ip=request.client.host if request.client else None,
        details={
            "patient_id": req.patientId,
            "message_length": len(req.message),
            "safety_flagged": guardrail_result["flagged"],
            "llm_status": llm_status,
            "llm_error": (
                evidence_gate["display_reason"]
                if llm_status == "blocked_by_evidence_gate"
                else (llm_result.get("content") or "")[:200] if llm_status != "success" else None
            ),
            "chat_intent": chat_intent,
            "stability_gap_reason": stability_gap_reason,
            "has_explanation": bool(ai_explanation),
            "evidence_gate_passed": evidence_gate["passed"],
            "evidence_citation_count": evidence_gate["citation_count"],
            "evidence_confidence": evidence_gate["confidence"],
            "history_msg_count": len(all_messages),
            "has_summary": session.summary is not None,
        },
    )
    await db.commit()

    return success_response(data={
        "message": {
            "id": ai_msg_id,
            "role": "assistant",
            "content": ai_content,
            "explanation": ai_explanation,
            "timestamp": _iso_z(now),
            "citations": citations,
            "safetyWarnings": guardrail_result["warnings"] if guardrail_result["flagged"] else None,
            "requiresExpertReview": guardrail_result.get("requiresExpertReview", False),
            "degraded": degraded,
            "degradedReason": degraded_reason if degraded else None,
            "upstreamStatus": llm_status,
            "evidenceGate": evidence_gate,
            "dataFreshness": data_freshness,
        },
        "sessionId": session_id,
    })


@router.post("/chat/stream")
@limiter.limit("15/minute")
async def ai_chat_stream(
    req: AIChatRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SSE chat stream endpoint (AO-04).

    The core response generation stays shared with /ai/chat. This endpoint wraps
    the final assistant message into incremental SSE delta chunks so the frontend
    can render stream updates and still receive a final canonical payload.
    """

    async def event_generator():
        try:
            envelope = await ai_chat(req=req, request=request, user=user, db=db)
            payload = envelope.get("data", {}) if isinstance(envelope, dict) else {}
            message = payload.get("message", {}) if isinstance(payload, dict) else {}
            content = str(message.get("content", ""))

            yield _sse_event(
                "start",
                {
                    "sessionId": payload.get("sessionId"),
                    "messageId": message.get("id"),
                },
            )

            for chunk in _chunk_text_for_stream(content):
                yield _sse_event("delta", {"chunk": chunk})
                await asyncio.sleep(0)

            yield _sse_event("done", payload)
        except HTTPException as exc:
            yield _sse_event(
                "error",
                {
                    "message": str(exc.detail),
                    "status": exc.status_code,
                    "recoverable": True,
                },
            )
        except Exception as exc:
            logger.exception("[INTG][AI][API][AO-04] chat stream failed: %s", exc)
            yield _sse_event(
                "error",
                {
                    "message": "AI 串流失敗，請稍後重試。",
                    "status": 500,
                    "recoverable": True,
                },
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions")
async def list_sessions(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    patientId: str = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(AISession).where(AISession.user_id == user.id)
    count_query = select(func.count()).select_from(AISession).where(AISession.user_id == user.id)

    if patientId:
        query = query.where(AISession.patient_id == patientId)
        count_query = count_query.where(AISession.patient_id == patientId)

    total = (await db.execute(count_query)).scalar() or 0
    query = query.order_by(AISession.updated_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    sessions = result.scalars().all()

    session_ids = [s.id for s in sessions]
    msg_counts: Dict[str, int] = {}
    if session_ids:
        counts_result = await db.execute(
            select(AIMessage.session_id, func.count(AIMessage.id))
            .where(AIMessage.session_id.in_(session_ids))
            .group_by(AIMessage.session_id)
        )
        msg_counts = {sid: int(cnt) for sid, cnt in counts_result.all()}

    return success_response(data={
        "sessions": [
            {
                "id": s.id,
                "userId": s.user_id,
                "patientId": s.patient_id,
                "title": s.title,
                "createdAt": _iso_z(s.created_at),
                "updatedAt": _iso_z(s.updated_at),
                "messageCount": msg_counts.get(s.id, 0),
            }
            for s in sessions
        ],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit,
        },
    })


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AISession)
        .options(selectinload(AISession.messages))
        .where(AISession.id == session_id, AISession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return success_response(data={
        "session": {
            "id": session.id,
            "userId": session.user_id,
            "patientId": session.patient_id,
            "title": session.title,
            "createdAt": _iso_z(session.created_at),
            "updatedAt": _iso_z(session.updated_at),
        },
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "timestamp": _iso_z(m.created_at),
                "citations": m.citations,
                "suggestedActions": m.suggested_actions,
                "safetyWarnings": (
                    (m.suggested_actions or {}).get("guardrail", {}).get("warnings")
                    if isinstance(m.suggested_actions, dict)
                    else None
                ),
                "requiresExpertReview": bool(
                    (m.suggested_actions or {}).get("guardrail", {}).get("requiresExpertReview")
                ) if isinstance(m.suggested_actions, dict) else False,
                "degraded": bool(
                    (m.suggested_actions or {}).get("delivery", {}).get("degraded")
                ) if isinstance(m.suggested_actions, dict) else False,
                "degradedReason": (
                    (m.suggested_actions or {}).get("delivery", {}).get("degradedReason")
                ) if isinstance(m.suggested_actions, dict) else None,
                "upstreamStatus": (
                    (m.suggested_actions or {}).get("delivery", {}).get("upstreamStatus")
                ) if isinstance(m.suggested_actions, dict) else None,
                "explanation": (
                    (m.suggested_actions or {}).get("response", {}).get("explanation")
                ) if isinstance(m.suggested_actions, dict) else None,
                "evidenceGate": (
                    (m.suggested_actions or {}).get("evidenceGate")
                ) if isinstance(m.suggested_actions, dict) else None,
                "dataFreshness": (
                    (m.suggested_actions or {}).get("dataFreshness")
                ) if isinstance(m.suggested_actions, dict) else None,
            }
            for m in sorted(session.messages, key=lambda x: x.created_at)
        ],
    })


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AISession).where(AISession.id == session_id, AISession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return success_response(message="Session deleted")


# ── T30: Expert Review Mechanism ──────────────────────────────────────
from app.middleware.auth import require_roles


@router.post("/messages/{message_id}/review")
async def review_ai_message(
    message_id: str,
    request: Request,
    user: User = Depends(require_roles("doctor", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """Mark an AI message as reviewed by a medical expert.
    Stores review metadata in the message's suggested_actions JSONB field
    and creates an audit log entry for compliance tracking."""
    result = await db.execute(select(AIMessage).where(AIMessage.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if msg.role != "assistant":
        raise HTTPException(status_code=400, detail="Only AI messages can be reviewed")

    # Store review metadata in JSONB field
    review_info = {
        "expertReview": {
            "reviewedBy": {"id": user.id, "name": user.name, "role": user.role},
            "reviewedAt": _iso_z(datetime.now(timezone.utc)),
            "status": "reviewed",
        }
    }
    existing_actions = msg.suggested_actions if isinstance(msg.suggested_actions, dict) else {}
    existing_actions.update(review_info)
    msg.suggested_actions = existing_actions

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="AI 輸出專家審閱", target=message_id, status="success",
        ip=request.client.host if request.client else None,
        details={"session_id": msg.session_id},
    )
    await db.commit()

    return success_response(data={
        "messageId": message_id,
        "review": review_info["expertReview"],
    }, message="AI 輸出已標記為專家審閱完成")


class UpdateSessionTitleRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)


@router.patch("/sessions/{session_id}")
async def update_session_title(
    session_id: str,
    request: Request,
    body: UpdateSessionTitleRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AISession).where(AISession.id == session_id, AISession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.title = body.title.strip()
    await db.flush()

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="更新對話標題", target=session_id, status="success",
        ip=request.client.host if request.client else None,
        details={"title": session.title},
    )

    await db.commit()
    return success_response(data={"sessionId": session_id, "title": session.title})
