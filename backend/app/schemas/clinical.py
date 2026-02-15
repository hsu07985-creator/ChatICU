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


class GuidelineRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    scenario: str = Field(..., min_length=1, max_length=2000)
    guideline_topic: Optional[str] = Field(None, max_length=500)


class DecisionRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    question: str = Field(..., min_length=1, max_length=2000)
    assessments: Optional[List[dict]] = None


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


# ─── AI Chat ─────────────────────────────────────────

class AIChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    sessionId: Optional[str] = Field(None, max_length=50)
    patientId: Optional[str] = Field(None, max_length=50)
