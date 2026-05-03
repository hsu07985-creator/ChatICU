from typing import List, Optional
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TeamChatMessage(Base):
    __tablename__ = "team_chat_messages"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(
        String(50), ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    user_name: Mapped[str] = mapped_column(String(100))
    user_role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned_by: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # {userId, userName}
    pinned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Reply threading. The DB has a self-referencing FK (migration 015) with
    # ON DELETE SET NULL — declare it on the model so ORM-only test fixtures
    # respect it too. TC-B12 closed the schema-vs-model drift.
    reply_to_id: Mapped[Optional[str]] = mapped_column(
        String(50),
        ForeignKey("team_chat_messages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Read tracking
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    read_by: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)

    # Role mentions
    mentioned_roles: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)

    # Per-user mentions (Path B): list of user.id strings
    mentioned_user_ids: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)

    # @所有人 — dynamic mention. Anyone except the author counts as a
    # recipient when this is True; new users joining later still see it
    # as @ them. Stored separately from mentioned_user_ids so the row
    # doesn't snapshot a stale user list at send time.
    mentions_all: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Soft delete (TC-B11). Admin DELETE writes deleted_at + deleted_by_id
    # instead of removing the row, so the audit trail and any reply-quote
    # references survive. List queries filter deleted_at IS NULL.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    deleted_by_id: Mapped[Optional[str]] = mapped_column(
        String(50),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    user_rel = relationship(
        "User",
        back_populates="chat_messages",
        foreign_keys=[user_id],
    )
