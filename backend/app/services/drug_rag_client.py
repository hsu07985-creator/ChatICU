"""Async HTTP client for Source B — Drug RAG (Qdrant-based) API (B03).

Communicates with the Drug RAG API from `1_藥物＿季/api/rag_api.py`
which provides drug monograph, interaction, and pharmacology queries
backed by Qdrant vector search with 22,647 drugs and 190K+ chunks.

All methods are async (using httpx.AsyncClient).
Graceful degradation: timeouts and errors return empty results + log warnings.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 30.0  # seconds (RAG + LLM generation can take 10-15s)
_DEFAULT_TOP_K = 5


# ── Response Models ───────────────────────────────────────────────────────

class DrugRagChunk(BaseModel):
    """A single retrieved chunk from the Drug RAG system."""
    chunk_id: str = ""
    text: str = ""
    score: float = 0.0
    source_type: str = ""
    drug_name: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DrugRagResponse(BaseModel):
    """Response from a Drug RAG query."""
    success: bool = False
    answer: Optional[str] = None
    chunks: List[DrugRagChunk] = Field(default_factory=list)
    category: Optional[str] = None
    error: Optional[str] = None


class EvidenceItem(BaseModel):
    """Unified evidence item format for cross-source fusion."""
    chunk_id: str = ""
    text: str = ""
    source_system: str = "drug_rag_qdrant"
    relevance_score: float = 0.0
    drug_names: List[str] = Field(default_factory=list)
    evidence_grade: str = "monograph"


# ── Client ────────────────────────────────────────────────────────────────

class DrugRagClient:
    """Async HTTP client for the Drug RAG (Qdrant) API.

    Targets Source B: the Qdrant-based drug RAG system with 22,647 drugs
    and 190K+ monograph chunks.

    Usage:
        client = DrugRagClient()
        response = await client.query("Vancomycin dosing in renal failure")
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self.base_url = (base_url or settings.SOURCE_B_URL).rstrip("/")
        self.timeout = timeout

    async def query(
        self,
        question: str,
        category_hint: Optional[str] = None,
        top_k: int = _DEFAULT_TOP_K,
    ) -> DrugRagResponse:
        """Query the Drug RAG API.

        Args:
            question: The query text.
            category_hint: Optional category hint to narrow search scope.
            top_k: Number of top chunks to retrieve.

        Returns:
            DrugRagResponse with answer, chunks, and category.
            On failure, returns a response with success=False and error message.
        """
        payload: Dict[str, Any] = {
            "question": question,
            "top_k": top_k,
        }
        if category_hint:
            payload["category"] = category_hint

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/query",
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

            # Parse response — the Drug RAG API may return various formats
            chunks = []
            for c in data.get("citations", data.get("chunks", [])):
                chunks.append(DrugRagChunk(
                    chunk_id=str(c.get("chunk_id", c.get("id", ""))),
                    text=str(c.get("text", c.get("content", ""))),
                    score=float(c.get("score", c.get("relevance_score", 0.0))),
                    source_type=str(c.get("source_type", c.get("category", ""))),
                    drug_name=c.get("drug_name"),
                    metadata={
                        k: v for k, v in c.items()
                        if k not in {"chunk_id", "id", "text", "content", "score",
                                     "relevance_score", "source_type", "category",
                                     "drug_name"}
                    },
                ))

            return DrugRagResponse(
                success=True,
                answer=data.get("answer", data.get("response")),
                chunks=chunks,
                category=data.get("category", category_hint),
            )

        except httpx.TimeoutException as exc:
            logger.warning(
                "[ORCH][SRC_B] Drug RAG query timeout (%.1fs): %s",
                self.timeout,
                str(exc)[:200],
            )
            return DrugRagResponse(
                success=False,
                error=f"timeout_after_{self.timeout}s",
            )

        except httpx.HTTPStatusError as exc:
            logger.warning(
                "[ORCH][SRC_B] Drug RAG HTTP error status=%s: %s",
                exc.response.status_code,
                exc.response.text[:200],
            )
            return DrugRagResponse(
                success=False,
                error=f"http_{exc.response.status_code}",
            )

        except httpx.ConnectError as exc:
            logger.warning(
                "[ORCH][SRC_B] Drug RAG connection failed: %s",
                str(exc)[:200],
            )
            return DrugRagResponse(
                success=False,
                error="connection_failed",
            )

        except Exception as exc:
            logger.error(
                "[ORCH][SRC_B] Drug RAG unexpected error: %s",
                str(exc)[:300],
            )
            return DrugRagResponse(
                success=False,
                error=f"unexpected_{exc.__class__.__name__}",
            )

    async def health(self) -> bool:
        """Check if the Drug RAG API is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/health")
                return resp.status_code == 200
        except Exception:
            return False

    def to_evidence_items(self, response: DrugRagResponse) -> List[EvidenceItem]:
        """Convert DrugRagResponse chunks to unified EvidenceItem format.

        This enables cross-source evidence fusion in the orchestrator.
        """
        items: List[EvidenceItem] = []
        for chunk in response.chunks:
            drug_names: List[str] = []
            if chunk.drug_name:
                drug_names.append(chunk.drug_name)

            items.append(EvidenceItem(
                chunk_id=chunk.chunk_id,
                text=chunk.text,
                source_system="drug_rag_qdrant",
                relevance_score=chunk.score,
                drug_names=drug_names,
                evidence_grade="monograph",
            ))
        return items


# Module-level singleton
drug_rag_client = DrugRagClient()
