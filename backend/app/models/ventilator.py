from typing import Optional
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class VentilatorSetting(Base):
    __tablename__ = "ventilator_settings"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    mode: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    fio2: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    peep: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tidal_volume: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    respiratory_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    inspiratory_pressure: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pressure_support: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ie_ratio: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    pip: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    plateau: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    compliance: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    resistance: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="ventilator_settings")


class WeaningAssessment(Base):
    __tablename__ = "weaning_assessments"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    rsbi: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    nif: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    vt: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rr: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    spo2: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fio2: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    peep: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    gcs: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cough_strength: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    secretions: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    hemodynamic_stability: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    recommendation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    readiness_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    assessed_by: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="weaning_assessments")
