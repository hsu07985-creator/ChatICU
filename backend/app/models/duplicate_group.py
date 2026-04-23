"""SQLAlchemy models for duplicate-medication L3 (機轉) / L4 (療效終點)
group catalogs.

Source of truth: docs/duplicate-medication-detection-implementation-plan.md §4.1.
Backed by migration 063 and seeded from
backend/app/fhir/code_maps/drug_mechanism_group{,_members}.csv and the
endpoint equivalents.
"""
from typing import Optional
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DrugMechanismGroup(Base):
    __tablename__ = "drug_mechanism_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_key: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    group_name_zh: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    group_name_en: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    severity: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # critical/high/moderate/low
    mechanism_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    members = relationship(
        "DrugMechanismGroupMember",
        back_populates="group",
        cascade="all, delete-orphan",
    )


class DrugMechanismGroupMember(Base):
    __tablename__ = "drug_mechanism_group_members"
    __table_args__ = (
        Index("ix_drug_mechanism_group_members_atc_code", "atc_code"),
    )

    group_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("drug_mechanism_groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    atc_code: Mapped[str] = mapped_column(String(10), primary_key=True)
    active_ingredient: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    group = relationship("DrugMechanismGroup", back_populates="members")


class DrugEndpointGroup(Base):
    __tablename__ = "drug_endpoint_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_key: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    group_name_zh: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    group_name_en: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    severity: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    mechanism_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    members = relationship(
        "DrugEndpointGroupMember",
        back_populates="group",
        cascade="all, delete-orphan",
    )


class DrugEndpointGroupMember(Base):
    __tablename__ = "drug_endpoint_group_members"
    __table_args__ = (
        Index("ix_drug_endpoint_group_members_atc_code", "atc_code"),
    )

    group_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("drug_endpoint_groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    atc_code: Mapped[str] = mapped_column(String(10), primary_key=True)
    active_ingredient: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Only nephrotoxic_triple_whammy currently uses this (nsaid / raas / diuretic);
    # kept nullable so other endpoint groups do not have to populate it.
    member_subtype: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    group = relationship("DrugEndpointGroup", back_populates="members")
