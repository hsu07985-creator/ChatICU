"""Add accepted column to pharmacy_advices."""

revision = "018_advice_accepted"
down_revision = "017_drop_advice_patient_fk"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.add_column(
        "pharmacy_advices",
        sa.Column("accepted", sa.Boolean(), nullable=True),
    )


def downgrade():
    op.drop_column("pharmacy_advices", "accepted")
