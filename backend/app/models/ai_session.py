from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AISession(Base):
    __tablename__ = "ai_sessions"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    patient_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    messages = relationship("AIMessage", back_populates="session", cascade="all, delete-orphan")


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("ai_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))  # user, assistant
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    suggested_actions: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    token_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    session = relationship("AISession", back_populates="messages")
