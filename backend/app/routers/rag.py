"""RAG endpoints (Phase 3) — hybrid RAG via func/ with local RAG fallback."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.user import User
from app.schemas.clinical import RAGIndexRequest, RAGQueryRequest
from app.services.evidence_client import evidence_client
from app.services.llm_services.rag_service import rag_service
from app.utils.evidence_gate import evaluate_evidence_gate
from app.utils.request_context import evidence_trace_kwargs
from app.utils.response import success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/rag", tags=["RAG"])


def _hybrid_sources(citations: list[dict]) -> list[dict]:
    return [
        {
            "doc_id": c.get("source_file", c.get("chunk_id", "")),
            "score": c.get("score", 0),
            "category": c.get("topic", ""),
            "excerpt": c.get("snippet", "")[:200],
        }
        for c in citations
    ]


def _rejected_payload(
    *,
    sources: list[dict],
    metadata: dict,
    gate: dict,
) -> dict:
    return {
        "answer": "",
        "sources": sources,
        "metadata": {
            **metadata,
            "evidence_gate": gate,
        },
        "rejected": True,
        "rejectedReason": gate["reason_code"],
        "displayReason": gate["display_reason"],
    }


@router.post("/query")
async def rag_query(
    payload: RAGQueryRequest,
    request: Request,
    user: User = Depends(get_current_user),
):
    # Try hybrid RAG (func/) first
    try:
        result = await asyncio.to_thread(
            evidence_client.query,
            payload.question,
            payload.top_k,
            **evidence_trace_kwargs(request),
        )
        citations = result.get("citations", [])
        sources = _hybrid_sources(citations)
        gate = evaluate_evidence_gate(
            citations=citations,
            confidence=result.get("confidence"),
        )
        metadata = {
            "engine": "hybrid_rag",
            "confidence": gate["confidence"],
        }
        if not gate["passed"]:
            return success_response(data=_rejected_payload(
                sources=sources,
                metadata=metadata,
                gate=gate,
            ))
        return success_response(data={
            "answer": result.get("answer", ""),
            "sources": sources,
            "metadata": {
                **metadata,
                "evidence_gate": gate,
            },
            "rejected": False,
        })
    except Exception as exc:
        logger.warning("[INTG][AI][API][F03] Hybrid RAG query failed, falling back to local RAG: %s", exc)

    # Fallback to local RAG
    if not rag_service.is_indexed:
        raise HTTPException(status_code=503, detail="RAG index not ready. Call POST /api/v1/rag/index first.")
    result = rag_service.query(payload.question, top_k=payload.top_k)
    sources = result.get("sources", [])
    gate = evaluate_evidence_gate(citations=sources, confidence=None)
    metadata = {
        **(result.get("metadata") or {}),
        "engine": "local_rag",
        "confidence": gate["confidence"],
    }
    if not gate["passed"]:
        return success_response(data=_rejected_payload(
            sources=sources,
            metadata=metadata,
            gate=gate,
        ))
    return success_response(data={
        **result,
        "metadata": {
            **metadata,
            "evidence_gate": gate,
        },
        "rejected": False,
    })


@router.post("/index")
async def rag_index(
    request: Request,
    payload: RAGIndexRequest = None,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    # Try func/ ingest first
    try:
        result = await asyncio.to_thread(
            evidence_client.ingest,
            payload.docs_path if payload else None,
            **evidence_trace_kwargs(request),
        )
        await create_audit_log(
            db, user_id=user.id, user_name=user.name, role=user.role,
            action="RAG 索引建立", target="rag_index", status="success",
            ip=request.client.host if request.client else None,
            details={"engine": "hybrid_rag", "chunks_total": result.get("chunks_total")},
        )
        return success_response(data=result)
    except Exception as exc:
        logger.warning("[INTG][AI][API][F03] Hybrid RAG ingest failed, falling back to local RAG: %s", exc)

    docs_path = payload.docs_path if payload else None
    chunks = rag_service.load_and_chunk(docs_path)
    result = rag_service.index(chunks)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="RAG 索引建立", target="rag_index", status="success",
        ip=request.client.host if request.client else None,
        details={"total_chunks": result.get("total_chunks"), "docs_path": docs_path},
    )

    return success_response(data=result)


@router.get("/status")
async def rag_status(
    request: Request,
    user: User = Depends(get_current_user),
):
    # Try func/ health for richer status
    try:
        health = await asyncio.to_thread(
            evidence_client.health,
            **evidence_trace_kwargs(request),
        )
        index_info = health.get("index", {})
        return success_response(data={
            "is_indexed": index_info.get("total_chunks", 0) > 0,
            "total_chunks": index_info.get("total_chunks", 0),
            "total_documents": index_info.get("total_documents", 0),
            "engine": "hybrid_rag",
            "clinical_rules_loaded": health.get("clinical_rules_loaded", False),
        })
    except Exception as exc:
        logger.warning("[INTG][AI][API][F03] Evidence health check failed, falling back to local RAG status: %s", exc)

    # Fallback to local RAG status (engine flag reflects degraded state)
    status = rag_service.get_status()
    status["engine"] = "local_rag"
    return success_response(data=status)
