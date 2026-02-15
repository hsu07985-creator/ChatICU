"""RAG endpoints (Phase 3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.user import User
from app.schemas.clinical import RAGIndexRequest, RAGQueryRequest
from app.services.llm_services.rag_service import rag_service
from app.utils.response import success_response

router = APIRouter(prefix="/api/v1/rag", tags=["RAG"])


@router.post("/query")
async def rag_query(
    payload: RAGQueryRequest,
    user: User = Depends(get_current_user),
):
    if not rag_service.is_indexed:
        raise HTTPException(status_code=503, detail="RAG index not ready. Call POST /api/v1/rag/index first.")
    result = rag_service.query(payload.question, top_k=payload.top_k)
    return success_response(data=result)


@router.post("/index")
async def rag_index(
    request: Request,
    payload: RAGIndexRequest = None,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
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
async def rag_status(user: User = Depends(get_current_user)):
    return success_response(data={
        "is_indexed": rag_service.is_indexed,
        "total_chunks": len(rag_service.chunks),
        "embedding_dim": rag_service.embeddings.shape[1] if rag_service.embeddings is not None else 0,
    })
