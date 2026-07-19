from pydantic import BaseModel, Field


class CompatibilityFavoriteCreate(BaseModel):
    drugA: str = Field(..., min_length=1, max_length=200)
    drugB: str = Field(..., min_length=1, max_length=200)
    solution: str = Field("none", max_length=20)



# ── B2 batch 4 response schemas ──────────────────────────────────────────────

from datetime import datetime as _datetime
from typing import Any as _Any, Optional as _Optional

from pydantic import field_validator as _field_validator

from app.schemas.base import CamelModel as _CamelModel


class PharmacyAdviceResponse(_CamelModel):
    id: str
    patient_id: _Optional[str] = None
    patient_name: _Optional[str] = None
    bed_number: _Optional[str] = None
    advice_code: _Optional[str] = None
    advice_label: _Optional[str] = None
    category: _Optional[str] = None
    content: _Optional[str] = None
    pharmacist_name: _Optional[str] = None
    timestamp: _Optional[_datetime] = None
    linked_medications: list = []
    accepted: _Optional[bool] = None
    responded_by_id: _Optional[str] = None
    responded_by_name: _Optional[str] = None
    responded_at: _Optional[_datetime] = None

    @_field_validator("linked_medications", mode="before")
    @classmethod
    def _none_to_list(cls, v):
        return v or []


class CompatibilityFavoriteResponse(_CamelModel):
    id: str
    drug_a: _Optional[str] = None
    drug_b: _Optional[str] = None
    solution: _Optional[str] = None
    created_at: _Optional[_datetime] = None


class ErrorReportResponse(_CamelModel):
    id: str
    patient_id: _Optional[str] = None
    reporter_id: _Optional[str] = None
    reporter_name: _Optional[str] = None
    reporter_role: _Optional[str] = None
    error_type: _Optional[str] = None
    severity: _Optional[str] = None
    medication_name: _Optional[str] = None
    description: _Optional[str] = None
    action_taken: _Optional[str] = None
    status: _Optional[str] = None
    reviewed_by: _Optional[dict] = None
    resolution: _Optional[str] = None
    timestamp: _Optional[_datetime] = None


class IVCompatibilityRowResponse(_CamelModel):
    id: _Any = None
    drug1: _Optional[str] = None
    drug2: _Optional[str] = None
    solution: _Optional[str] = None
    compatible: _Optional[bool] = None
    time_stability: _Optional[str] = None
    notes: _Optional[str] = None
    references: _Optional[str] = None


class DrugInteractionRowResponse(_CamelModel):
    id: _Any = None
    drug1: _Optional[str] = None
    drug2: _Optional[str] = None
    severity: _Optional[str] = None
    mechanism: _Optional[str] = None
    clinical_effect: _Optional[str] = None
    management: _Optional[str] = None
    references: _Optional[str] = None
    risk_rating: _Optional[str] = None
    risk_rating_description: _Optional[str] = None
    severity_label: _Optional[str] = None
    reliability_rating: _Optional[str] = None
    route_dependency: _Optional[str] = None
    discussion: _Optional[str] = None
    footnotes: _Optional[str] = None
    dependencies: list = []
    dependency_types: list = []
    interacting_members: list = []
    pubmed_ids: list = []

    @_field_validator(
        "dependencies", "dependency_types", "interacting_members", "pubmed_ids",
        mode="before",
    )
    @classmethod
    def _json_field_to_list(cls, v):
        # 鏡射 _parse_json_field:str(JSON) 或 list 或 None → list
        if v is None:
            return []
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            import json
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, list) else []
            except Exception:
                return []
        return []


class PharmacySoapRecordResponse(_CamelModel):
    """patientName 由 wrapper 依參數附加。"""
    id: str
    patient_id: _Optional[str] = None
    bed_number: _Optional[str] = None
    pharmacist_id: _Optional[str] = None
    pharmacist_name: _Optional[str] = None
    subjective: str = ""
    objective: str = ""
    assessment: str = ""
    plan: str = ""
    polished_content: str = ""
    created_at: _Optional[_datetime] = None
    updated_at: _Optional[_datetime] = None

    @_field_validator(
        "subjective", "objective", "assessment", "plan", "polished_content",
        mode="before",
    )
    @classmethod
    def _none_to_empty(cls, v):
        return v or ""
