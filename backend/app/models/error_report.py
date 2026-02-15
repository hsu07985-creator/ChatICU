from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ErrorReport(Base):
    __tablename__ = "error_reports"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    reporter_id: Mapped[str] = mapped_column(String(50), index=True)
    reporter_name: Mapped[str] = mapped_column(String(100))
    reporter_role: Mapped[str] = mapped_column(String(20))
    error_type: Mapped[str] = mapped_column(String(50))
    severity: Mapped[str] = mapped_column(String(20))  # low, medium, high, critical
    medication_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    action_taken: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, reviewing, resolved, closed
    reviewed_by: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
