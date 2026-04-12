"""AI readiness endpoint for frontend preflight gating (AO-01)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.middleware.auth import get_current_user
from app.models.user import User
from app.services.evidence_client import evidence_client
from app.services.llm_services.rag_service import rag_service
from app.utils.request_context import evidence_trace_kwargs
from app.utils.response import success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ai", tags=["AI"])


def _append_reason(target: list[str], reason: str | None) -> None:
    if reason and reason not in target:
        target.append(reason)


def _resolve_llm_ready() -> tuple[bool, str | None]:
    provider = (settings.LLM_PROVIDER or "").strip().lower()
    if provider == "openai":
        if (settings.OPENAI_API_KEY or "").strip():
            return True, None
        return False, "LLM_API_KEY_MISSING"
    if provider == "anthropic":
        if (settings.ANTHROPIC_API_KEY or "").strip():
            return True, None
        return False, "LLM_API_KEY_MISSING"
    return False, "LLM_PROVIDER_UNSUPPORTED"


@router.get("/readiness")
async def ai_readiness(
    request: Request,
    _user: User = Depends(get_current_user),
):
    llm_ready, llm_reason = _resolve_llm_ready()

    evidence_reachable = False
    evidence_error: str | None = None
    rag_total_chunks = 0
    rag_total_documents = 0
    clinical_rules_loaded = False
    engine = "unknown"

    try:
        health = await asyncio.to_thread(
            evidence_client.health,
            **evidence_trace_kwargs(request),
        )
        evidence_reachable = True
        index_info = health.get("index", {}) if isinstance(health, dict) else {}
        rag_total_chunks = int(index_info.get("total_chunks", 0) or 0)
        rag_total_documents = int(index_info.get("total_documents", 0) or 0)
        clinical_rules_loaded = bool(health.get("clinical_rules_loaded", False))
        engine = "hybrid_rag"
    except Exception as exc:
        evidence_error = str(exc)[:200]
        logger.warning(
            "[INTG][AI][API][AO-01] Evidence health check failed in readiness gate: %s",
            evidence_error,
        )
        rag_status = rag_service.get_status()
        rag_total_chunks = int(rag_status.get("total_chunks", 0) or 0)
        rag_total_documents = int(rag_status.get("total_documents", 0) or 0)
        engine = "local_rag"

    rag_ready = rag_total_chunks > 0
    knowledge_ready = evidence_reachable or rag_ready

    feature_gates = {
        "chat": llm_ready,  # New chat uses DB context builder, not RAG/evidence
        "clinical_summary": llm_ready,
        "patient_explanation": llm_ready,
        "guideline_interpretation": llm_ready and knowledge_ready,
        "decision_support": llm_ready and knowledge_ready,
        "clinical_polish": llm_ready,
        "dose_calculation": evidence_reachable,
        "drug_interactions": evidence_reachable,
        "clinical_query": evidence_reachable,
    }

    blocking_reasons: list[str] = []
    _append_reason(blocking_reasons, llm_reason if not llm_ready else None)
    if not evidence_reachable:
        _append_reason(blocking_reasons, "EVIDENCE_UNREACHABLE")
    if not rag_ready:
        _append_reason(blocking_reasons, "RAG_NOT_INDEXED")
    if not knowledge_ready:
        _append_reason(blocking_reasons, "KNOWLEDGE_SOURCE_UNAVAILABLE")

    reason_display = {
        "LLM_API_KEY_MISSING": "LLM API key 未設定，AI 生成功能已停用。",
        "LLM_PROVIDER_UNSUPPORTED": "LLM provider 設定不支援，請檢查後端設定。",
        "EVIDENCE_UNREACHABLE": "Evidence 服務無法連線，劑量/交互作用與混合查詢功能暫不可用。",
        "RAG_NOT_INDEXED": "RAG 尚未索引，臨床指引與帶文獻依據的回答可能降級。",
        "KNOWLEDGE_SOURCE_UNAVAILABLE": "知識來源不可用（Evidence 與本地 RAG 均不可用）。",
    }
    display_reasons = [reason_display[r] for r in blocking_reasons if r in reason_display]

    overall_ready = all(feature_gates.values())

    logger.info(
        "[INTG][AI][API][AO-01] readiness checked llm_ready=%s evidence_reachable=%s rag_ready=%s overall_ready=%s",
        llm_ready,
        evidence_reachable,
        rag_ready,
        overall_ready,
    )

    return success_response(
        data={
            "overall_ready": overall_ready,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "llm": {
                "ready": llm_ready,
                "provider": settings.LLM_PROVIDER,
                "model": settings.LLM_MODEL,
                "reason": llm_reason if not llm_ready else None,
            },
            "evidence": {
                "reachable": evidence_reachable,
                "ready": evidence_reachable,
                "reason": "EVIDENCE_UNREACHABLE" if not evidence_reachable else None,
                "last_error": evidence_error,
            },
            "rag": {
                "ready": rag_ready,
                "is_indexed": rag_ready,
                "total_chunks": rag_total_chunks,
                "total_documents": rag_total_documents,
                "engine": engine,
                "clinical_rules_loaded": clinical_rules_loaded,
            },
            "feature_gates": feature_gates,
            "blocking_reasons": blocking_reasons,
            "display_reasons": display_reasons,
        }
    )
