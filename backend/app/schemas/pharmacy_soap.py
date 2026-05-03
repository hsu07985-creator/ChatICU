"""Pydantic schemas for the pharmacy SOAP-record endpoints — TC-FU-T2."""
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class PharmacySoapRecordCreate(BaseModel):
    patientId: str = Field(..., min_length=1, max_length=50)
    subjective: Optional[str] = Field(default=None, max_length=20000)
    objective: Optional[str] = Field(default=None, max_length=20000)
    assessment: Optional[str] = Field(default=None, max_length=20000)
    plan: Optional[str] = Field(default=None, max_length=20000)
    polished: Optional[str] = Field(default=None, max_length=80000)

    @model_validator(mode="after")
    def at_least_one_section(self) -> "PharmacySoapRecordCreate":
        if not any(
            (self.subjective or "").strip()
            or (self.objective or "").strip()
            or (self.assessment or "").strip()
            or (self.plan or "").strip()
            or (self.polished or "").strip()
            for _ in [0]
        ):
            raise ValueError("SOAP 至少需要一個段落（S / O / A / P 或 polished）")
        return self
