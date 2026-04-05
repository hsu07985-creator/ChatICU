from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SymptomRecord(Base):
    __tablename__ = "symptom_records"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    symptoms: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    recorded_by: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="symptom_records")
