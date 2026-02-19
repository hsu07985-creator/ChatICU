"""Clinical LLM-powered endpoints (Phase 3)."""

import asyncio
import logging
import uuid
from typing import Any, Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.llm import call_llm
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.patient import Patient
from app.models.user import User
from app.routers.lab_data import lab_to_dict
from app.routers.vital_signs import vital_to_dict
from app.routers.medications import med_to_dict
from app.routers.ventilator import vent_to_dict
from app.schemas.clinical import (
    ClinicalQueryRequest,
    DecisionRequest,
    DoseCalculateRequest,
    ExplanationRequest,
    GuidelineRequest,
    InteractionCheckRequest,
    PolishRequest,
    SummaryRequest,
)
from app.services.evidence_client import evidence_client
from app.services.llm_services.clinical_summary import generate_clinical_summary
from app.services.llm_services.patient_explanation import generate_patient_explanation
from app.services.llm_services.rag_service import rag_service
from app.services.safety_guardrail import apply_safety_guardrail
from app.utils.data_freshness import build_data_freshness
from app.utils.structured_output import (
    build_decision_structured,
    build_explanation_structured,
    build_summary_structured,
)
from app.utils.llm_errors import llm_unavailable_detail
from app.utils.request_context import evidence_trace_kwargs
from app.middleware.rate_limit import limiter
from app.utils.response import success_response

router = APIRouter(prefix="/api/v1/clinical", tags=["Clinical"])

logger = logging.getLogger(__name__)


def _resolve_deterministic_intent(req: ClinicalQueryRequest) -> str:
    raw_intent = (req.intent or "auto").strip().lower()
    if raw_intent in {"dose", "dose_calc", "dose_calculation"}:
        return "dose_calculation"
    if raw_intent in {"interaction", "interactions", "interaction_check"}:
        return "interaction_check"
    if raw_intent in {"knowledge", "knowledge_qa", "rag"}:
        return "knowledge_qa"
    if req.drug:
        return "dose_calculation"
    if req.drug_list and len(req.drug_list) >= 2:
        return "interaction_check"
    return "knowledge_qa"


async def _deterministic_clinical_query_fallback(
    req: ClinicalQueryRequest,
    request: Request,
    *,
    reason: str,
) -> Dict[str, Any]:
    trace = evidence_trace_kwargs(request)
    request_id = trace.get("request_id") or f"cq_fb_{uuid.uuid4().hex[:8]}"
    resolved_intent = _resolve_deterministic_intent(req)
    patient_context = req.patient_context.model_dump(exclude_none=True) if req.patient_context else None

    result: Dict[str, Any] = {
        "request_id": request_id,
        "intent": resolved_intent,
        "status": "degraded",
        "result_type": resolved_intent,
        "confidence": 0.0,
        "warnings": [
            "INTENT_ROUTER_DEGRADED: upstream clinical_query unavailable, switched to deterministic fallback.",
            f"fallback_reason={reason}",
            f"fallback_intent={resolved_intent}",
        ],
        "rag": None,
        "dose_result": None,
        "interaction_result": None,
        "citations": [],
        "fallback": {
            "applied": True,
            "strategy": "deterministic",
            "reason": reason,
            "resolved_intent": resolved_intent,
        },
    }

    if resolved_intent == "dose_calculation":
        if not req.drug:
            result["warnings"].append("Dose fallback requires drug; switched to knowledge_qa.")
            result["intent"] = "knowledge_qa"
            result["result_type"] = "knowledge_qa"
            resolved_intent = "knowledge_qa"
        else:
            try:
                dose_result = await asyncio.to_thread(
                    evidence_client.dose_calculate,
                    drug=req.drug,
                    patient_context=patient_context or {},
                    indication=None,
                    dose_target=req.dose_target,
                    question=req.question,
                    **trace,
                )
                result["status"] = dose_result.get("status", "ok")
                result["confidence"] = float(dose_result.get("confidence") or 0.75)
                result["dose_result"] = dose_result
                result["citations"] = dose_result.get("citations", [])
                return result
            except Exception as exc:
                result["warnings"].append(f"Dose fallback unavailable: {exc.__class__.__name__}")
                result["status"] = "degraded"
                return result

    if resolved_intent == "interaction_check":
        if not req.drug_list or len(req.drug_list) < 2:
            result["warnings"].append("Interaction fallback requires at least two drugs; switched to knowledge_qa.")
            result["intent"] = "knowledge_qa"
            result["result_type"] = "knowledge_qa"
            resolved_intent = "knowledge_qa"
        else:
            try:
                interaction_result = await asyncio.to_thread(
                    evidence_client.interaction_check,
                    drug_list=req.drug_list,
                    patient_context=patient_context,
                    question=req.question,
                    **trace,
                )
                result["status"] = interaction_result.get("status", "ok")
                result["confidence"] = float(interaction_result.get("confidence") or 0.72)
                result["interaction_result"] = interaction_result
                result["citations"] = interaction_result.get("citations", [])
                return result
            except Exception as exc:
                result["warnings"].append(f"Interaction fallback unavailable: {exc.__class__.__name__}")
                result["status"] = "degraded"
                return result

    # knowledge_qa fallback (local RAG query)
    if rag_service.is_indexed:
        rag_result = await asyncio.to_thread(rag_service.query, req.question, 5)
        result["rag"] = rag_result
        result["citations"] = rag_result.get("sources", [])
        result["status"] = "ok" if result["citations"] else "degraded"
        result["confidence"] = 0.65 if result["citations"] else 0.35
        if not result["citations"]:
            result["warnings"].append("Knowledge fallback returned no citations.")
    else:
        result["warnings"].append("Knowledge fallback unavailable: local RAG index not ready.")
        result["status"] = "degraded"
        result["confidence"] = 0.0

    return result

async def _get_patient_dict(patient_id: str, db: AsyncSession) -> dict:
    """Fetch patient + related clinical data from DB for LLM consumption."""
    result = await db.execute(
        select(Patient)
        .options(
            selectinload(Patient.lab_data),
            selectinload(Patient.vital_signs),
            selectinload(Patient.medications),
            selectinload(Patient.ventilator_settings),
        )
        .where(Patient.id == patient_id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id} not found")

    # Base patient fields
    patient_dict: Dict[str, Any] = {
        "id": patient.id,
        "name": patient.name,
        "age": patient.age,
        "gender": patient.gender,
        "diagnosis": patient.diagnosis,
        "symptoms": patient.symptoms or [],
        "sedation": patient.sedation or [],
        "analgesia": patient.analgesia or [],
        "nmb": patient.nmb or [],
        "critical_status": patient.critical_status,
        "ventilator_days": patient.ventilator_days,
        "alerts": patient.alerts or [],
        # Additional patient-table fields
        "height": patient.height,
        "weight": patient.weight,
        "bmi": patient.bmi,
        "intubated": patient.intubated,
        "allergies": patient.allergies or [],
        "blood_type": patient.blood_type,
        "attending_physician": patient.attending_physician,
        "department": patient.department,
        "admission_date": patient.admission_date.isoformat() if patient.admission_date else None,
        "icu_admission_date": patient.icu_admission_date.isoformat() if patient.icu_admission_date else None,
        "code_status": patient.code_status,
        "has_dnr": patient.has_dnr,
        "is_isolated": patient.is_isolated,
    }

    # Latest lab data (most recent by timestamp)
    if patient.lab_data:
        latest_lab = sorted(patient.lab_data, key=lambda x: x.timestamp, reverse=True)[0]
        patient_dict["lab_data"] = lab_to_dict(latest_lab)
    else:
        patient_dict["lab_data"] = None

    # Latest vital signs
    if patient.vital_signs:
        latest_vital = sorted(patient.vital_signs, key=lambda x: x.timestamp, reverse=True)[0]
        patient_dict["vital_signs"] = vital_to_dict(latest_vital)
    else:
        patient_dict["vital_signs"] = None

    # Active medications only
    active_meds = [m for m in patient.medications if m.status == "active"]
    patient_dict["medications"] = [med_to_dict(m) for m in active_meds]

    # Latest ventilator settings
    if patient.ventilator_settings:
        latest_vent = sorted(patient.ventilator_settings, key=lambda x: x.timestamp, reverse=True)[0]
        patient_dict["ventilator_settings"] = vent_to_dict(latest_vent)
    else:
        patient_dict["ventilator_settings"] = None

    return patient_dict


@router.post("/summary")
@limiter.limit("10/minute")
async def clinical_summary(
    req: SummaryRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)
    data_freshness = build_data_freshness(patient_data)
    try:
        result = await asyncio.to_thread(generate_clinical_summary, patient_data)
    except RuntimeError as e:
        logger.error("[INTG][AI][API] LLM clinical_summary failed: %s", str(e)[:500])
        raise HTTPException(status_code=503, detail=llm_unavailable_detail())

    raw_summary = result.get("summary", "")
    guardrail = apply_safety_guardrail(raw_summary, user_role=user.role)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="臨床摘要", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"safety_flagged": guardrail["flagged"]},
    )

    structured = build_summary_structured(guardrail["content"])
    return success_response(data={
        "patient_id": req.patient_id,
        "summary": guardrail["content"],
        "summary_structured": structured,
        "metadata": result.get("metadata", {}),
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
        "dataFreshness": data_freshness,
    })


@router.post("/explanation")
@limiter.limit("10/minute")
async def patient_explanation(
    req: ExplanationRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)
    data_freshness = build_data_freshness(patient_data)
    try:
        result = await asyncio.to_thread(
            generate_patient_explanation, patient_data, req.topic, req.reading_level
        )
    except RuntimeError as e:
        logger.error("[INTG][AI][API] LLM patient_explanation failed: %s", str(e)[:500])
        raise HTTPException(status_code=503, detail=llm_unavailable_detail())

    raw_explanation = result.get("explanation", "")
    guardrail = apply_safety_guardrail(raw_explanation, user_role=user.role)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="衛教說明", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"topic": req.topic, "reading_level": req.reading_level, "safety_flagged": guardrail["flagged"]},
    )

    structured = build_explanation_structured(
        guardrail["content"],
        topic=req.topic,
        reading_level=req.reading_level,
    )
    return success_response(data={
        "patient_id": req.patient_id,
        "topic": req.topic,
        "explanation": guardrail["content"],
        "explanation_structured": structured,
        "metadata": result.get("metadata", {}),
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
        "dataFreshness": data_freshness,
    })


@router.post("/guideline")
@limiter.limit("10/minute")
async def guideline_interpretation(
    req: GuidelineRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)
    data_freshness = build_data_freshness(patient_data)

    rag_context = ""
    rag_sources = []
    search_query = f"{req.scenario} {req.guideline_topic or ''}"
    try:
        hybrid = await asyncio.to_thread(
            evidence_client.query,
            search_query,
            5,
            **evidence_trace_kwargs(request),
        )
        rag_context = hybrid.get("answer", "")
        for c in hybrid.get("citations", []):
            rag_sources.append({
                "doc_id": c.get("source_file", c.get("chunk_id", "")),
                "score": c.get("score", 0),
                "category": c.get("topic", ""),
            })
    except Exception as exc:
        logger.warning("[INTG][AI][API][F07] Hybrid RAG failed for guideline_interpretation, falling back to TF-IDF: %s", exc)
        if rag_service.is_indexed:
            results = rag_service.retrieve(search_query, top_k=5)
            rag_context = "\n\n---\n\n".join([r["text"] for r in results])
            rag_sources = [
                {"doc_id": r["doc_id"], "score": r["score"], "category": r["category"]}
                for r in results
            ]

    result = await asyncio.to_thread(
        call_llm,
        task="guideline_interpretation",
        input_data={
            "patient": patient_data,
            "scenario": req.scenario,
            "guideline_topic": req.guideline_topic,
            "guideline_context": rag_context,
        },
    )

    if result.get("status") != "success":
        logger.error("[INTG][AI][API] LLM guideline_interpretation failed: %s", (result.get("content") or "")[:500])
        raise HTTPException(status_code=503, detail=llm_unavailable_detail())

    raw_content = result.get("content", "")
    guardrail = apply_safety_guardrail(raw_content, user_role=user.role)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="指引查詢", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"scenario": req.scenario, "safety_flagged": guardrail["flagged"]},
    )

    return success_response(data={
        "patient_id": req.patient_id,
        "scenario": req.scenario,
        "interpretation": guardrail["content"],
        "sources": rag_sources,
        "metadata": result.get("metadata", {}),
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
        "dataFreshness": data_freshness,
    })


@router.post("/decision")
@limiter.limit("5/minute")
async def multi_agent_decision(
    req: DecisionRequest,
    request: Request,
    user: User = Depends(require_roles("doctor", "admin")),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)
    data_freshness = build_data_freshness(patient_data)

    rag_context = ""
    try:
        hybrid = await asyncio.to_thread(
            evidence_client.query,
            req.question,
            3,
            **evidence_trace_kwargs(request),
        )
        rag_context = hybrid.get("answer", "")
    except Exception as exc:
        logger.warning("[INTG][AI][API][F07] Hybrid RAG failed for multi_agent_decision, falling back to TF-IDF: %s", exc)
        if rag_service.is_indexed:
            results = rag_service.retrieve(req.question, top_k=3)
            rag_context = "\n\n---\n\n".join([r["text"] for r in results])

    result = await asyncio.to_thread(
        call_llm,
        task="multi_agent_decision",
        input_data={
            "patient": patient_data,
            "question": req.question,
            "assessments": req.assessments or [],
            "evidence_context": rag_context,
        },
    )

    if result.get("status") != "success":
        logger.error("[INTG][AI][API] LLM multi_agent_decision failed: %s", (result.get("content") or "")[:500])
        raise HTTPException(status_code=503, detail=llm_unavailable_detail())

    raw_content = result.get("content", "")
    guardrail = apply_safety_guardrail(raw_content, user_role=user.role)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="決策支援", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"question": req.question[:100], "safety_flagged": guardrail["flagged"]},
    )

    structured = build_decision_structured(
        guardrail["content"],
        question=req.question,
        assessments=req.assessments,
    )
    return success_response(data={
        "patient_id": req.patient_id,
        "question": req.question,
        "recommendation": guardrail["content"],
        "decision_structured": structured,
        "metadata": result.get("metadata", {}),
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
        "dataFreshness": data_freshness,
    })


@router.post("/polish")
@limiter.limit("15/minute")
async def polish_clinical_text(
    req: PolishRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)
    data_freshness = build_data_freshness(patient_data)

    result = await asyncio.to_thread(
        call_llm,
        task="clinical_polish",
        input_data={
            "patient": patient_data,
            "draft_content": req.content,
            "polish_type": req.polish_type,
            "user_role": user.role,
        },
    )

    if result.get("status") != "success":
        logger.error("[INTG][AI][API] LLM clinical_polish failed: %s", (result.get("content") or "")[:500])
        raise HTTPException(status_code=503, detail=llm_unavailable_detail())

    raw_content = result.get("content", "")
    guardrail = apply_safety_guardrail(raw_content, user_role=user.role)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="文本修飾", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"polish_type": req.polish_type, "safety_flagged": guardrail["flagged"]},
    )

    return success_response(data={
        "patient_id": req.patient_id,
        "polish_type": req.polish_type,
        "original": req.content,
        "polished": guardrail["content"],
        "metadata": result.get("metadata", {}),
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
        "dataFreshness": data_freshness,
    })


# ── P3-1: Dose Calculation ──────────────────────────────────────────────

@router.post("/dose")
@limiter.limit("10/minute")
async def dose_calculate(
    req: DoseCalculateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Calculate drug dosage via the Evidence RAG deterministic rule engine."""
    try:
        result = await asyncio.to_thread(
            evidence_client.dose_calculate,
            drug=req.drug,
            patient_context=req.patient_context.model_dump(exclude_none=True),
            indication=req.indication,
            dose_target=req.dose_target,
            **evidence_trace_kwargs(request),
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Evidence engine service unavailable. Please start the func/ service and try again.",
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Evidence engine error: upstream returned {e.response.status_code}",
        )

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="劑量計算", target=req.drug, status="success",
        ip=request.client.host if request.client else None,
        details={"drug": req.drug, "status": result.get("status")},
    )

    return success_response(data=result)


# ── P3-2: Drug Interaction Check ────────────────────────────────────────

@router.post("/interactions")
@limiter.limit("10/minute")
async def interaction_check(
    req: InteractionCheckRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check drug-drug interactions via the Evidence RAG rule engine."""
    pc = req.patient_context.model_dump(exclude_none=True) if req.patient_context else None
    try:
        result = await asyncio.to_thread(
            evidence_client.interaction_check,
            drug_list=req.drug_list,
            patient_context=pc,
            **evidence_trace_kwargs(request),
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Evidence engine service unavailable. Please start the func/ service and try again.",
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Evidence engine error: upstream returned {e.response.status_code}",
        )

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="交互作用查詢", target=",".join(req.drug_list[:5]), status="success",
        ip=request.client.host if request.client else None,
        details={"drug_count": len(req.drug_list), "overall_severity": result.get("overall_severity")},
    )

    return success_response(data=result)


# ── P3-3: Clinical Query with Intent Routing ────────────────────────────

@router.post("/clinical-query")
@limiter.limit("10/minute")
async def clinical_query(
    req: ClinicalQueryRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unified clinical query — auto-routes to RAG / dose / interaction / hybrid."""
    pc = req.patient_context.model_dump(exclude_none=True) if req.patient_context else None
    fallback_applied = False
    fallback_reason = None
    try:
        result = await asyncio.to_thread(
            evidence_client.clinical_query,
            question=req.question,
            intent=req.intent,
            drug=req.drug,
            drug_list=req.drug_list,
            patient_context=pc,
            dose_target=req.dose_target,
            **evidence_trace_kwargs(request),
        )
        if not isinstance(result, dict):
            fallback_applied = True
            fallback_reason = "invalid_upstream_payload"
            result = await _deterministic_clinical_query_fallback(
                req,
                request,
                reason=fallback_reason,
            )
        else:
            result.setdefault(
                "fallback",
                {
                    "applied": False,
                    "strategy": None,
                    "reason": None,
                    "resolved_intent": result.get("intent"),
                },
            )
    except (httpx.ConnectError, httpx.HTTPStatusError, httpx.ReadTimeout) as exc:
        fallback_applied = True
        if isinstance(exc, httpx.HTTPStatusError):
            fallback_reason = f"upstream_http_{exc.response.status_code}"
        else:
            fallback_reason = exc.__class__.__name__
        logger.warning(
            "[INTG][AI][API][AO-05] clinical_query fallback triggered reason=%s intent=%s question=%s",
            fallback_reason,
            req.intent,
            req.question[:120],
        )
        result = await _deterministic_clinical_query_fallback(
            req,
            request,
            reason=fallback_reason,
        )
    except Exception as exc:
        fallback_applied = True
        fallback_reason = f"unexpected_{exc.__class__.__name__}"
        logger.warning(
            "[INTG][AI][API][AO-05] clinical_query unexpected error, fallback applied reason=%s question=%s",
            fallback_reason,
            req.question[:120],
        )
        result = await _deterministic_clinical_query_fallback(
            req,
            request,
            reason=fallback_reason,
        )

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="臨床查詢", target=req.question[:50], status="success" if not fallback_applied else "degraded",
        ip=request.client.host if request.client else None,
        details={
            "intent": result.get("intent"),
            "status": result.get("status"),
            "fallback_applied": fallback_applied,
            "fallback_reason": fallback_reason,
        },
    )

    return success_response(data=result)
