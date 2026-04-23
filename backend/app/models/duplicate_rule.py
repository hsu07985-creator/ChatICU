"""SQLAlchemy model for duplicate-medication rule overrides.

Represents §3.1 upgrade rules (force severity) and §3.3 whitelist rules
(suppress alert). Seeded from
backend/app/fhir/code_maps/duplicate_rule_overrides.csv via
backend/scripts/seed_duplicate_groups.py.

ATC codes may be L5 (e.g. ``B01AF01``) or wildcard class patterns
(e.g. ``A02BC*``). The seed loader is responsible for expansion if desired;
this table stores the raw row as authored.
"""
from typing import Optional
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DuplicateRuleOverride(Base):
    __tablename__ = "duplicate_rule_overrides"
    __table_args__ = (
        CheckConstraint(
            "rule_type IN ('upgrade','whitelist')",
            name="ck_duplicate_rule_overrides_rule_type",
        ),
        UniqueConstraint(
            "rule_type",
            "atc_code_1",
            "atc_code_2",
            name="uq_duplicate_rule_overrides_triplet",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_type: Mapped[str] = mapped_column(String(20), nullable=False)  # upgrade | whitelist
    atc_code_1: Mapped[str] = mapped_column(String(20), nullable=False)
    atc_code_2: Mapped[str] = mapped_column(String(20), nullable=False)
    severity_override: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_url: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
