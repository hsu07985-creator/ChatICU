from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DiagnosticReport(Base):
    __tablename__ = "diagnostic_reports"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
    )
    report_type: Mapped[str] = mapped_column(String(50))  # imaging / procedure / other
    exam_name: Mapped[str] = mapped_column(String(200))
    exam_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    body_text: Mapped[str] = mapped_column(Text)
    impression: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reporter_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="final")  # preliminary / final
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    patient = relationship("Patient", backref="diagnostic_reports")
