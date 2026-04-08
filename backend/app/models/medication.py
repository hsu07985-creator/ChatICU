from typing import Optional
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Medication(Base):
    __tablename__ = "medications"
    __table_args__ = (
        CheckConstraint("status IN ('active','inactive','discontinued','completed','on-hold')", name="ck_medications_status_valid"),
    )

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    generic_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    san_category: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)  # S, A, N
    dose: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    frequency: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    route: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    prn: Mapped[bool] = mapped_column(Boolean, default=False)
    indication: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, inactive, discontinued, completed, on-hold
    prescribed_by: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # {id, name}
    warnings: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of strings
    concentration: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    concentration_unit: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="medications")
    administrations = relationship(
        "MedicationAdministration",
        back_populates="medication",
        cascade="all, delete-orphan",
    )
