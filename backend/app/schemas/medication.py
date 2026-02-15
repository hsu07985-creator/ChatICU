from datetime import date
from typing import Any, Optional

from pydantic import BaseModel


class MedicationCreate(BaseModel):
    name: str
    genericName: Optional[str] = None
    category: Optional[str] = None
    sanCategory: Optional[str] = None
    dose: Optional[str] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    prn: bool = False
    indication: Optional[str] = None
    startDate: Optional[date] = None


class MedicationUpdate(BaseModel):
    dose: Optional[str] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    status: Optional[str] = None
    endDate: Optional[date] = None


class MedicationResponse(BaseModel):
    id: str
    patientId: str
    name: str
    genericName: Optional[str] = None
    category: Optional[str] = None
    sanCategory: Optional[str] = None
    dose: Optional[str] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    prn: bool = False
    indication: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    status: str = "active"
    prescribedBy: Optional[dict] = None
    warnings: Optional[list[str]] = None

    model_config = {"from_attributes": True}
