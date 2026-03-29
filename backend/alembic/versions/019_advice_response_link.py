"""Link PatientMessage to PharmacyAdvice and add response tracking fields."""

revision = "019_advice_response_link"
down_revision = "018_advice_accepted"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    # PatientMessage: add advice_record_id FK
    op.add_column(
        "patient_messages",
        sa.Column("advice_record_id", sa.String(50), nullable=True),
    )
    op.create_index(
        "ix_patient_msgs_advice_id",
        "patient_messages",
        ["advice_record_id"],
    )
    op.create_foreign_key(
        "fk_patient_msgs_advice",
        "patient_messages",
        "pharmacy_advices",
        ["advice_record_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # PharmacyAdvice: add responder tracking
    op.add_column(
        "pharmacy_advices",
        sa.Column("responded_by_id", sa.String(50), nullable=True),
    )
    op.add_column(
        "pharmacy_advices",
        sa.Column("responded_by_name", sa.String(100), nullable=True),
    )
    op.add_column(
        "pharmacy_advices",
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_advices_responder",
        "pharmacy_advices",
        "users",
        ["responded_by_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade():
    op.drop_constraint("fk_advices_responder", "pharmacy_advices", type_="foreignkey")
    op.drop_column("pharmacy_advices", "responded_at")
    op.drop_column("pharmacy_advices", "responded_by_name")
    op.drop_column("pharmacy_advices", "responded_by_id")
    op.drop_constraint("fk_patient_msgs_advice", "patient_messages", type_="foreignkey")
    op.drop_index("ix_patient_msgs_advice_id", "patient_messages")
    op.drop_column("patient_messages", "advice_record_id")
