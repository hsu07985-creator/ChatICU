from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecordTemplate(Base):
    __tablename__ = "record_templates"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    record_type: Mapped[str] = mapped_column(String(30), index=True)
    role_scope: Mapped[str] = mapped_column(String(20), index=True)
    content: Mapped[str] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_by_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    created_by_name: Mapped[str] = mapped_column(String(100))
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(50), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    updated_by_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
