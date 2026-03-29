"""Add medication concentration columns.

Revision ID: 021_medication_conc
Revises: 020_record_templates
Create Date: 2026-03-16
"""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa


revision = "021_medication_conc"
down_revision = "020_record_templates"
branch_labels = None
depends_on = None


def _extract_concentration_parts(*values: str | None) -> tuple[str | None, str | None]:
    pattern = re.compile(r"(\d+(?:\.\d+)?)\s*(mcg|mg)\s*/\s*m[lL]", re.IGNORECASE)
    for value in values:
        if not value:
            continue
        match = pattern.search(value)
        if match:
            return match.group(1), f"{match.group(2).lower()}/mL"
    return None, None


def upgrade() -> None:
    op.add_column("medications", sa.Column("concentration", sa.String(length=50), nullable=True))
    op.add_column("medications", sa.Column("concentration_unit", sa.String(length=20), nullable=True))

    bind = op.get_bind()
    medications = sa.table(
        "medications",
        sa.column("id", sa.String(length=50)),
        sa.column("name", sa.String(length=200)),
        sa.column("indication", sa.String(length=500)),
        sa.column("concentration", sa.String(length=50)),
        sa.column("concentration_unit", sa.String(length=20)),
    )

    rows = bind.execute(
        sa.select(
            medications.c.id,
            medications.c.name,
            medications.c.indication,
            medications.c.concentration,
            medications.c.concentration_unit,
        )
    ).mappings()

    for row in rows:
        if row["concentration"] or row["concentration_unit"]:
            continue
        concentration, concentration_unit = _extract_concentration_parts(
            row["name"],
            row["indication"],
        )
        if concentration or concentration_unit:
            bind.execute(
                sa.update(medications)
                .where(medications.c.id == row["id"])
                .values(
                    concentration=concentration,
                    concentration_unit=concentration_unit,
                )
            )


def downgrade() -> None:
    op.drop_column("medications", "concentration_unit")
    op.drop_column("medications", "concentration")
