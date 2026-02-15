"""Clinical LLM-powered endpoints (Phase 3)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.llm import call_llm
from app.middleware.auth import get_current_user, require_roles
from app.middleware.audit import create_audit_log
from app.models.patient import Patient
from app.models.user import User
from app.schemas.clinical import (
    DecisionRequest,
    ExplanationRequest,
    GuidelineRequest,
    SummaryRequest,
)
from app.services.llm_services.clinical_summary import generate_clinical_summary
from app.services.llm_services.patient_explanation import generate_patient_explanation
from app.services.llm_services.rag_service import rag_service
from app.services.safety_guardrail import apply_safety_guardrail
from app.utils.response import success_response

router = APIRouter(prefix="/api/v1/clinical", tags=["Clinical"])


async def _get_patient_dict(patient_id: str, db: AsyncSession) -> dict:
    """Fetch patient from DB and convert to dict for LLM consumption."""
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id} not found")
    return {
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
    }


@router.post("/summary")
async def clinical_summary(
    req: SummaryRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)
    result = await asyncio.to_thread(generate_clinical_summary, patient_data)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="臨床摘要", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
    )

    return success_response(data=result)


@router.post("/explanation")
async def patient_explanation(
    req: ExplanationRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)
    result = await asyncio.to_thread(
        generate_patient_explanation, patient_data, req.topic
    )

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="衛教說明", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"topic": req.topic},
    )

    return success_response(data=result)


@router.post("/guideline")
async def guideline_interpretation(
    req: GuidelineRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)

    rag_context = ""
    rag_sources = []
    if rag_service.is_indexed:
        search_query = f"{req.scenario} {req.guideline_topic or ''}"
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

    raw_content = result.get("content", "")
    guardrail = apply_safety_guardrail(raw_content)

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
    })


@router.post("/decision")
async def multi_agent_decision(
    req: DecisionRequest,
    request: Request,
    user: User = Depends(require_roles("doctor", "admin")),
    db: AsyncSession = Depends(get_db),
):
    patient_data = await _get_patient_dict(req.patient_id, db)

    rag_context = ""
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

    raw_content = result.get("content", "")
    guardrail = apply_safety_guardrail(raw_content)

    await create_audit_log(
        db, user_id=user.id, user_name=user.name, role=user.role,
        action="決策支援", target=req.patient_id, status="success",
        ip=request.client.host if request.client else None,
        details={"question": req.question[:100], "safety_flagged": guardrail["flagged"]},
    )

    return success_response(data={
        "patient_id": req.patient_id,
        "question": req.question,
        "recommendation": guardrail["content"],
        "metadata": result.get("metadata", {}),
        "safetyWarnings": guardrail["warnings"] if guardrail["flagged"] else None,
    })
