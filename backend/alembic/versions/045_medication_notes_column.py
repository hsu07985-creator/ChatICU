"""Add notes column to medications + seed doctor order notes for S/A/N meds.

Revision ID: 045
Revises: 044
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "045"
down_revision = "044"
branch_labels = None
depends_on = None

# (med_id, notes)
SAN_NOTES = [
    # pat_001
    ("med_001", "Morphine 2mg IV Q4H PRN for pain\nif Pain Score > 4, may repeat x1"),
    ("med_002", "for Dormicum pump, initial bolus 1cc\nrun 0.4cc/hr-3cc/hr, titrate every hour\nkeep RASS -2~-3"),
    ("med_037", "Propofol 1% 10mg/mL\nrun 5-30cc/hr, titrate Q30min\nkeep RASS -1~0, hold if MAP < 65"),
    # pat_002
    ("med_004", "Propofol 2% 20mg/mL\nrun 5-20cc/hr\nkeep RASS -2~-1\nhold if MAP < 60 or HR < 50"),
    ("med_005", "for fentanyl pump, initial bolus 1cc\nrun 0.5-6cc/hr, titrate every hour\nkeep RASS -2~-3"),
    ("med_006", "Cisatracurium 2mg/mL\nrun 1-5cc/hr, titrate by TOF\ntarget TOF 1-2/4"),
    ("med_041", "Midazolam 1mg/mL backup\n0.5-3cc/hr if Propofol insufficient\nkeep RASS -2~-1"),
    # pat_003
    ("med_008", "Precedex 4mcg/mL\nrun 0.2-1.4mcg/kg/hr\nkeep RASS -1~0, monitor HR"),
    ("med_009", "Morphine 2mg IV Q4H PRN\nfor breakthrough pain only"),
    ("med_044", "Fentanyl 10mcg/mL\nrun 1-6cc/hr, titrate Q1H\nkeep Pain Score < 4"),
    # pat_004
    ("med_047", "Midazolam 1mg/mL\nrun 0.5-3cc/hr\nkeep RASS -2~-1\ntitrate Q1H, hold if RR < 10"),
]


def upgrade() -> None:
    conn = op.get_bind()
    cols = [r[0] for r in conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'medications'"
    ))]
    if "notes" not in cols:
        op.add_column("medications", sa.Column("notes", sa.Text(), nullable=True))

    for med_id, notes in SAN_NOTES:
        conn.execute(
            sa.text("UPDATE medications SET notes = :notes WHERE id = :mid"),
            {"mid": med_id, "notes": notes},
        )


def downgrade() -> None:
    op.drop_column("medications", "notes")
