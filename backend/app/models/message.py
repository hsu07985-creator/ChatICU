from typing import Optional
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PatientMessage(Base):
    __tablename__ = "patient_messages"
    __table_args__ = (
        Index("ix_patient_messages_patient_is_read", "patient_id", "is_read"),
    )

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    patient_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("patients.id", ondelete="RESTRICT"), index=True
    )
    author_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    author_name: Mapped[str] = mapped_column(String(100))
    author_role: Mapped[str] = mapped_column(String(20))
    message_type: Mapped[str] = mapped_column(String(30), default="general")
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    linked_medication: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    advice_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    read_by: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # array of {userId, userName, readAt}
    reply_to_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    reply_count: Mapped[int] = mapped_column(default=0)
    tags: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    mentioned_roles: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    advice_record_id: Mapped[Optional[str]] = mapped_column(
        String(50), ForeignKey("pharmacy_advices.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    patient = relationship("Patient", back_populates="messages")
