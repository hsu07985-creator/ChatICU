from typing import Optional
from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DrugInteraction(Base):
    __tablename__ = "drug_interactions"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    drug1: Mapped[str] = mapped_column(String(200), index=True)
    drug2: Mapped[str] = mapped_column(String(200), index=True)
    severity: Mapped[str] = mapped_column(String(20))  # minor, moderate, major
    mechanism: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    clinical_effect: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    management: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class IVCompatibility(Base):
    __tablename__ = "iv_compatibilities"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    drug1: Mapped[str] = mapped_column(String(200), index=True)
    drug2: Mapped[str] = mapped_column(String(200), index=True)
    solution: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    compatible: Mapped[bool] = mapped_column(Boolean)
    time_stability: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
