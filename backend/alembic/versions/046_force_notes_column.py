"""Force-add notes column to medications if missing (repair migration).

Revision ID: 046
Revises: 045
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "046"
down_revision = "045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Force-add medications.notes if missing
    conn.execute(sa.text(
        "ALTER TABLE medications ADD COLUMN IF NOT EXISTS notes TEXT"
    ))

    # Force-add culture_results columns if missing
    conn.execute(sa.text(
        "ALTER TABLE culture_results ADD COLUMN IF NOT EXISTS q_score INTEGER"
    ))
    conn.execute(sa.text(
        "ALTER TABLE culture_results ADD COLUMN IF NOT EXISTS result VARCHAR(200)"
    ))

    # Seed medication notes (idempotent — only updates where notes IS NULL)
    notes_data = [
        ("med_001", "Morphine 2mg IV Q4H PRN for pain\nif Pain Score > 4, may repeat x1"),
        ("med_002", "for Dormicum pump, initial bolus 1cc\nrun 0.4cc/hr-3cc/hr, titrate every hour\nkeep RASS -2~-3"),
        ("med_037", "Propofol 1% 10mg/mL\nrun 5-30cc/hr, titrate Q30min\nkeep RASS -1~0, hold if MAP < 65"),
        ("med_004", "Propofol 2% 20mg/mL\nrun 5-20cc/hr\nkeep RASS -2~-1\nhold if MAP < 60 or HR < 50"),
        ("med_005", "for fentanyl pump, initial bolus 1cc\nrun 0.5-6cc/hr, titrate every hour\nkeep RASS -2~-3"),
        ("med_006", "Cisatracurium 2mg/mL\nrun 1-5cc/hr, titrate by TOF\ntarget TOF 1-2/4"),
        ("med_041", "Midazolam 1mg/mL backup\n0.5-3cc/hr if Propofol insufficient\nkeep RASS -2~-1"),
        ("med_008", "Precedex 4mcg/mL\nrun 0.2-1.4mcg/kg/hr\nkeep RASS -1~0, monitor HR"),
        ("med_009", "Morphine 2mg IV Q4H PRN\nfor breakthrough pain only"),
        ("med_044", "Fentanyl 10mcg/mL\nrun 1-6cc/hr, titrate Q1H\nkeep Pain Score < 4"),
        ("med_047", "Midazolam 1mg/mL\nrun 0.5-3cc/hr\nkeep RASS -2~-1\ntitrate Q1H, hold if RR < 10"),
    ]
    for mid, notes in notes_data:
        conn.execute(
            sa.text("UPDATE medications SET notes = :notes WHERE id = :mid AND notes IS NULL"),
            {"mid": mid, "notes": notes},
        )


def downgrade() -> None:
    pass
