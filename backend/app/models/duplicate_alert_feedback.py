"""SQLAlchemy model for pharmacist/clinician action trail on duplicate alerts.

Feeds the KPI dashboard described in
docs/duplicate-medication-detection-implementation-plan.md §4.1 /
§10.3 (acceptance rate, override reasons, modified counts).

``alert_fingerprint`` is a SHA256 over the sorted medication-id list that
produced the alert, so identical recommendations on the same patient can be
grouped across recomputations.
"""
from typing import Optional
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DuplicateAlertFeedback(Base):
    __tablename__ = "duplicate_alert_feedback"
    __table_args__ = (
        CheckConstraint(
            "action IN ('accepted','overridden','modified','dismissed')",
            name="ck_duplicate_alert_feedback_action",
        ),
        Index(
            "ix_duplicate_alert_feedback_patient_created",
            "patient_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id"), nullable=False
    )
    alert_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    override_reason: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    pharmacist_id: Mapped[Optional[str]] = mapped_column(
        String(50), ForeignKey("users.id"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
