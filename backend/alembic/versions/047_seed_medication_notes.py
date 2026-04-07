"""Seed medication notes by name+patient (idempotent).

Revision ID: 047
Revises: 046
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Ensure column exists (idempotent)
    conn.execute(sa.text(
        "ALTER TABLE medications ADD COLUMN IF NOT EXISTS notes TEXT"
    ))

    # Seed notes by (patient_id, name) — works regardless of med ID format
    notes_data = [
        # pat_001
        ("pat_001", "Morphine", "Morphine 2mg IV Q4H PRN for pain\nif Pain Score > 4, may repeat x1"),
        ("pat_001", "Dormicum", "for Dormicum pump, initial bolus 1cc\nrun 0.4cc/hr-3cc/hr, titrate every hour\nkeep RASS -2~-3"),
        ("pat_001", "Propofol", "Propofol 1% 10mg/mL\nrun 5-30cc/hr, titrate Q30min\nkeep RASS -1~0, hold if MAP < 65"),
        # pat_002
        ("pat_002", "Propofol", "Propofol 2% 20mg/mL\nrun 5-20cc/hr\nkeep RASS -2~-1\nhold if MAP < 60 or HR < 50"),
        ("pat_002", "Fentanyl", "for fentanyl pump, initial bolus 1cc\nrun 0.5-6cc/hr, titrate every hour\nkeep RASS -2~-3"),
        ("pat_002", "Cisatracurium", "Cisatracurium 2mg/mL\nrun 1-5cc/hr, titrate by TOF\ntarget TOF 1-2/4"),
        ("pat_002", "Midazolam", "Midazolam 1mg/mL backup\n0.5-3cc/hr if Propofol insufficient\nkeep RASS -2~-1"),
        # pat_003
        ("pat_003", "Dexmedetomidine", "Precedex 4mcg/mL\nrun 0.2-1.4mcg/kg/hr\nkeep RASS -1~0, monitor HR"),
        ("pat_003", "Morphine", "Morphine 2mg IV Q4H PRN\nfor breakthrough pain only"),
        ("pat_003", "Fentanyl", "Fentanyl 10mcg/mL\nrun 1-6cc/hr, titrate Q1H\nkeep Pain Score < 4"),
        # pat_004
        ("pat_004", "Midazolam", "Midazolam 1mg/mL\nrun 0.5-3cc/hr\nkeep RASS -2~-1\ntitrate Q1H, hold if RR < 10"),
    ]
    for pid, med_name, notes in notes_data:
        conn.execute(
            sa.text(
                "UPDATE medications SET notes = :notes "
                "WHERE patient_id = :pid AND name = :name AND notes IS NULL"
            ),
            {"pid": pid, "name": med_name, "notes": notes},
        )


def downgrade() -> None:
    pass
