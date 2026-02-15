from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel


class PatientBase(BaseModel):
    name: str
    bed_number: str
    medical_record_number: str
    age: int
    gender: str
    diagnosis: str


class PatientCreate(PatientBase):
    height: Optional[float] = None
    weight: Optional[float] = None
    intubated: bool = False
    critical_status: Optional[str] = None
    admission_date: Optional[date] = None
    icu_admission_date: Optional[date] = None
    attending_physician: Optional[str] = None
    department: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    bed_number: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    diagnosis: Optional[str] = None
    intubated: Optional[bool] = None
    critical_status: Optional[str] = None
    sedation: Optional[list[str]] = None
    analgesia: Optional[list[str]] = None
    nmb: Optional[list[str]] = None
    ventilator_days: Optional[int] = None
    attending_physician: Optional[str] = None
    department: Optional[str] = None
    alerts: Optional[list[str]] = None
    code_status: Optional[str] = None
    has_dnr: Optional[bool] = None
    is_isolated: Optional[bool] = None


class PatientResponse(BaseModel):
    id: str
    name: str
    bedNumber: str
    medicalRecordNumber: str
    age: int
    gender: str
    height: Optional[float] = None
    weight: Optional[float] = None
    bmi: Optional[float] = None
    diagnosis: str
    symptoms: Optional[list[str]] = None
    intubated: bool
    criticalStatus: Optional[str] = None
    sedation: Optional[list[Any]] = None
    analgesia: Optional[list[Any]] = None
    nmb: Optional[list[Any]] = None
    admissionDate: Optional[str] = None
    icuAdmissionDate: Optional[str] = None
    ventilatorDays: int = 0
    attendingPhysician: Optional[str] = None
    department: Optional[str] = None
    alerts: Optional[list[str]] = None
    consentStatus: Optional[str] = None
    allergies: Optional[list[str]] = None
    bloodType: Optional[str] = None
    codeStatus: Optional[str] = None
    hasDNR: bool = False
    isIsolated: bool = False
    hasUnreadMessages: bool = False
    lastUpdate: Optional[str] = None

    model_config = {"from_attributes": True}
