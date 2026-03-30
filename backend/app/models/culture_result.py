from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CultureResult(Base):
    __tablename__ = "culture_results"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
    )
    sheet_number: Mapped[str] = mapped_column(String(50))
    specimen: Mapped[str] = mapped_column(String(100))
    specimen_code: Mapped[str] = mapped_column(String(20))
    department: Mapped[str] = mapped_column(String(100), default="")
    collected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reported_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    isolates: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    susceptibility: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    patient = relationship("Patient", back_populates="culture_results")
