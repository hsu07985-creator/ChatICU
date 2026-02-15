from typing import Optional

from pydantic import BaseModel


class VitalSignResponse(BaseModel):
    id: str
    patientId: str
    timestamp: str
    heartRate: Optional[int] = None
    bloodPressure: Optional[dict] = None
    respiratoryRate: Optional[int] = None
    spo2: Optional[int] = None
    temperature: Optional[float] = None
    referenceRanges: Optional[dict] = None

    model_config = {"from_attributes": True}
