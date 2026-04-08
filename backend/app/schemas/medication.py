from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel


class MedicationCreate(BaseModel):
    name: str
    genericName: Optional[str] = None
    category: Optional[str] = None
    sanCategory: Optional[Literal["S", "A", "N"]] = None
    dose: Optional[str] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    prn: bool = False
    indication: Optional[str] = None
    startDate: Optional[date] = None
    concentration: Optional[str] = None
    concentrationUnit: Optional[str] = None


class MedicationUpdate(BaseModel):
    dose: Optional[str] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    status: Optional[str] = None
    endDate: Optional[date] = None
    sanCategory: Optional[Literal["S", "A", "N"]] = None
    concentration: Optional[str] = None
    concentrationUnit: Optional[str] = None
    notes: Optional[str] = None


class MedicationResponse(BaseModel):
    id: str
    patientId: str
    name: str
    genericName: Optional[str] = None
    category: Optional[str] = None
    sanCategory: Optional[Literal["S", "A", "N"]] = None
    dose: Optional[str] = None
    unit: Optional[str] = None
    concentration: Optional[str] = None
    concentrationUnit: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    prn: bool = False
    indication: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    status: str = "active"
    prescribedBy: Optional[dict] = None
    warnings: Optional[List[str]] = None
    notes: Optional[str] = None
    # Outpatient source fields (048)
    sourceType: str = "inpatient"
    sourceCampus: Optional[str] = None
    prescribingHospital: Optional[str] = None
    prescribingDepartment: Optional[str] = None
    prescribingDoctorName: Optional[str] = None
    daysSupply: Optional[int] = None
    isExternal: bool = False

    model_config = {"from_attributes": True}


class MedicationAdministrationUpdate(BaseModel):
    status: Literal["scheduled", "administered", "missed", "held", "refused"]
    notes: Optional[str] = None


class MedicationAdministrationUser(BaseModel):
    id: str
    name: str


class MedicationAdministrationResponse(BaseModel):
    id: str
    medicationId: str
    patientId: str
    scheduledTime: datetime
    administeredTime: Optional[datetime] = None
    status: Literal["scheduled", "administered", "missed", "held", "refused"]
    dose: str
    route: str
    administeredBy: Optional[MedicationAdministrationUser] = None
    notes: Optional[str] = None


class MedicationAdministrationItemEnvelope(BaseModel):
    success: Literal[True] = True
    data: MedicationAdministrationResponse
    message: Optional[str] = None


class MedicationAdministrationListEnvelope(BaseModel):
    success: Literal[True] = True
    data: List[MedicationAdministrationResponse]
    message: Optional[str] = None


# ─── Outpatient Import (048) ───────────────────────────

class OutpatientMedicationItem(BaseModel):
    name: str
    genericName: Optional[str] = None
    dose: Optional[str] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    indication: Optional[str] = None
    startDate: Optional[date] = None
    endDate: Optional[date] = None
    sourceCampus: Optional[str] = None
    prescribingHospital: Optional[str] = None
    prescribingDepartment: Optional[str] = None
    prescribingDoctorName: Optional[str] = None
    daysSupply: Optional[int] = None
    isExternal: bool = False


class OutpatientImportRequest(BaseModel):
    medications: List[OutpatientMedicationItem]
