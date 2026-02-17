"""API schemas for evidence-first RAG."""

from __future__ import annotations

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    source_dir: str | None = None
    recursive: bool = True
    parser: str = "mineru"


class IngestResponse(BaseModel):
    status: str
    files_total: int
    files_success: int
    files_failed: int
    chunks_total: int
    report_path: str


class QueryRequest(BaseModel):
    question: str = Field(min_length=3)
    top_k: int = Field(default=8, ge=1, le=30)
    topic_filter: list[str] | None = None


class CitationOut(BaseModel):
    citation_id: str
    chunk_id: str
    source_file: str
    page: int
    topic: str
    score: float
    snippet: str


class QueryResponse(BaseModel):
    answer: str
    confidence: float
    refusal: bool
    refusal_reason: str = ""
    citations: list[CitationOut]
    evidence_snippets: list[dict]
    debug: dict


class SourceChunkResponse(BaseModel):
    chunk_id: str
    source_file: str
    page: int
    topic: str
    text: str
    metadata: dict


class PatientContext(BaseModel):
    age_years: float | None = None
    weight_kg: float | None = None
    sex: str | None = None
    crcl_ml_min: float | None = None
    hepatic_class: str | None = None
    sbp_mmHg: float | None = None
    hr_bpm: float | None = None
    rr_bpm: float | None = None
    qtc_ms: float | None = None
    k_mmol_l: float | None = None
    mg_mmol_l: float | None = None


class DoseCalculateRequest(BaseModel):
    request_id: str | None = None
    drug: str = Field(min_length=2)
    indication: str | None = None
    patient_context: PatientContext
    dose_target: dict = Field(default_factory=dict)
    question: str | None = None
    top_k: int = Field(default=8, ge=1, le=30)
    topic_filter: list[str] | None = None


class DoseCalculateResponse(BaseModel):
    request_id: str
    status: str
    result_type: str
    drug: str | None = None
    error_code: str | None = None
    message: str | None = None
    computed_values: dict = Field(default_factory=dict)
    calculation_steps: list[str] = Field(default_factory=list)
    applied_rules: list[dict] = Field(default_factory=list)
    safety_warnings: list[str] = Field(default_factory=list)
    citations: list[dict] = Field(default_factory=list)
    confidence: float = 0.0
    rag: dict | None = None


class InteractionCheckRequest(BaseModel):
    request_id: str | None = None
    drug_list: list[str] = Field(min_length=2)
    patient_context: PatientContext | None = None
    question: str | None = None
    top_k: int = Field(default=8, ge=1, le=30)
    topic_filter: list[str] | None = None


class InteractionCheckResponse(BaseModel):
    request_id: str
    status: str
    result_type: str
    overall_severity: str
    findings: list[dict] = Field(default_factory=list)
    applied_rules: list[dict] = Field(default_factory=list)
    citations: list[dict] = Field(default_factory=list)
    conflicts: list[dict] = Field(default_factory=list)
    confidence: float = 0.0
    rag: dict | None = None


class ClinicalQueryRequest(BaseModel):
    request_id: str | None = None
    intent: str = "auto"
    question: str | None = None
    drug: str | None = None
    indication: str | None = None
    drug_list: list[str] | None = None
    patient_context: PatientContext | None = None
    dose_target: dict | None = None
    top_k: int = Field(default=8, ge=1, le=30)
    topic_filter: list[str] | None = None


class ClinicalQueryResponse(BaseModel):
    request_id: str
    intent: str
    status: str
    result_type: str
    confidence: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    rag: dict | None = None
    dose_result: dict | None = None
    interaction_result: dict | None = None
    citations: list[dict] = Field(default_factory=list)
