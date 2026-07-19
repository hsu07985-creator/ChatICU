from datetime import datetime
from typing import Optional

from pydantic import field_validator

from app.schemas.base import CamelModel


class SymptomRecordResponse(CamelModel):
    id: str
    patient_id: str
    recorded_at: Optional[datetime] = None
    symptoms: list = []
    recorded_by: Optional[dict] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    @field_validator("symptoms", mode="before")
    @classmethod
    def _none_to_list(cls, v):
        return v or []
