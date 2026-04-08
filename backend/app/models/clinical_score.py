from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ClinicalScore(Base):
    __tablename__ = "clinical_scores"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="CASCADE"), index=True
    )
    score_type: Mapped[str] = mapped_column(String(20))  # "pain" or "rass"
    value: Mapped[int] = mapped_column(Integer)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recorded_by: Mapped[str] = mapped_column(String(50))
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("ix_clinical_scores_patient_type_ts", "patient_id", "score_type", "timestamp"),
    )
