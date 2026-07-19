from datetime import date, datetime
from typing import List, Optional

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
    symptoms: Optional[List[str]] = None
    intubated: bool = False
    intubation_date: Optional[date] = None
    tracheostomy: bool = False
    tracheostomy_date: Optional[date] = None
    critical_status: Optional[str] = None
    sedation: Optional[List[str]] = None
    analgesia: Optional[List[str]] = None
    nmb: Optional[List[str]] = None
    admission_date: Optional[date] = None
    icu_admission_date: Optional[date] = None
    ventilator_days: int = 0
    attending_physician: Optional[str] = None
    department: Optional[str] = None
    unit: Optional[str] = None
    alerts: Optional[List[str]] = None
    consent_status: Optional[str] = None
    allergies: Optional[List[str]] = None
    blood_type: Optional[str] = None
    code_status: Optional[str] = None
    has_dnr: bool = False
    is_isolated: bool = False


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    bed_number: Optional[str] = None
    medical_record_number: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    diagnosis: Optional[str] = None
    intubated: Optional[bool] = None
    intubation_date: Optional[date] = None
    tracheostomy: Optional[bool] = None
    tracheostomy_date: Optional[date] = None
    critical_status: Optional[str] = None
    sedation: Optional[List[str]] = None
    analgesia: Optional[List[str]] = None
    nmb: Optional[List[str]] = None
    admission_date: Optional[date] = None
    icu_admission_date: Optional[date] = None
    ventilator_days: Optional[int] = None
    attending_physician: Optional[str] = None
    department: Optional[str] = None
    alerts: Optional[List[str]] = None
    code_status: Optional[str] = None
    has_dnr: Optional[bool] = None
    is_isolated: Optional[bool] = None
    symptoms: Optional[List[str]] = None
    allergies: Optional[List[str]] = None
    blood_type: Optional[str] = None
    consent_status: Optional[str] = None


class PatientArchiveUpdate(BaseModel):
    archived: bool
    reason: Optional[str] = None
    discharge_type: Optional[str] = None
    discharge_date: Optional[str] = None  # ISO date string (YYYY-MM-DD)


