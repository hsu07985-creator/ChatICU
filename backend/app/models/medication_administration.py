from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MedicationAdministration(Base):
    __tablename__ = "medication_administrations"
    __table_args__ = (
        CheckConstraint("status IN ('administered','scheduled','held','missed','refused')", name="ck_med_admins_status_valid"),
    )

    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    medication_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("medications.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    scheduled_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    administered_time: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    dose: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    route: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    administered_by: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True
    )  # {id, name}
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    medication = relationship("Medication", back_populates="administrations")
    patient = relationship("Patient", back_populates="medication_administrations")
