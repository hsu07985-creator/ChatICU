from typing import Optional
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))  # nurse, doctor, admin, pharmacist
    unit: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    audit_logs = relationship("AuditLog", back_populates="user_rel")
    chat_messages = relationship("TeamChatMessage", back_populates="user_rel")
    password_history = relationship(
        "PasswordHistory", back_populates="user_rel",
        order_by="PasswordHistory.created_at.desc()",
    )


class PasswordHistory(Base):
    __tablename__ = "password_history"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("users.id"), index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user_rel = relationship("User", back_populates="password_history")
