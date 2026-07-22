from datetime import datetime
from typing import Optional

from pydantic import Field

from app.schemas.base import CamelModel


class VentilatorSettingResponse(CamelModel):
    id: str
    patient_id: str
    timestamp: Optional[datetime] = None
    mode: Optional[str] = None
    fio2: Optional[int] = None
    peep: Optional[int] = None
    tidal_volume: Optional[int] = None
    respiratory_rate: Optional[int] = None
    inspiratory_pressure: Optional[int] = None
    pressure_support: Optional[int] = None
    ie_ratio: Optional[str] = None
    pip: Optional[int] = None
    plateau: Optional[int] = None
    compliance: Optional[int] = None
    resistance: Optional[int] = None


class WeaningAssessmentResponse(CamelModel):
    id: str
    patient_id: str
    timestamp: Optional[datetime] = None
    rsbi: Optional[int] = None
    nif: Optional[int] = None
    vt: Optional[int] = None
    rr: Optional[int] = None
    spo2: Optional[int] = None
    fio2: Optional[int] = None
    peep: Optional[int] = None
    gcs: Optional[int] = None
    cough_strength: Optional[str] = None
    secretions: Optional[str] = None
    hemodynamic_stability: Optional[bool] = None
    recommendation: Optional[str] = None
    readiness_score: Optional[int] = None
    assessed_by: Optional[dict] = None


class WeaningAssessmentCreate(CamelModel):
    rsbi: Optional[int] = Field(default=None, ge=0, le=500)
    nif: Optional[int] = Field(default=None, ge=-200, le=0)
    vt: Optional[int] = Field(default=None, ge=0, le=3000)
    rr: Optional[int] = Field(default=None, ge=0, le=100)
    spo2: Optional[int] = Field(default=None, ge=0, le=100)
    fio2: Optional[int] = Field(default=None, ge=21, le=100)
    peep: Optional[int] = Field(default=None, ge=0, le=40)
    gcs: Optional[int] = Field(default=None, ge=3, le=15)
    cough_strength: Optional[str] = Field(default=None, max_length=20)
    secretions: Optional[str] = Field(default=None, max_length=20)
    hemodynamic_stability: Optional[bool] = None
    recommendation: Optional[str] = Field(default=None, max_length=1000)
    readiness_score: Optional[int] = Field(default=None, ge=0, le=100)
