from datetime import datetime

from sqlalchemy import DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PharmacyCompatibilityFavorite(Base):
    """Per-user favorites for IV compatibility lookup pairs.

    Stored as a canonicalized pair key to avoid duplicates (order-insensitive).
    """

    __tablename__ = "pharmacy_compatibility_favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "pair_key", name="uq_pharm_fav_user_pair"),
    )

    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), index=True)
    pair_key: Mapped[str] = mapped_column(String(320), index=True)
    drug_a: Mapped[str] = mapped_column(String(200))
    drug_b: Mapped[str] = mapped_column(String(200))
    solution: Mapped[str] = mapped_column(String(20), default="none")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

