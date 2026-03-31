"""Add full interaction schema columns and indexes

Revision ID: 028
Revises: 027
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New columns
    for col, col_type in [
        ("dependencies", "TEXT"),
        ("dependency_types", "TEXT"),
        ("interacting_members", "TEXT"),
        ("pubmed_ids", "TEXT"),
    ]:
        op.add_column("drug_interactions", sa.Column(col, sa.Text(), nullable=True))

    op.add_column("drug_interactions", sa.Column("dedup_key", sa.String(300), nullable=True))
    op.add_column("drug_interactions", sa.Column("body_hash", sa.String(32), nullable=True))

    # Indexes
    op.create_index("ix_drug_interactions_dedup_key", "drug_interactions", ["dedup_key"], unique=True)
    op.create_index("ix_drug_interactions_risk_rating", "drug_interactions", ["risk_rating"])

    # GIN trigram indexes for faster ILIKE (PostgreSQL only)
    try:
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute(
            "CREATE INDEX ix_drug_interactions_drug1_trgm "
            "ON drug_interactions USING gin (drug1 gin_trgm_ops)"
        )
        op.execute(
            "CREATE INDEX ix_drug_interactions_drug2_trgm "
            "ON drug_interactions USING gin (drug2 gin_trgm_ops)"
        )
    except Exception:
        pass  # SQLite or other DB without pg_trgm


def downgrade() -> None:
    try:
        op.drop_index("ix_drug_interactions_drug2_trgm", "drug_interactions")
        op.drop_index("ix_drug_interactions_drug1_trgm", "drug_interactions")
    except Exception:
        pass
    op.drop_index("ix_drug_interactions_risk_rating", "drug_interactions")
    op.drop_index("ix_drug_interactions_dedup_key", "drug_interactions")
    op.drop_column("drug_interactions", "body_hash")
    op.drop_column("drug_interactions", "dedup_key")
    op.drop_column("drug_interactions", "pubmed_ids")
    op.drop_column("drug_interactions", "interacting_members")
    op.drop_column("drug_interactions", "dependency_types")
    op.drop_column("drug_interactions", "dependencies")
