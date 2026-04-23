"""SQLAlchemy model for per-patient precomputed duplicate-detection alerts.

Matches docs/duplicate-medication-integration-plan.md §5.1. Reads are keyed by
``patient_id`` (one row per patient); cache validity is decided by hashing
sorted ``(medication_id, atc_code, updated_at)`` tuples and comparing against
``medications_hash``.

``counts`` holds the severity histogram (``{"critical": 2, "high": 1, ...}``)
so dashboard / batch queries do not have to parse ``alerts_json``.
"""
from datetime import datetime

from typing import Optional
from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MedicationDuplicateCache(Base):
    __tablename__ = "medication_duplicate_cache"
    __table_args__ = (
        Index("ix_medication_duplicate_cache_computed_at", "computed_at"),
    )

    patient_id: Mapped[str] = mapped_column(
        String(50),
        ForeignKey("patients.id", ondelete="CASCADE"),
        primary_key=True,
    )
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    medications_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    alerts_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # inpatient | outpatient | icu | discharge
    context: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    counts: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True, default=dict)
