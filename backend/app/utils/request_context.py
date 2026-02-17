"""Request-scoped tracing helpers."""

from __future__ import annotations

import uuid

from fastapi import Request


def request_id_from_request(request: Request) -> str:
    return (
        getattr(request.state, "request_id", None)
        or request.headers.get("X-Request-ID")
        or uuid.uuid4().hex[:12]
    )


def trace_id_from_request(request: Request) -> str:
    return (
        getattr(request.state, "trace_id", None)
        or request.headers.get("X-Trace-ID")
        or request_id_from_request(request)
    )


def evidence_trace_kwargs(request: Request) -> dict[str, str]:
    """Return kwargs expected by EvidenceClient methods."""
    request_id = request_id_from_request(request)
    trace_id = trace_id_from_request(request)
    return {"request_id": request_id, "trace_id": trace_id}
