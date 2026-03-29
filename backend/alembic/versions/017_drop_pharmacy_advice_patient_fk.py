"""Drop foreign key on pharmacy_advices.patient_id to allow layer2 patients."""

revision = "017_drop_advice_patient_fk"
down_revision = "016_mentioned_roles"
branch_labels = None
depends_on = None

from alembic import op


def upgrade():
    op.drop_constraint(
        "fk_pharmacy_advices_patient_id",
        "pharmacy_advices",
        type_="foreignkey",
    )


def downgrade():
    op.create_foreign_key(
        "fk_pharmacy_advices_patient_id",
        "pharmacy_advices",
        "patients",
        ["patient_id"],
        ["id"],
        ondelete="CASCADE",
    )
