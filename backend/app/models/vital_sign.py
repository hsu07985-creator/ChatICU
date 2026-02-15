from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class VitalSign(Base):
    __tablename__ = "vital_signs"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    heart_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    systolic_bp: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    diastolic_bp: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    mean_bp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    respiratory_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    spo2: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reference_ranges: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="vital_signs")
