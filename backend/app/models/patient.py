from typing import Optional
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Patient(Base):
    __tablename__ = "patients"
    __table_args__ = (
        CheckConstraint("age >= 0 AND age <= 200", name="ck_patients_age_range"),
        CheckConstraint("gender IN ('M','F','Other','男','女')", name="ck_patients_gender_valid"),
        CheckConstraint("ventilator_days >= 0", name="ck_patients_ventilator_days_gte0"),
    )

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    bed_number: Mapped[str] = mapped_column(String(20), index=True)
    medical_record_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    age: Mapped[int] = mapped_column(Integer)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    gender: Mapped[str] = mapped_column(String(10))
    height: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bmi: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    diagnosis: Mapped[str] = mapped_column(String(500))
    symptoms: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of strings
    intubated: Mapped[bool] = mapped_column(Boolean, default=False)
    tracheostomy: Mapped[bool] = mapped_column(Boolean, default=False)
    # intubation_date lives in DB (migration 056) but accessed via raw SQL
    # to avoid async lazy-load issues with deferred columns
    # tracheostomy_date follows the same pattern.
    critical_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    sedation: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of strings
    analgesia: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of strings
    nmb: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of strings
    admission_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    icu_admission_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    ventilator_days: Mapped[int] = mapped_column(Integer, default=0)
    attending_physician: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    department: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    # Care unit / ward (used for data-level access control). Separate from department.
    unit: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    alerts: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of strings
    consent_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    allergies: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of strings
    blood_type: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    code_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    has_dnr: Mapped[bool] = mapped_column(Boolean, default=False)
    is_isolated: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    discharge_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    discharge_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    discharge_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    campus: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 院區
    last_update: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    medications = relationship("Medication", back_populates="patient")
    medication_administrations = relationship(
        "MedicationAdministration",
        back_populates="patient",
        cascade="all, delete-orphan",
    )
    lab_data = relationship("LabData", back_populates="patient")
    vital_signs = relationship("VitalSign", back_populates="patient")
    ventilator_settings = relationship("VentilatorSetting", back_populates="patient")
    weaning_assessments = relationship("WeaningAssessment", back_populates="patient")
    messages = relationship("PatientMessage", back_populates="patient")
    culture_results = relationship("CultureResult", back_populates="patient")
    symptom_records = relationship("SymptomRecord", back_populates="patient")
