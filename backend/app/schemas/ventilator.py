from datetime import datetime
from typing import Optional

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
