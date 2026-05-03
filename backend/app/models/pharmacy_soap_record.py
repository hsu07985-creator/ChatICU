"""Pharmacist SOAP records — TC-FU-T2.

Persists the structured SOAP draft a pharmacist composes via
``pharmacist-soap-editor.tsx``. Before this model the editor only copied the
composed text to the clipboard for HIS, leaving the pharmacist no way to
re-read what they wrote inside ChatICU. This row is a flat snapshot of S /
O / A / P plus the polished concatenation, scoped per-pharmacist (mirrors
the pattern used by ``PharmacyAdvice``).

Notes
-----
* ``pharmacist_id`` uses ``ON DELETE SET NULL`` so deleting a user does not
  cascade-delete their historical SOAPs (regulatory / audit preference).
* ``pharmacist_name`` is denormalised so the row remains readable even if
  the user is later soft-deleted / renamed.
* No ORM ``relationship()`` to ``User`` to avoid back-populates collisions
  with the existing ``User.chat_messages`` / ``User.audit_logs`` setup
  (W4-T3 ``deleted_by_id`` lesson).
"""

from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PharmacySoapRecord(Base):
    __tablename__ = "pharmacy_soap_records"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
    )
    pharmacist_id: Mapped[Optional[str]] = mapped_column(
        String(50),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    pharmacist_name: Mapped[str] = mapped_column(String(100))
    subjective: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    objective: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    assessment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    plan: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    polished_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bed_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index(
            "ix_pharmacy_soap_records_pharmacist_created",
            "pharmacist_id",
            "created_at",
        ),
        Index(
            "ix_pharmacy_soap_records_patient_created",
            "patient_id",
            "created_at",
        ),
    )
