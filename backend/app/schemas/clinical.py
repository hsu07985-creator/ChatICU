"""Pydantic schemas for clinical, RAG, rules, and AI chat endpoints."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ─── Clinical ─────────────────────────────────────────

class SummaryRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    include_labs: bool = True


class ExplanationRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    topic: str = Field("", max_length=500)
    reading_level: Optional[str] = Field(
        None,
        pattern=r"^(simple|moderate|detailed)$",
    )


class GuidelineRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    scenario: str = Field(..., min_length=1, max_length=2000)
    guideline_topic: Optional[str] = Field(None, max_length=500)


class DecisionRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    question: str = Field(..., min_length=1, max_length=2000)
    assessments: Optional[List[dict]] = None


class PolishRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1, max_length=10000)
    polish_type: str = Field(
        ...,
        pattern=r"^(progress_note|medication_advice|nursing_record|pharmacy_advice)$",
    )
    template_content: Optional[str] = Field(None, max_length=5000)
    # Refinement loop: when both are provided, the LLM rewrites `previous_polished`
    # according to `instruction`, still grounded in the original `content` (draft).
    instruction: Optional[str] = Field(None, max_length=2000)
    previous_polished: Optional[str] = Field(None, max_length=10000)


# ─── RAG ──────────────────────────────────────────────

class RAGQueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(5, ge=1, le=20)


class RAGIndexRequest(BaseModel):
    docs_path: Optional[str] = Field(None, max_length=500)


# ─── Rules ────────────────────────────────────────────

class CKDStageRequest(BaseModel):
    egfr: float = Field(..., ge=0, le=200)
    age: Optional[int] = Field(None, ge=0, le=150)
    has_proteinuria: bool = False


# ─── Dose Calculation (P3-1) ──────────────────────────

class PatientContext(BaseModel):
    age_years: Optional[float] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    sex: Optional[str] = None
    crcl_ml_min: Optional[float] = None
    hepatic_class: Optional[str] = None
    sbp_mmHg: Optional[float] = None
    hr_bpm: Optional[float] = None
    rr_bpm: Optional[float] = None
    qtc_ms: Optional[float] = None
    k_mmol_l: Optional[float] = None
    mg_mmol_l: Optional[float] = None


class DoseCalculateRequest(BaseModel):
    drug: str = Field(..., min_length=2, max_length=200)
    indication: Optional[str] = Field(None, max_length=500)
    patient_context: PatientContext
    dose_target: Optional[dict] = None


# ─── Interaction Check (P3-2) ────────────────────────

class InteractionCheckRequest(BaseModel):
    drug_list: List[str] = Field(..., min_length=2)
    patient_context: Optional[PatientContext] = None


# ─── Clinical Query (P3-3) ───────────────────────────

class ClinicalQueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    intent: str = Field("auto", max_length=30)
    drug: Optional[str] = Field(None, max_length=200)
    drug_list: Optional[List[str]] = None
    patient_context: Optional[PatientContext] = None
    dose_target: Optional[dict] = None


# ─── Unified Citation (B11) ───────────────────────────

class UnifiedCitationItem(BaseModel):
    citation_id: str = ""
    source_system: str = ""
    source_file: Optional[str] = None
    text_snippet: str = ""
    evidence_grade: str = "unknown"
    relevance_score: float = 0.0
    drug_names: List[str] = Field(default_factory=list)


# ─── Unified Query (B07) ─────────────────────────────

class UnifiedQueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    patient_id: Optional[int] = None
    context: Optional[str] = Field(None, max_length=5000)



# ─── AI Chat ─────────────────────────────────────────

class AIChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    sessionId: Optional[str] = Field(None, max_length=50)
    patientId: Optional[str] = Field(None, max_length=50)
