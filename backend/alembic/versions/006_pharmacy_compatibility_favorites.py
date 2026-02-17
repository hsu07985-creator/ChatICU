"""Add pharmacy_compatibility_favorites table for IV compatibility favorites.

NOTE: Alembic's default `alembic_version.version_num` column is VARCHAR(32),
so revision IDs must be <= 32 chars.
"""

from alembic import op
import sqlalchemy as sa


revision = "006_pharm_compat_favs"
down_revision = "005_patient_unit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pharmacy_compatibility_favorites",
        sa.Column("id", sa.String(60), primary_key=True),
        sa.Column("user_id", sa.String(50), nullable=False),
        sa.Column("pair_key", sa.String(320), nullable=False),
        sa.Column("drug_a", sa.String(200), nullable=False),
        sa.Column("drug_b", sa.String(200), nullable=False),
        sa.Column("solution", sa.String(20), nullable=False, server_default="none"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "pair_key", name="uq_pharm_fav_user_pair"),
    )
    op.create_index("ix_pharmacy_compatibility_favorites_user_id", "pharmacy_compatibility_favorites", ["user_id"])
    op.create_index("ix_pharmacy_compatibility_favorites_pair_key", "pharmacy_compatibility_favorites", ["pair_key"])


def downgrade() -> None:
    op.drop_index("ix_pharmacy_compatibility_favorites_pair_key", table_name="pharmacy_compatibility_favorites")
    op.drop_index("ix_pharmacy_compatibility_favorites_user_id", table_name="pharmacy_compatibility_favorites")
    op.drop_table("pharmacy_compatibility_favorites")
