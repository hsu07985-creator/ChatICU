from typing import Optional
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TeamChatMessage(Base):
    __tablename__ = "team_chat_messages"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("users.id"), index=True
    )
    user_name: Mapped[str] = mapped_column(String(100))
    user_role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned_by: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # {userId, userName}
    pinned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user_rel = relationship("User", back_populates="chat_messages")
