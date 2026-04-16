"""Pydantic schemas for clinical, RAG, rules, and AI chat endpoints."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


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
    # `content` is the legacy single-textarea draft. Allow empty when pharmacist_polish
    # is used with `soap_sections` (S/O/A/P split inputs).
    content: str = Field("", max_length=10000)
    polish_type: str = Field(
        ...,
        pattern=r"^(progress_note|medication_advice|nursing_record|pharmacy_advice)$",
    )
    template_content: Optional[str] = Field(None, max_length=5000)
    # Refinement loop: when both are provided, the LLM rewrites `previous_polished`
    # according to `instruction`, still grounded in the original `content` (draft).
    instruction: Optional[str] = Field(None, max_length=2000)
    previous_polished: Optional[str] = Field(None, max_length=10000)

    # ── Pharmacist SOAP polish fields (Phase 1) ──
    # Routes to TASK_PROMPTS["pharmacist_polish"] in llm.py when task="pharmacist_polish".
    task: Optional[Literal["clinical_polish", "pharmacist_polish"]] = "clinical_polish"
    # Single mode enum replaces the old (grammar_only XOR refinement) conflict.
    # - full: apply polish_type format rules (P bullets, drug notation, etc.)
    # - grammar_only: fix grammar/spelling/translation only; zero content delta
    # - refinement: baseline = previous_polished, apply instruction, KEEP format rules
    polish_mode: Optional[
        Literal["full", "grammar_only", "refinement"]
    ] = "full"
    # SOAP sections for split-textarea input. Keys: s, o, a, p. Empty strings allowed.
    soap_sections: Optional[Dict[str, str]] = None
    # Which section(s) to polish. When None and soap_sections given, polishes a+p only.
    target_section: Optional[Literal["a", "p", "a_and_p", "all"]] = None
    # Extra format knobs, e.g. {"drug_notation": "brand_generic_dose_freq",
    # "monitor_line_required": true, "bullets_required": true}.
    format_constraints: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def _require_input(self) -> "PolishRequest":
        # Reject an empty call: legacy callers must send `content`; pharmacist
        # callers must send at least one non-empty soap_sections value.
        has_content = bool((self.content or "").strip())
        has_soap = bool(
            self.soap_sections
            and any((v or "").strip() for v in self.soap_sections.values())
        )
        # Refinement flow is also a valid input (baseline = previous_polished).
        has_refinement = bool(
            (self.previous_polished or "").strip()
            and (self.instruction or "").strip()
        )
        if not (has_content or has_soap or has_refinement):
            raise ValueError(
                "PolishRequest requires one of: content, soap_sections, or "
                "(previous_polished + instruction)."
            )
        return self


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
