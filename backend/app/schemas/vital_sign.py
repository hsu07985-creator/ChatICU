from datetime import datetime
from typing import Any, Optional, Sequence

from pydantic import Field

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
    field_timestamps: dict[str, datetime] = Field(default_factory=dict)

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

    @classmethod
    def from_models(cls, signs: Sequence[Any]) -> "VitalSignResponse":
        """Compose the newest non-null value for each metric from newest-first rows."""
        latest = signs[0]
        fields = (
            ("heart_rate", "heartRate", "his"),
            ("systolic_bp", "systolicBP", "his"),
            ("diastolic_bp", "diastolicBP", "his"),
            ("mean_bp", "meanBP", "his"),
            ("respiratory_rate", "respiratoryRate", "his"),
            ("spo2", "spo2", "manual"),
            ("temperature", "temperature", "his"),
            ("etco2", "etco2", "manual"),
            ("cvp", "cvp", "manual"),
            ("icp", "icp", "manual"),
            ("cpp", "cpp", "manual"),
            ("body_weight", "bodyWeight", "his"),
        )
        values: dict[str, Any] = {}
        timestamps: dict[str, datetime] = {}
        for sign in signs:
            source = "his" if sign.id.startswith("vit_") else "manual"
            for model_field, payload_field, owner in fields:
                if source != owner:
                    continue
                if model_field in values:
                    continue
                value = getattr(sign, model_field)
                if value is not None:
                    values[model_field] = value
                    timestamps[payload_field] = sign.timestamp
            if len(values) == len(fields):
                break

        return cls(
            id=latest.id,
            patient_id=latest.patient_id,
            timestamp=latest.timestamp,
            heart_rate=values.get("heart_rate"),
            blood_pressure=BloodPressure(
                systolic=values.get("systolic_bp"),
                diastolic=values.get("diastolic_bp"),
                mean=values.get("mean_bp"),
            ),
            respiratory_rate=values.get("respiratory_rate"),
            spo2=values.get("spo2"),
            temperature=values.get("temperature"),
            etco2=values.get("etco2"),
            cvp=values.get("cvp"),
            icp=values.get("icp"),
            cpp=values.get("cpp"),
            body_weight=values.get("body_weight"),
            field_timestamps=timestamps,
        )
