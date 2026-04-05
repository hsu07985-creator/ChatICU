"""re-seed discontinued medications (fix jsonb cast from 035)

Revision ID: 036
Revises: 035
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None

DISCONTINUED_MEDS = [
    ("med_036", "pat_001", "Ceftriaxone", "Ceftriaxone Sodium", "antibiotic", None, "2000", "mg", "q12h", "IV", False, "Empirical therapy for pneumonia", "2025-10-17", "2025-10-24", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '[]'),
    ("med_037", "pat_001", "Propofol", "Propofol", "sedative", "S", "50", "mg/hr", "continuous", "IV infusion", False, "Initial sedation, switched to Dormicum", "2025-10-17", "2025-10-22", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '["高三酸甘油酯血症風險"]'),
    ("med_038", "pat_001", "Norepinephrine", "Norepinephrine Bitartrate", "vasopressor", None, "0.1", "mcg/kg/min", "continuous", "IV infusion", False, "Septic shock, hemodynamic support", "2025-10-17", "2025-11-05", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '[]'),
    ("med_039", "pat_002", "Dopamine", "Dopamine Hydrochloride", "vasopressor", None, "5", "mcg/kg/min", "continuous", "IV infusion", False, "Initial hemodynamic support, switched to Norepinephrine", "2025-10-18", "2025-10-20", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '[]'),
    ("med_040", "pat_002", "Piperacillin/Tazobactam", "Piperacillin Sodium / Tazobactam Sodium", "antibiotic", None, "4500", "mg", "q6h", "IV", False, "Empirical broad-spectrum coverage, de-escalated to Meropenem", "2025-10-18", "2025-10-25", "completed", '{"id":"usr_002","name":"李穎灝"}', '[]'),
    ("med_041", "pat_002", "Midazolam", "Midazolam", "sedative", "S", "3", "mg/hr", "continuous", "IV infusion", False, "Sedation, switched to Propofol for daily awakening trial", "2025-10-18", "2025-10-30", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '["呼吸抑制風險"]'),
    ("med_042", "pat_003", "Vancomycin", "Vancomycin Hydrochloride", "antibiotic", None, "500", "mg", "q12h", "IV", False, "MRSA coverage, completed 14-day course", "2025-10-18", "2025-11-01", "completed", '{"id":"usr_002","name":"李穎灝"}', '["腎功能不全，需 TDM 監測"]'),
    ("med_043", "pat_003", "Dopamine", "Dopamine Hydrochloride", "vasopressor", None, "3", "mcg/kg/min", "continuous", "IV infusion", False, "Renal-dose dopamine trial, discontinued per protocol", "2025-10-18", "2025-10-25", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '[]'),
    ("med_044", "pat_003", "Fentanyl", "Fentanyl Citrate", "analgesic", "A", "25", "mcg/hr", "continuous", "IV infusion", False, "Pain control, switched to Morphine PRN", "2025-10-18", "2025-11-10", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '[]'),
    ("med_045", "pat_004", "Phenytoin", "Phenytoin Sodium", "anticonvulsant", None, "100", "mg", "q8h", "IV", False, "Seizure prophylaxis, switched to Levetiracetam", "2025-10-20", "2025-11-03", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '["Drug interaction risk","需監測 free phenytoin level"]'),
    ("med_046", "pat_004", "Cefazolin", "Cefazolin Sodium", "antibiotic", None, "1000", "mg", "q8h", "IV", False, "Surgical prophylaxis, completed 3-day course", "2025-10-20", "2025-10-23", "completed", '{"id":"usr_002","name":"李穎灝"}', '[]'),
    ("med_047", "pat_004", "Midazolam", "Midazolam", "sedative", "S", "2", "mg", "q6h PRN", "IV", True, "Agitation control post-TBI, weaned off", "2025-10-20", "2025-11-15", "discontinued", '{"id":"usr_002","name":"李穎灝"}', '["TBI 後需謹慎使用鎮靜劑"]'),
]


def upgrade() -> None:
    conn = op.get_bind()
    for row in DISCONTINUED_MEDS:
        med_id = row[0]
        exists = conn.execute(
            sa.text("SELECT 1 FROM medications WHERE id = :id"), {"id": med_id}
        ).fetchone()
        if exists:
            continue
        conn.execute(
            sa.text("""
                INSERT INTO medications (
                    id, patient_id, name, generic_name, category, san_category,
                    dose, unit, frequency, route, prn, indication,
                    start_date, end_date, status, prescribed_by, warnings
                ) VALUES (
                    :id, :pid, :name, :gname, :cat, :san,
                    :dose, :unit, :freq, :route, :prn, :indication,
                    :sdate, :edate, :status,
                    CAST(:prescribed_by AS jsonb), CAST(:warnings AS jsonb)
                )
            """),
            {
                "id": row[0], "pid": row[1], "name": row[2], "gname": row[3],
                "cat": row[4], "san": row[5], "dose": row[6], "unit": row[7],
                "freq": row[8], "route": row[9], "prn": row[10], "indication": row[11],
                "sdate": row[12], "edate": row[13], "status": row[14],
                "prescribed_by": row[15], "warnings": row[16],
            },
        )


def downgrade() -> None:
    ids = ",".join(f"'{r[0]}'" for r in DISCONTINUED_MEDS)
    op.execute(f"DELETE FROM medications WHERE id IN ({ids})")
