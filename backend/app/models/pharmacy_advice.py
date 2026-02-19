from typing import Optional, List
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PharmacyAdvice(Base):
    __tablename__ = "pharmacy_advices"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="CASCADE"), index=True
    )
    patient_name: Mapped[str] = mapped_column(String(100))
    bed_number: Mapped[str] = mapped_column(String(20))
    pharmacist_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    pharmacist_name: Mapped[str] = mapped_column(String(100))
    advice_code: Mapped[str] = mapped_column(String(10))  # e.g. '1-4', '2-1'
    advice_label: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(50))  # '1. 建議處方', etc.
    content: Mapped[str] = mapped_column(Text)
    linked_medications: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
