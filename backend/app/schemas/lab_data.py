from typing import Optional

from pydantic import BaseModel


class LabCorrectionRequest(BaseModel):
    category: str
    item: str
    correctedValue: float
    reason: Optional[str] = None


class LabDataResponse(BaseModel):
    id: str
    patientId: str
    timestamp: str
    biochemistry: Optional[dict] = None
    hematology: Optional[dict] = None
    bloodGas: Optional[dict] = None
    inflammatory: Optional[dict] = None
    coagulation: Optional[dict] = None
    corrections: Optional[list] = None

    model_config = {"from_attributes": True}
