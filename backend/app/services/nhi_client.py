"""Async HTTP client for the NHI reimbursement RAG microservice.

The NHI module runs as a standalone FastAPI service (0_chatICU reference/文本/nhi/).
This client wraps calls to its /search and /ask endpoints.

All methods are async (native httpx.AsyncClient). Handles timeout and
connection errors gracefully — callers receive empty/degraded results instead
of unhandled exceptions.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 8.0  # seconds — tight bound so the main API stays responsive


class NhiClient:
    """Thin async HTTP wrapper for the NHI RAG service."""

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.NHI_SERVICE_URL).rstrip("/")

    # ── Public API ─────────────────────────────────────────────────────

    async def search(self, drug_name: str, top_k: int = 5) -> Dict[str, Any]:
        """Call NHI module's POST /search endpoint.

        Args:
            drug_name: Drug name (English or Chinese).
            top_k: Number of chunks to retrieve.

        Returns:
            Dict with keys ``results`` (list of chunk dicts) and ``query``.
            On failure, returns ``{"results": [], "query": drug_name}``.
        """
        payload = {"query": drug_name, "top_k": top_k}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(f"{self.base_url}/search", json=payload)
                resp.raise_for_status()
                return resp.json()
        except httpx.ConnectError as exc:
            logger.warning(
                "[NHI][CLIENT] search — service unreachable base_url=%s err=%s",
                self.base_url,
                str(exc)[:200],
            )
        except httpx.TimeoutException as exc:
            logger.warning(
                "[NHI][CLIENT] search — timeout base_url=%s err=%s",
                self.base_url,
                str(exc)[:200],
            )
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "[NHI][CLIENT] search — HTTP error status=%s body=%s",
                exc.response.status_code,
                exc.response.text[:200],
            )
        except Exception as exc:
            logger.warning(
                "[NHI][CLIENT] search — unexpected error: %s",
                str(exc)[:200],
            )
        return {"results": [], "query": drug_name}

    async def ask(self, question: str) -> Dict[str, Any]:
        """Call NHI module's POST /ask endpoint for RAG-generated answer.

        Args:
            question: Natural language query (may include indication context).

        Returns:
            Dict with key ``answer`` (str). On failure, returns ``{"answer": ""}``.
        """
        payload = {"question": question}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(f"{self.base_url}/ask", json=payload)
                resp.raise_for_status()
                return resp.json()
        except httpx.ConnectError as exc:
            logger.warning(
                "[NHI][CLIENT] ask — service unreachable base_url=%s err=%s",
                self.base_url,
                str(exc)[:200],
            )
        except httpx.TimeoutException as exc:
            logger.warning(
                "[NHI][CLIENT] ask — timeout base_url=%s err=%s",
                self.base_url,
                str(exc)[:200],
            )
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "[NHI][CLIENT] ask — HTTP error status=%s body=%s",
                exc.response.status_code,
                exc.response.text[:200],
            )
        except Exception as exc:
            logger.warning(
                "[NHI][CLIENT] ask — unexpected error: %s",
                str(exc)[:200],
            )
        return {"answer": ""}

    async def health(self) -> bool:
        """Ping the NHI service health endpoint.

        Returns:
            True if the service responds with HTTP 200, False otherwise.
        """
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self.base_url}/health")
                return resp.status_code == 200
        except Exception:
            return False

    # ── Helper — parse reimbursement chunks ────────────────────────────

    @staticmethod
    def parse_chunks(
        raw_results: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Normalise NHI /search result items to a consistent shape.

        The NHI service may return varying field names. We normalise here so
        the router does not need to know the internal schema.

        Returns a list of dicts with keys:
            chunk_id, text, score, section, section_name
        """
        normalised: List[Dict[str, Any]] = []
        for item in raw_results:
            # Support both "id"/"chunk_id" and "score"/"relevance_score"
            chunk_id = str(
                item.get("chunk_id") or item.get("id") or f"nhi_{len(normalised)}"
            )
            text = str(item.get("text") or item.get("content") or "")
            score = float(item.get("score") or item.get("relevance_score") or 0.0)
            section = str(item.get("section") or "")
            section_name = str(item.get("section_name") or "")
            normalised.append(
                {
                    "chunk_id": chunk_id,
                    "text": text,
                    "score": score,
                    "section": section,
                    "section_name": section_name,
                }
            )
        return normalised


# Module-level singleton — import and reuse across requests
nhi_client = NhiClient()
