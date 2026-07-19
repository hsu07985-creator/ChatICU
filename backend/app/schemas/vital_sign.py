from datetime import datetime
from typing import Optional

from app.schemas.base import CamelModel

# Reference ranges shipped with every vital-sign payload (frontend renders
# the min/max bands). Keys are the camelCase payload field names.
REFERENCE_RANGES = {
    "temperature": {"min": 36.0, "max": 37.5, "unit": "°C"},
    "heartRate": {"min": 60, "max": 100, "unit": "bpm"},
    "systolicBP": {"min": 90, "max": 140, "unit": "mmHg"},
    "diastolicBP": {"min": 60, "max": 90, "unit": "mmHg"},
    "respiratoryRate": {"min": 12, "max": 20, "unit": "breaths/min"},
    "spo2": {"min": 95, "max": 100, "unit": "%"},
    "bodyWeight": {"min": 30, "max": 150, "unit": "kg"},
}


class BloodPressure(CamelModel):
    systolic: Optional[int] = None
    diastolic: Optional[int] = None
    mean: Optional[float] = None


class VitalSignResponse(CamelModel):
    id: str
    patient_id: str
    timestamp: Optional[datetime] = None
    heart_rate: Optional[int] = None
    blood_pressure: BloodPressure
    respiratory_rate: Optional[int] = None
    spo2: Optional[int] = None
    temperature: Optional[float] = None
    etco2: Optional[float] = None
    cvp: Optional[float] = None
    icp: Optional[float] = None
    cpp: Optional[float] = None
    body_weight: Optional[float] = None
    reference_ranges: dict = REFERENCE_RANGES

    @classmethod
    def from_model(cls, vs) -> "VitalSignResponse":
        return cls(
            id=vs.id,
            patient_id=vs.patient_id,
            timestamp=vs.timestamp,
            heart_rate=vs.heart_rate,
            blood_pressure=BloodPressure(
                systolic=vs.systolic_bp,
                diastolic=vs.diastolic_bp,
                mean=vs.mean_bp,
            ),
            respiratory_rate=vs.respiratory_rate,
            spo2=vs.spo2,
            temperature=vs.temperature,
            etco2=vs.etco2,
            cvp=vs.cvp,
            icp=vs.icp,
            cpp=vs.cpp,
            body_weight=vs.body_weight,
        )
