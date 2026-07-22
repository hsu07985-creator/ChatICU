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
    indication: Optional[str] = None
    warnings: Optional[List[str]] = None
    prescribingHospital: Optional[str] = None


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


from datetime import date as _date
from typing import Optional as _Optional

from pydantic import field_validator as _field_validator

from app.schemas.base import CamelModel as _CamelModel


class MedicationResponse(_CamelModel):
    """B2 batch 3:med_to_dict 的單一事實來源(clinical/pharmacy 共用)。"""
    id: str
    patient_id: str
    name: _Optional[str] = None
    generic_name: _Optional[str] = None
    order_code: _Optional[str] = None
    nhi_code: _Optional[str] = None
    category: _Optional[str] = None
    san_category: _Optional[str] = None
    dose: _Optional[str] = None
    unit: _Optional[str] = None
    frequency: _Optional[str] = None
    route: _Optional[str] = None
    prn: _Optional[bool] = None
    indication: _Optional[str] = None
    start_date: _Optional[_date] = None
    end_date: _Optional[_date] = None
    status: _Optional[str] = None
    prescribed_by: _Optional[dict] = None
    warnings: list = []
    notes: _Optional[str] = None
    concentration: _Optional[str] = None
    concentration_unit: _Optional[str] = None
    source_type: str = "inpatient"
    source_campus: _Optional[str] = None
    prescribing_hospital: _Optional[str] = None
    prescribing_department: _Optional[str] = None
    prescribing_doctor_name: _Optional[str] = None
    days_supply: _Optional[int] = None
    is_external: bool = False
    atc_code: _Optional[str] = None
    is_antibiotic: bool = False
    kidney_relevant: _Optional[bool] = None
    coding_source: _Optional[str] = None
    source_details: _Optional[dict] = None

    @_field_validator("warnings", mode="before")
    @classmethod
    def _none_to_list(cls, v):
        return v or []

    @_field_validator("source_type", mode="before")
    @classmethod
    def _default_inpatient(cls, v):
        return v or "inpatient"

    @_field_validator("is_external", "is_antibiotic", mode="before")
    @classmethod
    def _none_to_false(cls, v):
        return bool(v)

    @_field_validator("san_category", mode="before")
    @classmethod
    def _normalize_san(cls, v):
        # 鏡射 routers.medications.normalize_san_category(避免循環 import)
        if v is None:
            return None
        n = str(v).strip().upper()
        return n if n in {"S", "A", "N"} else None


from datetime import datetime as _datetime2


class MedicationAdministrationRowResponse(_CamelModel):
    """B2 batch 4:administration_to_dict。"""
    id: str
    medication_id: _Optional[str] = None
    patient_id: _Optional[str] = None
    scheduled_time: _Optional[_datetime2] = None
    administered_time: _Optional[_datetime2] = None
    status: _Optional[str] = None
    dose: str = ""
    route: str = ""
    administered_by: _Optional[dict] = None
    notes: _Optional[str] = None

    @_field_validator("dose", "route", mode="before")
    @classmethod
    def _none_to_empty(cls, v):
        return v or ""
