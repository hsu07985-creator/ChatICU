from typing import Optional
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class VentilatorSetting(Base):
    __tablename__ = "ventilator_settings"
    __table_args__ = (
        CheckConstraint("fio2 IS NULL OR (fio2 >= 21 AND fio2 <= 100)", name="ck_ventilator_fio2_range"),
    )

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="ventilator_settings")


class WeaningAssessment(Base):
    __tablename__ = "weaning_assessments"
    __table_args__ = (
        CheckConstraint("readiness_score IS NULL OR (readiness_score >= 0 AND readiness_score <= 100)", name="ck_weaning_readiness_range"),
    )

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="weaning_assessments")
