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
import time
import uuid
from datetime import datetime, timezone
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
    call_llm_stream,
    summarize_citations,
)
from app.middleware.auth import get_current_user
from app.middleware.audit import create_audit_log
from app.routers.clinical import _get_patient_dict
from app.models.ai_session import AIMessage, AISession
from app.models.user import User
from app.schemas.clinical import AIChatRequest
from app.services.llm_services.rag_service import rag_service
from app.services.safety_guardrail import apply_safety_guardrail
from app.utils.data_freshness import build_data_freshness
from app.utils.llm_errors import llm_unavailable_detail
from app.utils.request_context import evidence_trace_kwargs
from app.middleware.rate_limit import limiter
from app.utils.ddi_check import extract_ddi_warnings
from app.services.intent_classifier import detect_drugs_from_text
from app.services.drug_graph_bridge import drug_graph_bridge
from app.utils.response import success_response
from pydantic import BaseModel, Field

logger = logging.getLogger("chaticu")

router = APIRouter(prefix="/ai", tags=["AI"])

_HIGH_RISK = {"X", "D", "C"}

# Drugs that map to class nodes in the graph (individual nodes have no direct edges)
_MSG_DRUG_CLASS_FALLBACK: Dict[str, str] = {
    "amikacin": "Aminoglycosides",
    "gentamicin": "Aminoglycosides",
    "tobramycin": "Aminoglycosides",
    "colistin": "Colistimethate",
    "colistimethate": "Colistimethate",
    "bumetanide": "Loop Diuretics",
    "torsemide": "Loop Diuretics",
    "furosemide": "Loop Diuretics",   # furosemide IS a direct node, but fallback harmless
    "cisatracurium": "Neuromuscular-Blocking Agents",
    "rocuronium": "Neuromuscular-Blocking Agents",
    "vecuronium": "Neuromuscular-Blocking Agents",
    "cefepime": "Cephalosporins",
    "ceftazidime": "Cephalosporins",
    "cefoxitin": "Cephalosporins",
    "cefazolin": "Cephalosporins",
    "cefoperazone": "Cephalosporins",
}


def _check_message_drugs(
    message: str,
    patient_context: Optional[dict],
) -> List[Dict[str, Any]]:
    """Detect drug names mentioned in the user's message and cross-check them
    against the patient's active medications via the drug graph.

    Returns DDI warnings for *proposed* drugs not yet in the active med list,
    so the LLM knows before recommending a new drug.
    """
    if not patient_context or not drug_graph_bridge.is_ready():
        return []

    msg_drug_names = detect_drugs_from_text(message)
    if not msg_drug_names:
        return []

    # Collect active patient med generic names (already DDI-normalized via alias map)
    active_generics: List[str] = []
    seen_g: set = set()
    for m in (patient_context.get("medications") or []):
        raw = (m.get("genericName") or m.get("generic_name") or "").strip()
        if not raw:
            continue
        for part in raw.split(" / "):
            p = part.strip()
            if p and p.lower() not in seen_g:
                seen_g.add(p.lower())
                active_generics.append(p)

    if not active_generics:
        return []

    warnings: List[Dict[str, Any]] = []
    seen_pairs: set = set()

    for raw_name in msg_drug_names:
        resolved = drug_graph_bridge.resolve_drug(raw_name)
        if not resolved:
            continue
        # Skip if this drug is already in the active med list (covered by ddi_check)
        if resolved.lower() in seen_g:
            continue
        # Build list of names to try: individual + class fallback
        names_to_try = [resolved]
        class_fallback = _MSG_DRUG_CLASS_FALLBACK.get(raw_name.lower())
        if class_fallback and class_fallback.lower() != resolved.lower():
            names_to_try.append(class_fallback)

        for drug_a in names_to_try:
            for active in active_generics:
                pair_key = tuple(sorted([drug_a.lower(), active.lower()]))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                try:
                    hits = drug_graph_bridge.search_interactions(
                        drug_a=drug_a, drug_b=active, page=1, limit=3,
                    )
                except Exception:
                    continue
                for hit in hits:
                    risk = (hit.get("riskLevel") or "").upper()
                    if risk in _HIGH_RISK:
                        hit["_proposed"] = raw_name  # tag as message-detected
                        warnings.append(hit)

    return warnings


def _build_metadata_block(
    data_freshness: Optional[dict],
    citations: List[Dict[str, Any]],
    ddi_warnings: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Format evidence quality + data freshness as metadata for LLM.

    The LLM uses this block to self-regulate confidence and disclaimers
    instead of external hard gates.
    """
    lines: List[str] = ["[回答品質中繼資料]"]

    # Citation stats
    relevance_scores = [float(c.get("relevance", 0) or 0) for c in citations]
    max_rel = max(relevance_scores) if relevance_scores else 0.0
    lines.append(f"- 引用文獻數量: {len(citations)}, 最高相關分數: {max_rel:.2f}")

    # Data freshness
    if isinstance(data_freshness, dict):
        sections = data_freshness.get("sections", {})
        parts: List[str] = []
        for key in ("vital_signs", "lab_data", "ventilator_settings"):
            sec = sections.get(key, {})
            if isinstance(sec, dict):
                status = sec.get("status", "unknown")
                age = sec.get("age_hours")
                if age is not None:
                    parts.append(f"{key}={status}({age:.1f}h)")
                else:
                    parts.append(f"{key}={status}")
        if parts:
            lines.append(f"- 病患資料狀態: {', '.join(parts)}")

        missing = data_freshness.get("missing_fields", [])
        if missing:
            lines.append(f"- 缺值欄位: {', '.join(missing[:8])}")
    else:
        lines.append("- 病患資料狀態: 無病患資料")

    # Drug-drug interaction warnings
    existing = [w for w in ddi_warnings if not w.get("_proposed")]
    proposed = [w for w in ddi_warnings if w.get("_proposed")]

    if existing:
        lines.append(f"\n[藥物交互作用警示] (共 {len(existing)} 筆，來自現用藥)")
        for w in existing[:10]:
            risk = w.get("riskLevel", "?")
            d1 = w.get("drug1", "?")
            d2 = w.get("drug2", "?")
            sev = w.get("severity", "?")
            mgmt = (w.get("management") or "")[:120]
            lines.append(f"  ⚠ [{risk}] {d1} ↔ {d2} ({sev}): {mgmt}")

    if proposed:
        lines.append(f"\n[硬限制 — 訊息中提及藥物的交互作用警示] (共 {len(proposed)} 筆)")
        lines.append("  !! 以下為醫師訊息中提及之藥物與現用藥的交互作用。Risk X = 禁忌，不得建議使用。")
        for w in proposed[:10]:
            risk = w.get("riskLevel", "?")
            d1 = w.get("drug1", "?")
            d2 = w.get("drug2", "?")
            sev = w.get("severity", "?")
            prop = w.get("_proposed", "?")
            mgmt = (w.get("management") or "")[:120]
            lines.append(f"  ⚠ [{risk}] {prop}（訊息）↔ {d2} ({sev}): {mgmt}")

    return "\n".join(lines)


def _passive_evidence_gate(citations: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute evidence gate metadata passively (no blocking).

    Returns a dict compatible with the frontend evidenceGate contract,
    but ``passed`` is always True — the LLM decides how to handle
    evidence quality via its system prompt.
    """
    relevance_scores = [float(c.get("relevance", 0) or 0) for c in citations]
    return {
        "passed": True,
        "reason_code": None,
        "display_reason": None,
        "citation_count": len(citations),
        "confidence": round(max(relevance_scores), 4) if relevance_scores else 0.0,
        "thresholds": {"min_citations": 0, "min_confidence": 0.0},
    }


async def _retrieve_with_fallback(
    query: str,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Retrieve from local RAG index. Returns (rag_context, citations).

    Skips immediately if no index is loaded — no wasted I/O.
    """
    if not rag_service.is_indexed:
        return "", []

    try:
        _raw_sources = rag_service.retrieve(query, top_k=8)
    except Exception:
        _raw_sources = []

    _source_counts: Dict[str, int] = {}
    sources: List[Dict[str, Any]] = []
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
    if citations:
        logger.info("[INTG][AI][RAG] Local RAG returned %d citations", len(citations))

    return rag_context, citations


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


# ── Helper: slim patient context for token efficiency ────────────────

def _prepare_patient_context(patient_context: Optional[dict]) -> Optional[dict]:
    """Strip null/empty values from patient data to reduce token count."""
    if not patient_context:
        return None
    slim: Dict[str, Any] = {}
    for k, v in patient_context.items():
        if v is None or v == [] or v == {} or v == "":
            continue
        slim[k] = v
    return slim


# ── Helper: build multi-turn messages for LLM ──────────────────────────

def _build_chat_messages(
    session_summary: Optional[str],
    history: List[AIMessage],
    current_question: str,
    rag_context: str,
    patient_context: Optional[dict],
    metadata_block: Optional[str] = None,
) -> List[dict]:
    """Build a multi-turn messages array for the LLM.

    Structure:
      [summary context pair] + [recent history] + [current user message with RAG/patient/metadata]
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

    # 3. Build current user message with patient + metadata + RAG + question
    parts: List[str] = []
    if patient_context:
        slim_ctx = _prepare_patient_context(patient_context)
        parts.append(
            f"[病患資料]\n{json.dumps(slim_ctx, ensure_ascii=False, default=str)}"
        )
    if metadata_block:
        parts.append(metadata_block)
    if rag_context:
        # Trim RAG context: keep first 3000 chars to avoid token waste
        trimmed_rag = rag_context[:3000]
        if len(rag_context) > 3000:
            # Try to cut at a clean boundary
            last_sep = trimmed_rag.rfind("\n\n---\n\n")
            if last_sep > 1500:
                trimmed_rag = trimmed_rag[:last_sep]
        parts.append(f"[參考文獻]\n{trimmed_rag}")
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

    # ── Context assembly (patient + data freshness) ──
    patient_context = None
    data_freshness = None
    if req.patientId:
        try:
            patient_context = await _get_patient_dict(req.patientId, db)
            data_freshness = build_data_freshness(patient_context)
        except HTTPException:
            logger.warning(
                "[INTG][AI][API] Patient %s not found",
                req.patientId,
            )

    # ── Drug-drug interaction auto-check ──
    ddi_warnings: List[Dict[str, Any]] = []
    if patient_context:
        try:
            ddi_warnings = await asyncio.to_thread(
                extract_ddi_warnings, patient_context,
            )
        except Exception as exc:
            logger.warning("[INTG][AI][DDI] Drug interaction check failed: %s", exc)
        # B09: also check drugs mentioned in the message itself
        try:
            msg_ddi = await asyncio.to_thread(
                _check_message_drugs, req.message, patient_context,
            )
            ddi_warnings.extend(msg_ddi)
        except Exception as exc:
            logger.warning("[INTG][AI][DDI] Message drug check failed: %s", exc)

    logger.info(
        "[INTG][AI][API] /ai/chat request_id=%s trace_id=%s session_id=%s user_id=%s patient_id=%s ddi_count=%d",
        request_id, trace_id, session_id, user.id, req.patientId, len(ddi_warnings),
    )

    # ── RAG retrieval (single path with fallback) ──
    rag_context, citations = await _retrieve_with_fallback(req.message)
    citations = _merge_citations_by_source(citations)
    evidence_gate = _passive_evidence_gate(citations)

    # ── Build metadata + messages ──
    metadata_block = _build_metadata_block(data_freshness, citations, ddi_warnings)
    chat_messages = _build_chat_messages(
        session_summary=session.summary,
        history=all_messages,
        current_question=req.message,
        rag_context=rag_context,
        patient_context=patient_context,
        metadata_block=metadata_block,
    )

    # ── LLM generation + citation summary (parallel) ──
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
    ai_content = ""
    ai_explanation: Optional[str] = None

    if degraded:
        logger.error(
            "[INTG][AI][API] LLM chat failed [status=%s]: %s",
            llm_status, (llm_result.get("content") or "")[:500],
        )
        ai_content = llm_unavailable_detail()
        citations = []
        guardrail_result = {
            "content": ai_content, "flagged": False,
            "warnings": None, "requiresExpertReview": False,
        }
    else:
        raw_content = llm_result.get("content", "Unable to generate response.")
        guardrail_result = apply_safety_guardrail(raw_content, include_disclaimer=False, user_role=user.role)
        parsed_main, parsed_explanation = _extract_main_and_explanation(
            str(guardrail_result["content"]),
        )
        normalized_main = _normalize_main_answer_prefix(parsed_main, req.message)
        ai_content = normalized_main or parsed_main or str(guardrail_result["content"]).strip()
        ai_explanation = parsed_explanation

    # ── Persist + compress + audit ──
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
        "queryPolicy": {},
        "response": {"explanation": ai_explanation},
        "evidenceGate": evidence_gate,
        "dataFreshness": data_freshness,
    }
    ai_msg = AIMessage(
        id=ai_msg_id, session_id=session_id, role="assistant",
        content=ai_content, citations=citations or None,
        suggested_actions=guardrail_meta,
    )
    db.add(ai_msg)

    all_messages.append(user_msg)
    all_messages.append(ai_msg)
    await _maybe_compress_history(session, all_messages)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="AI 對話", target=session_id, status="success" if not degraded else "failed",
        ip=request.client.host if request.client else None,
        details={
            "patient_id": req.patientId,
            "message_length": len(req.message),
            "safety_flagged": guardrail_result["flagged"],
            "llm_status": llm_status,
            "citation_count": len(citations),
            "history_msg_count": len(all_messages),
            "has_summary": session.summary is not None,
        },
    )
    await db.commit()

    return success_response(data={
        "message": {
            "id": ai_msg_id, "role": "assistant", "content": ai_content,
            "explanation": ai_explanation, "timestamp": _iso_z(now),
            "citations": citations,
            "safetyWarnings": guardrail_result["warnings"] if guardrail_result["flagged"] else None,
            "requiresExpertReview": guardrail_result.get("requiresExpertReview", False),
            "degraded": degraded,
            "degradedReason": degraded_reason if degraded else None,
            "upstreamStatus": llm_status,
            "evidenceGate": evidence_gate,
            "dataFreshness": data_freshness,
            "graphMeta": {
                "interactions": [
                    {
                        "drug_a": w.get("drug1", ""),
                        "drug_b": w.get("drug2", ""),
                        "risk": w.get("riskLevel", "C"),
                        "title": (w.get("management") or "")[:200],
                        "severity": w.get("severity"),
                    }
                    for w in ddi_warnings
                ],
                "has_risk_x": any(
                    w.get("riskLevel") == "X" for w in ddi_warnings
                ),
            } if ddi_warnings else None,
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
    """True SSE streaming chat endpoint (AO-04).

    Performs all pre-generation work (session, RAG, evidence gate) up front,
    then streams LLM tokens in real-time via SSE delta events. Post-generation
    work (guardrail, DB persist, compression) runs after streaming completes.
    """

    async def event_generator():
        try:
            # ── Phase 1: Pre-generation (shared with /ai/chat) ──────────
            t_start = time.perf_counter()
            timings: Dict[str, float] = {}

            session_id = req.sessionId or f"session_{uuid.uuid4().hex[:8]}"
            now = datetime.now(timezone.utc)
            trace_kwargs = evidence_trace_kwargs(request)
            request_id = trace_kwargs.get("request_id", "unknown")
            trace_id = trace_kwargs.get("trace_id", request_id)

            # Send thinking event immediately so frontend shows status
            yield _sse_event("thinking", {"phase": "init", "detail": "正在準備回覆…"})

            # ── Session + history (sequential — AsyncSession is not concurrency-safe) ──
            result = await db.execute(select(AISession).where(AISession.id == session_id))
            session = result.scalar_one_or_none()
            if not session:
                session = AISession(
                    id=session_id, user_id=user.id,
                    patient_id=req.patientId, title=req.message[:50],
                )
                db.add(session)
                await db.flush()

            history_result = await db.execute(
                select(AIMessage).where(AIMessage.session_id == session_id)
                .order_by(AIMessage.created_at.asc())
            )
            all_messages = list(history_result.scalars().all())
            timings["db_session_history"] = time.perf_counter() - t_start

            patient_context = None
            data_freshness = None
            t_patient = time.perf_counter()
            if req.patientId:
                try:
                    patient_context = await _get_patient_dict(req.patientId, db)
                    data_freshness = build_data_freshness(patient_context)
                except HTTPException:
                    pass
            timings["patient_context"] = time.perf_counter() - t_patient

            user_msg_id = f"msg_{uuid.uuid4().hex[:8]}"
            user_msg = AIMessage(id=user_msg_id, session_id=session_id, role="user", content=req.message)
            db.add(user_msg)

            # ── RAG retrieval (skip entirely when not indexed) ──
            t_rag = time.perf_counter()
            if rag_service.is_indexed:
                yield _sse_event("thinking", {"phase": "rag", "detail": "正在查詢文獻…"})
                rag_context, citations = await _retrieve_with_fallback(req.message)
            else:
                rag_context, citations = "", []
            timings["rag_retrieval"] = time.perf_counter() - t_rag

            citations = _merge_citations_by_source(citations)
            evidence_gate = _passive_evidence_gate(citations)

            # ── DDI check ──
            ddi_warnings: List[Dict[str, Any]] = []
            if patient_context:
                try:
                    ddi_warnings = await asyncio.to_thread(
                        extract_ddi_warnings, patient_context,
                    )
                except Exception:
                    pass
                # B09: also check drugs mentioned in the message itself
                try:
                    msg_ddi = await asyncio.to_thread(
                        _check_message_drugs, req.message, patient_context,
                    )
                    ddi_warnings.extend(msg_ddi)
                except Exception:
                    pass

            ai_msg_id = f"msg_{uuid.uuid4().hex[:8]}"
            yield _sse_event("start", {"sessionId": session_id, "messageId": ai_msg_id})

            # ── Phase 2: LLM streaming (always, no gates) ──
            yield _sse_event("thinking", {"phase": "generating", "detail": "正在生成回答…"})

            metadata_block = _build_metadata_block(data_freshness, citations, ddi_warnings)
            chat_messages = _build_chat_messages(
                session_summary=session.summary,
                history=all_messages,
                current_question=req.message,
                rag_context=rag_context,
                patient_context=patient_context,
                metadata_block=metadata_block,
            )

            # Start citation summarization in parallel
            citation_task = None
            if settings.RAG_CITATION_SUMMARY_ENABLED and citations:
                citation_task = asyncio.create_task(
                    asyncio.to_thread(summarize_citations, req.message, citations)
                )

            full_content = ""
            degraded = False
            degraded_reason = None
            t_llm_start = time.perf_counter()
            t_first_token = None

            async for token in call_llm_stream(
                task="rag_generation",
                messages=chat_messages,
                request_id=request_id,
                trace_id=trace_id,
            ):
                if token.startswith("{") and '"__done__"' in token:
                    break
                if token.startswith("[ERROR]"):
                    degraded = True
                    degraded_reason = "llm_unavailable"
                    full_content = llm_unavailable_detail()
                    for chunk in _chunk_text_for_stream(full_content):
                        yield _sse_event("delta", {"chunk": chunk})
                    break
                if t_first_token is None:
                    t_first_token = time.perf_counter()
                full_content += token
                yield _sse_event("delta", {"chunk": token})

            timings["llm_ttfb"] = (t_first_token - t_llm_start) if t_first_token else 0.0
            timings["llm_streaming_total"] = time.perf_counter() - t_llm_start

            # Await citation task (with timeout)
            t_post = time.perf_counter()
            if citation_task:
                try:
                    citations = await asyncio.wait_for(citation_task, timeout=5.0)
                except (asyncio.TimeoutError, Exception):
                    logger.info("[INTG][AI][API] Citation summarization timed out, using raw citations")
            timings["citation_summary"] = time.perf_counter() - t_post

            # Apply safety guardrail (regex only) on complete content
            t_guard = time.perf_counter()
            guardrail_result = apply_safety_guardrail(full_content, include_disclaimer=False, user_role=user.role)
            ai_content = str(guardrail_result["content"])
            timings["guardrail"] = time.perf_counter() - t_guard

            # ── Phase 3: Post-generation (persist + compress + audit) ──
            ai_explanation = None
            if not degraded:
                parsed_main, parsed_explanation = _extract_main_and_explanation(ai_content)
                normalized_main = _normalize_main_answer_prefix(parsed_main, req.message)
                ai_content = normalized_main or parsed_main or ai_content.strip()
                ai_explanation = parsed_explanation

            guardrail_meta = {
                "guardrail": {
                    "warnings": guardrail_result.get("warnings") if guardrail_result.get("flagged") else None,
                    "flagged": guardrail_result.get("flagged", False),
                    "requiresExpertReview": guardrail_result.get("requiresExpertReview", False),
                },
                "delivery": {
                    "degraded": degraded,
                    "degradedReason": degraded_reason if degraded else None,
                },
                "queryPolicy": {},
                "response": {"explanation": ai_explanation},
                "evidenceGate": evidence_gate,
                "dataFreshness": data_freshness,
            }

            ai_msg = AIMessage(
                id=ai_msg_id, session_id=session_id, role="assistant",
                content=ai_content, citations=citations or None,
                suggested_actions=guardrail_meta,
            )
            db.add(ai_msg)

            all_messages.append(user_msg)
            all_messages.append(ai_msg)
            t_compress = time.perf_counter()
            try:
                await asyncio.wait_for(_maybe_compress_history(session, all_messages), timeout=1.0)
            except asyncio.TimeoutError:
                logger.info("[INTG][AI][API] History compression timed out, will retry next request")
            timings["compression"] = time.perf_counter() - t_compress

            t_commit = time.perf_counter()
            await create_audit_log(
                db, user_id=user.id, user_name=user.name, role=user.role,
                action="AI 對話（串流）", target=session_id, status="success" if not degraded else "degraded",
                ip=request.client.host if request.client else None,
                details={
                    "patient_id": req.patientId, "message_length": len(req.message),
                    "safety_flagged": guardrail_result.get("flagged", False),
                    "citation_count": len(citations), "streaming": True,
                },
            )
            await db.commit()
            timings["db_commit"] = time.perf_counter() - t_commit
            timings["total"] = time.perf_counter() - t_start

            timings_rounded = {k: round(v, 3) for k, v in timings.items()}
            logger.info("[PERF][AI][STREAM] timings=%s model=%s", json.dumps(timings_rounded), settings.LLM_MODEL)

            yield _sse_event("done", {
                "message": {
                    "id": ai_msg_id, "role": "assistant", "content": ai_content,
                    "explanation": ai_explanation, "timestamp": _iso_z(now),
                    "citations": citations,
                    "safetyWarnings": guardrail_result.get("warnings") if guardrail_result.get("flagged") else None,
                    "requiresExpertReview": guardrail_result.get("requiresExpertReview", False),
                    "degraded": degraded,
                    "degradedReason": degraded_reason if degraded else None,
                    "evidenceGate": evidence_gate,
                    "dataFreshness": data_freshness,
                    "graphMeta": {
                        "interactions": [
                            {
                                "drug_a": w.get("drug1", ""),
                                "drug_b": w.get("drug2", ""),
                                "risk": w.get("riskLevel", "C"),
                                "title": (w.get("management") or "")[:200],
                                "severity": w.get("severity"),
                            }
                            for w in ddi_warnings
                        ],
                        "has_risk_x": any(
                            w.get("riskLevel") == "X" for w in ddi_warnings
                        ),
                    } if ddi_warnings else None,
                },
                "sessionId": session_id,
                "timings": timings_rounded,
            })

        except HTTPException as exc:
            yield _sse_event("error", {"message": str(exc.detail), "status": exc.status_code, "recoverable": True})
        except Exception as exc:
            logger.exception("[INTG][AI][API][AO-04] chat stream failed: %s", exc)
            yield _sse_event("error", {"message": "AI 串流失敗，請稍後重試。", "status": 500, "recoverable": True})

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
    user: User = Depends(require_roles("doctor", "np", "admin")),
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


# ── Message feedback (thumbs up/down) ────────────────────────────────


class FeedbackBody(BaseModel):
    feedback: Optional[str] = Field(None, pattern=r"^(up|down)$")


@router.patch("/chat/messages/{message_id}/feedback")
@limiter.limit("30/minute")
async def update_message_feedback(
    message_id: str,
    body: FeedbackBody,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AIMessage).where(AIMessage.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    msg.feedback = body.feedback
    await db.commit()
    return success_response(data={"messageId": message_id, "feedback": body.feedback})
