"""Add enrichment columns to drug_interactions

Revision ID: 027
Revises: 026
"""
from alembic import op
import sqlalchemy as sa

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drug_interactions", sa.Column("risk_rating", sa.String(2), nullable=True))
    op.add_column("drug_interactions", sa.Column("risk_rating_description", sa.String(100), nullable=True))
    op.add_column("drug_interactions", sa.Column("severity_label", sa.String(30), nullable=True))
    op.add_column("drug_interactions", sa.Column("reliability_rating", sa.String(30), nullable=True))
    op.add_column("drug_interactions", sa.Column("route_dependency", sa.Text(), nullable=True))
    op.add_column("drug_interactions", sa.Column("discussion", sa.Text(), nullable=True))
    op.add_column("drug_interactions", sa.Column("footnotes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("drug_interactions", "footnotes")
    op.drop_column("drug_interactions", "discussion")
    op.drop_column("drug_interactions", "route_dependency")
    op.drop_column("drug_interactions", "reliability_rating")
    op.drop_column("drug_interactions", "severity_label")
    op.drop_column("drug_interactions", "risk_rating_description")
    op.drop_column("drug_interactions", "risk_rating")
