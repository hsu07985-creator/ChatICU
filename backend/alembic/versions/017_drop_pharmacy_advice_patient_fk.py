"""Drop foreign key on pharmacy_advices.patient_id to allow layer2 patients."""

revision = "017_drop_advice_patient_fk"
down_revision = "016_mentioned_roles"
branch_labels = None
depends_on = None

from alembic import op
from sqlalchemy import text


def upgrade():
    conn = op.get_bind()
    result = conn.execute(text(
        "SELECT conname FROM pg_constraint "
        "WHERE conrelid = 'pharmacy_advices'::regclass "
        "AND contype = 'f' AND conkey @> ARRAY["
        "(SELECT attnum FROM pg_attribute WHERE attrelid = 'pharmacy_advices'::regclass AND attname = 'patient_id')"
        "]"
    ))
    row = result.fetchone()
    if row:
        op.drop_constraint(row[0], "pharmacy_advices", type_="foreignkey")


def downgrade():
    op.create_foreign_key(
        "fk_pharmacy_advices_patient_id",
        "pharmacy_advices",
        "patients",
        ["patient_id"],
        ["id"],
        ondelete="CASCADE",
    )
