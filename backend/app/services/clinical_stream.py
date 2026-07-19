"""SSE generators for /api/v1/clinical/{summary,polish}/stream(B3 下沉)。

從 app.routers.clinical 原樣搬入。router 保留請求前置(病人資料組裝、
授權 sub-gate、envelope 構造),本模組負責 LLM 串流→frame→guardrail→
done payload→audit。Request 僅作 is_disconnected 資料依賴。
"""
from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Dict, Optional

from fastapi import Request

from app.config import settings
from app.llm import call_llm_stream
from app.models.user import User
from app.schemas.clinical import PolishRequest, SummaryRequest
from app.services.clinical_support import (
    _build_polish_response_data,
    _extract_json_string_value,
    _polish_input_sha256,
)
from app.services.safety_guardrail import apply_safety_guardrail
from app.utils.audit_async import schedule_audit_log
from app.utils.sse import done_frame, format_sse
from app.utils.structured_output import build_summary_structured

logger = logging.getLogger(__name__)


async def summary_event_stream(
    *,
    req: SummaryRequest,
    request: Request,
    user: User,
    request_id: Optional[str],
    trace_id: Optional[str],
    client_host: Optional[str],
    user_msg: list,
    data_freshness: Any,
    summary_disable_reasoning: bool,
) -> AsyncGenerator[str, None]:
    full_content = ""
    usage_meta: Dict[str, Any] = {}
    stream_model: str = settings.LLM_MODEL
    stream_failed = False
    client_disconnected = False

    # P1-C5: error frames carry trace_id so support can cross-reference
    # without parsing log files.
    def _err_payload(message: str) -> str:
        return json.dumps({
            "message": message,
            "request_id": request_id,
            "trace_id": trace_id,
        })

    try:
        async for chunk in call_llm_stream(
            "clinical_summary",
            user_msg,
            request_id=request_id,
            trace_id=trace_id,
            disable_reasoning=summary_disable_reasoning,
        ):
            # P1-C6: short-circuit if the client closed the tab. Without
            # this, OpenAI keeps reasoning to completion and we pay the
            # full token cost while the user sees nothing.
            if await request.is_disconnected():
                client_disconnected = True
                logger.info(
                    "[INTG][AI][API] clinical_summary stream aborted: client disconnected (request_id=%s)",
                    request_id,
                )
                return
            if chunk.startswith("{") and "__done__" in chunk:
                try:
                    meta = json.loads(chunk)
                    usage_meta = meta.get("usage", {}) or {}
                    stream_model = meta.get("model") or stream_model
                except Exception:
                    pass
                break
            if chunk.startswith("[ERROR]"):
                err = chunk[7:].strip() if len(chunk) > 7 else "AI service error"
                logger.error("[INTG][AI][API] clinical_summary stream failed: %s", err[:500])
                stream_failed = True
                yield format_sse(_err_payload(err), event="error")
                return
            full_content += chunk
            yield format_sse({"chunk": chunk}, event="delta")
    except Exception as e:
        logger.error("[INTG][AI][API] clinical_summary stream exception: %s", str(e)[:500])
        yield format_sse(_err_payload(str(e)), event="error")
        return

    if stream_failed or client_disconnected:
        return

    guardrail = apply_safety_guardrail(full_content, user_role=user.role, include_disclaimer=False)
    structured = build_summary_structured(guardrail["content"])
    response_data: Dict[str, Any] = {
        "patient_id": req.patient_id,
        "summary": guardrail["content"],
        "summary_structured": structured,
        "metadata": {"model": stream_model, "usage": usage_meta},
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
        "dataFreshness": data_freshness,
        # P1-C5: surface trace ids in done payload too so the toast can
        # show them on partial-success warnings.
        "request_id": request_id,
        "trace_id": trace_id,
    }

    yield done_frame({"data": response_data})

    schedule_audit_log(
        user_id=user.id, user_name=user.name, role=user.role,
        action="臨床摘要", target=req.patient_id, status="success",
        ip=client_host,
        details={"safety_flagged": guardrail["flagged"], "streamed": True},
    )


async def polish_event_stream(
    *,
    req: PolishRequest,
    request: Request,
    user: User,
    request_id: Optional[str],
    trace_id: Optional[str],
    client_host: Optional[str],
    user_msg: list,
    data_freshness: Any,
    task_name: str,
    is_pharmacist: bool,
    is_refinement: bool,
    disable_reasoning: bool,
    pharmacist_target: Optional[str],
) -> AsyncGenerator[str, None]:
    section_emitted_len = 0
    full_content = ""
    usage_meta: Dict[str, Any] = {}
    stream_model: str = settings.LLM_MODEL
    stream_failed = False
    client_disconnected = False

    # P1-C5: error frames carry trace_id + request_id for support cross-ref.
    def _err_payload(message: str) -> str:
        return json.dumps({
            "message": message,
            "request_id": request_id,
            "trace_id": trace_id,
        })

    try:
        async for chunk in call_llm_stream(
            task_name,
            user_msg,
            disable_reasoning=disable_reasoning,
            request_id=request_id,
            trace_id=trace_id,
            model_override=settings.LLM_LIGHT_MODEL if req.polish_mode == "grammar_only" else None,
        ):
            # P1-C6: stop the LLM stream if the client closed the tab.
            if await request.is_disconnected():
                client_disconnected = True
                logger.info(
                    "[INTG][AI][API] polish stream aborted: client disconnected (request_id=%s)",
                    request_id,
                )
                return
            if chunk.startswith("{") and "__done__" in chunk:
                try:
                    meta = json.loads(chunk)
                    usage_meta = meta.get("usage", {}) or {}
                    stream_model = meta.get("model") or stream_model
                except Exception:
                    pass
                break
            if chunk.startswith("[ERROR]"):
                err = chunk[7:].strip() if len(chunk) > 7 else "AI service error"
                logger.error("[INTG][AI][API] polish stream failed: %s", err[:500])
                stream_failed = True
                yield format_sse(_err_payload(err), event="error")
                return
            full_content += chunk
            yield format_sse({"chunk": chunk}, event="delta")

            # For pharmacist target-section polish, also emit a clean
            # decoded delta so the frontend doesn't have to scan JSON.
            if pharmacist_target is not None:
                section_text = _extract_json_string_value(full_content, pharmacist_target)
                if section_text is not None and len(section_text) > section_emitted_len:
                    new_chars = section_text[section_emitted_len:]
                    section_emitted_len = len(section_text)
                    yield format_sse(
                        {"key": pharmacist_target, "chunk": new_chars},
                        event="section_delta",
                    )
    except Exception as e:
        logger.error("[INTG][AI][API] polish stream exception: %s", str(e)[:500])
        yield format_sse(_err_payload(str(e)), event="error")
        return

    if stream_failed or client_disconnected:
        return

    response_data, guardrail = _build_polish_response_data(
        req,
        task_name=task_name,
        is_pharmacist=is_pharmacist,
        raw_content=full_content,
        usage_meta=usage_meta,
        model=stream_model,
        user_role=user.role,
        data_freshness=data_freshness,
    )

    yield done_frame({"data": response_data})

    schedule_audit_log(
        user_id=user.id, user_name=user.name, role=user.role,
        action="文本修飾" + ("（再修飾）" if is_refinement else ""),
        target=req.patient_id, status="success",
        ip=client_host,
        details={
            "task": task_name,
            "polish_type": req.polish_type,
            "polish_mode": req.polish_mode,
            "target_section": req.target_section,
            "safety_flagged": guardrail["flagged"],
            "refinement": is_refinement,
            "input_sha256": _polish_input_sha256(req),
            "streamed": True,
        },
    )
