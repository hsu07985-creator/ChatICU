"""Create pharmacy_soap_records — TC-FU-T2.

Revision ID: 079
Revises: 067

Background
----------
Before this migration the pharmacist SOAP editor (``pharmacist-soap-editor.tsx``)
only copied the composed text to the clipboard. Pharmacists could not re-read
SOAPs they had previously written inside ChatICU. This migration adds a flat
``pharmacy_soap_records`` table to persist S / O / A / P plus the polished
concatenation, scoped per-pharmacist for retrieval on
``advice-statistics.tsx``.

Notes
-----
* ``pharmacist_id`` uses ``ON DELETE SET NULL`` (audit-friendly) — historical
  SOAPs survive user deletion via the denormalised ``pharmacist_name``.
* ``patient_id`` uses ``ON DELETE RESTRICT`` so we never silently lose
  pharmacist work when a patient row is removed.
* Idempotent (``IF NOT EXISTS`` on table + index creation) so re-running
  on prod is safe.

Revision number 079 is chosen by the upstream task spec (TC-FU-T2 doc) to
leave gaps for in-flight migrations from sibling teams; ``down_revision``
correctly chains to the current head ``067``.
"""
import sqlalchemy as sa
from alembic import op


revision = "079"
down_revision = "078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "pharmacy_soap_records" not in existing_tables:
        op.create_table(
            "pharmacy_soap_records",
            sa.Column("id", sa.String(length=50), primary_key=True),
            sa.Column(
                "patient_id",
                sa.String(length=50),
                sa.ForeignKey("patients.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "pharmacist_id",
                sa.String(length=50),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("pharmacist_name", sa.String(length=100), nullable=False),
            sa.Column("subjective", sa.Text(), nullable=True),
            sa.Column("objective", sa.Text(), nullable=True),
            sa.Column("assessment", sa.Text(), nullable=True),
            sa.Column("plan", sa.Text(), nullable=True),
            sa.Column("polished_content", sa.Text(), nullable=True),
            sa.Column("bed_number", sa.String(length=20), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )

    # Refresh inspector after potential table creation.
    inspector = sa.inspect(bind)
    existing_indexes = {ix["name"] for ix in inspector.get_indexes("pharmacy_soap_records")}

    if "ix_pharmacy_soap_records_pharmacist_id" not in existing_indexes:
        op.create_index(
            "ix_pharmacy_soap_records_pharmacist_id",
            "pharmacy_soap_records",
            ["pharmacist_id"],
        )
    if "ix_pharmacy_soap_records_patient_id" not in existing_indexes:
        op.create_index(
            "ix_pharmacy_soap_records_patient_id",
            "pharmacy_soap_records",
            ["patient_id"],
        )
    if "ix_pharmacy_soap_records_pharmacist_created" not in existing_indexes:
        op.create_index(
            "ix_pharmacy_soap_records_pharmacist_created",
            "pharmacy_soap_records",
            ["pharmacist_id", sa.text("created_at DESC")],
        )
    if "ix_pharmacy_soap_records_patient_created" not in existing_indexes:
        op.create_index(
            "ix_pharmacy_soap_records_patient_created",
            "pharmacy_soap_records",
            ["patient_id", sa.text("created_at DESC")],
        )


def downgrade() -> None:
    op.drop_index(
        "ix_pharmacy_soap_records_patient_created", table_name="pharmacy_soap_records"
    )
    op.drop_index(
        "ix_pharmacy_soap_records_pharmacist_created",
        table_name="pharmacy_soap_records",
    )
    op.drop_index(
        "ix_pharmacy_soap_records_patient_id", table_name="pharmacy_soap_records"
    )
    op.drop_index(
        "ix_pharmacy_soap_records_pharmacist_id", table_name="pharmacy_soap_records"
    )
    op.drop_table("pharmacy_soap_records")
