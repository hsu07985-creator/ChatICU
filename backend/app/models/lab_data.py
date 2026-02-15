from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LabData(Base):
    __tablename__ = "lab_data"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    biochemistry: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    hematology: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    blood_gas: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    inflammatory: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    coagulation: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    corrections: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of correction records
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="lab_data")
