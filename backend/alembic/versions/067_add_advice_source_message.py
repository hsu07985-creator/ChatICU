"""Add ``pharmacy_advices.source_message_id`` for bulletin-board sync.

Revision ID: 067
Revises: 066

Background
----------
Before this migration the only way a ``PharmacyAdvice`` row could be created
was through ``POST /pharmacy/advice-records`` (the pharmacist widget). That
path produced at most one advice per bulletin-board message and the reverse
pointer was stored on ``patient_messages.advice_record_id``.

The bulletin-board tagging path (pharmacist writes a message and checks one
or more VPN-code tags like ``1-A 給藥問題``) now also creates
``PharmacyAdvice`` rows so those interventions show up in the admin
pharmacy statistics. A single message can carry multiple VPN tags and each
one produces its own advice row, so the 1:1 FK on ``patient_messages``
cannot carry the reverse mapping. We instead add a nullable
``source_message_id`` column on ``pharmacy_advices`` pointing back to the
originating bulletin message, with ``ON DELETE CASCADE`` so deleting the
message automatically removes its auto-synced advices (and therefore removes
them from the statistics).

``patient_messages.advice_record_id`` stays exactly as it was — it keeps
wiring the widget path's 1:1 relationship for backwards compatibility.
"""
import sqlalchemy as sa
from alembic import op


revision = "067"
down_revision = "066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pharmacy_advices",
        sa.Column("source_message_id", sa.String(length=50), nullable=True),
    )
    op.create_foreign_key(
        "fk_pharmacy_advices_source_message_id",
        "pharmacy_advices",
        "patient_messages",
        ["source_message_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_pharmacy_advices_source_message_id",
        "pharmacy_advices",
        ["source_message_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_pharmacy_advices_source_message_id", table_name="pharmacy_advices")
    op.drop_constraint(
        "fk_pharmacy_advices_source_message_id", "pharmacy_advices", type_="foreignkey"
    )
    op.drop_column("pharmacy_advices", "source_message_id")
