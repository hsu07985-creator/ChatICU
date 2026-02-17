"""HTTP client for the Evidence RAG microservice (func/).

Wraps calls to the func/ FastAPI service running on FUNC_API_URL.
All methods are synchronous — callers should wrap with asyncio.to_thread().
Falls back gracefully when the service is unavailable.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = settings.FUNC_API_TIMEOUT  # configurable via env (F12)
_RETRY_COUNT = settings.FUNC_API_RETRY_COUNT
_RETRY_BACKOFF = settings.FUNC_API_RETRY_BACKOFF_SECONDS


class EvidenceClient:
    """Thin HTTP wrapper for func/ Evidence RAG API."""

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.FUNC_API_URL).rstrip("/")

    def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Execute HTTP request with bounded retry/backoff for transient failures."""
        max_attempts = max(1, _RETRY_COUNT + 1)
        for attempt in range(1, max_attempts + 1):
            try:
                if method == "GET":
                    resp = httpx.get(url, timeout=_TIMEOUT, headers=headers)
                else:
                    resp = httpx.post(url, json=payload or {}, timeout=_TIMEOUT, headers=headers)
                resp.raise_for_status()
                return resp.json()
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as exc:
                is_last = attempt == max_attempts
                logger.warning(
                    "[INTG][AI][API] Evidence %s transient failure attempt=%d/%d url=%s err=%s",
                    method,
                    attempt,
                    max_attempts,
                    url,
                    str(exc)[:200],
                )
                if is_last:
                    raise
                time.sleep(_RETRY_BACKOFF * (2 ** (attempt - 1)))
            except httpx.HTTPStatusError as exc:
                logger.warning(
                    "[INTG][AI][API] Evidence service error method=%s status=%s url=%s body=%s",
                    method,
                    exc.response.status_code,
                    url,
                    exc.response.text[:200],
                )
                raise

    @staticmethod
    def _build_trace_headers(
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, str]:
        """Normalize optional request/trace IDs into outbound headers."""
        rid = (request_id or "").strip()
        tid = (trace_id or "").strip()
        if not rid and not tid:
            return {}
        if not rid:
            rid = tid
        if not tid:
            tid = rid
        return {
            "X-Request-ID": rid,
            "X-Trace-ID": tid,
        }

    def _post(
        self,
        path: str,
        json: Dict[str, Any],
        *,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST to func/ and return parsed JSON."""
        url = f"{self.base_url}{path}"
        return self._request_with_retry(
            "POST",
            url,
            payload=json,
            headers=self._build_trace_headers(request_id=request_id, trace_id=trace_id),
        )

    def _get(
        self,
        path: str,
        *,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """GET from func/ and return parsed JSON."""
        url = f"{self.base_url}{path}"
        return self._request_with_retry(
            "GET",
            url,
            headers=self._build_trace_headers(request_id=request_id, trace_id=trace_id),
        )

    # ── Health ──

    def health(
        self,
        *,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._get("/health", request_id=request_id, trace_id=trace_id)

    # ── RAG Query (P2-5) ──

    def query(
        self,
        question: str,
        top_k: int = 8,
        topic_filter: Optional[List[str]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Query the hybrid RAG engine. Returns answer + citations."""
        return self._post(
            "/query",
            {
                "question": question,
                "top_k": top_k,
                "topic_filter": topic_filter,
            },
            request_id=request_id,
            trace_id=trace_id,
        )

    def source_by_chunk_id(
        self,
        chunk_id: str,
        *,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch a source chunk (including original chunk text) by chunk_id."""
        safe_chunk_id = str(chunk_id or "").strip()
        if not safe_chunk_id:
            return {}
        return self._get(
            f"/sources/{safe_chunk_id}",
            request_id=request_id,
            trace_id=trace_id,
        )

    # ── Dose Calculation (P3-1) ──

    def dose_calculate(
        self,
        drug: str,
        patient_context: Dict[str, Any],
        indication: Optional[str] = None,
        dose_target: Optional[Dict[str, Any]] = None,
        question: Optional[str] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Calculate drug dosage via deterministic rule engine."""
        payload: Dict[str, Any] = {
            "drug": drug,
            "patient_context": patient_context,
        }
        if indication:
            payload["indication"] = indication
        if dose_target:
            payload["dose_target"] = dose_target
        if question:
            payload["question"] = question
        return self._post(
            "/dose/calculate",
            payload,
            request_id=request_id,
            trace_id=trace_id,
        )

    # ── Interaction Check (P3-2) ──

    def interaction_check(
        self,
        drug_list: List[str],
        patient_context: Optional[Dict[str, Any]] = None,
        question: Optional[str] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Check drug-drug interactions."""
        payload: Dict[str, Any] = {"drug_list": drug_list}
        if patient_context:
            payload["patient_context"] = patient_context
        if question:
            payload["question"] = question
        return self._post(
            "/interactions/check",
            payload,
            request_id=request_id,
            trace_id=trace_id,
        )

    # ── Clinical Query with intent routing (P3-3) ──

    def clinical_query(
        self,
        question: str,
        intent: str = "auto",
        drug: Optional[str] = None,
        drug_list: Optional[List[str]] = None,
        patient_context: Optional[Dict[str, Any]] = None,
        dose_target: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Unified clinical query with LLM-based intent routing."""
        payload: Dict[str, Any] = {
            "question": question,
            "intent": intent,
        }
        if drug:
            payload["drug"] = drug
        if drug_list:
            payload["drug_list"] = drug_list
        if patient_context:
            payload["patient_context"] = patient_context
        if dose_target:
            payload["dose_target"] = dose_target
        return self._post(
            "/clinical/query",
            payload,
            request_id=request_id,
            trace_id=trace_id,
        )

    # ── Ingest ──

    def ingest(
        self,
        source_dir: Optional[str] = None,
        *,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if source_dir:
            payload["source_dir"] = source_dir
        return self._post(
            "/ingest",
            payload,
            request_id=request_id,
            trace_id=trace_id,
        )


# Module-level singleton
evidence_client = EvidenceClient()
