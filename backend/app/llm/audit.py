"""audit.py — Observability / raw-capture helpers for ``app.llm``.

Provider-agnostic plumbing: trace-id normalization, payload fingerprinting,
safe model serialization, and the opt-in raw provider-response capture used
for AI audit (``LLM_AUDIT_CAPTURE_RAW``).
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger("chaticu")


def _normalize_trace_value(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _fingerprint_payload(payload: Any) -> str:
    try:
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    except Exception:
        body = str(payload)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _model_dump_safe(payload: Any) -> Any:
    if payload is None:
        return None
    if hasattr(payload, "model_dump"):
        try:
            return payload.model_dump()
        except Exception:
            pass
    if hasattr(payload, "to_dict"):
        try:
            return payload.to_dict()
        except Exception:
            pass
    try:
        return json.loads(json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:
        return str(payload)


def _capture_dir_path() -> Path:
    raw = str(settings.LLM_AUDIT_CAPTURE_DIR or "").strip()
    default_rel = "reports/operations/llm_raw_capture"
    path = Path(raw or default_rel).expanduser()
    if path.is_absolute():
        return path
    # repo_root: backend/app/llm/audit.py → parents[3] == repo root
    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / path


def _maybe_capture_provider_raw(
    *,
    provider: str,
    task: str,
    model: str,
    request_id: str | None,
    trace_id: str | None,
    input_payload: Any,
    response_payload: Any,
) -> None:
    if not settings.LLM_AUDIT_CAPTURE_RAW:
        return

    try:
        capture_dir = _capture_dir_path()
        capture_dir.mkdir(parents=True, exist_ok=True)
        captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        rid = request_id or "no_request_id"
        tid = trace_id or rid
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"{stamp}_{provider}_{task}_{rid[:20]}.json"
        target = capture_dir / filename
        payload = {
            "captured_at": captured_at,
            "provider": provider,
            "model": model,
            "task": task,
            "request_id": request_id,
            "trace_id": trace_id,
            "input_fingerprint": _fingerprint_payload(input_payload),
            "response_raw": _model_dump_safe(response_payload),
        }
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(
            "[INTG][AI][AUDIT] provider_raw_captured path=%s request_id=%s trace_id=%s task=%s",
            str(target),
            rid,
            tid,
            task,
        )
    except Exception:
        logger.warning("[INTG][AI][AUDIT] provider raw capture failed", exc_info=True)
