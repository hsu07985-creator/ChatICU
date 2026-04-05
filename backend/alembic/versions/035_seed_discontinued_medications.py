"""seed discontinued medications for all 4 patients

Revision ID: 035
Revises: 034
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None

DISCONTINUED_MEDS = [
    # pat_001
    {
        "id": "med_036", "patient_id": "pat_001",
        "name": "Ceftriaxone", "generic_name": "Ceftriaxone Sodium",
        "category": "antibiotic", "san_category": None,
        "dose": "2000", "unit": "mg", "frequency": "q12h", "route": "IV",
        "prn": False, "indication": "Empirical therapy for pneumonia",
        "start_date": "2025-10-17", "end_date": "2025-10-24",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": "[]",
    },
    {
        "id": "med_037", "patient_id": "pat_001",
        "name": "Propofol", "generic_name": "Propofol",
        "category": "sedative", "san_category": "S",
        "dose": "50", "unit": "mg/hr", "frequency": "continuous", "route": "IV infusion",
        "prn": False, "indication": "Initial sedation, switched to Dormicum",
        "start_date": "2025-10-17", "end_date": "2025-10-22",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": '["高三酸甘油酯血症風險"]',
    },
    {
        "id": "med_038", "patient_id": "pat_001",
        "name": "Norepinephrine", "generic_name": "Norepinephrine Bitartrate",
        "category": "vasopressor", "san_category": None,
        "dose": "0.1", "unit": "mcg/kg/min", "frequency": "continuous", "route": "IV infusion",
        "prn": False, "indication": "Septic shock, hemodynamic support",
        "start_date": "2025-10-17", "end_date": "2025-11-05",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": "[]",
    },
    # pat_002
    {
        "id": "med_039", "patient_id": "pat_002",
        "name": "Dopamine", "generic_name": "Dopamine Hydrochloride",
        "category": "vasopressor", "san_category": None,
        "dose": "5", "unit": "mcg/kg/min", "frequency": "continuous", "route": "IV infusion",
        "prn": False, "indication": "Initial hemodynamic support, switched to Norepinephrine",
        "start_date": "2025-10-18", "end_date": "2025-10-20",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": "[]",
    },
    {
        "id": "med_040", "patient_id": "pat_002",
        "name": "Piperacillin/Tazobactam", "generic_name": "Piperacillin Sodium / Tazobactam Sodium",
        "category": "antibiotic", "san_category": None,
        "dose": "4500", "unit": "mg", "frequency": "q6h", "route": "IV",
        "prn": False, "indication": "Empirical broad-spectrum coverage, de-escalated to Meropenem",
        "start_date": "2025-10-18", "end_date": "2025-10-25",
        "status": "completed", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": "[]",
    },
    {
        "id": "med_041", "patient_id": "pat_002",
        "name": "Midazolam", "generic_name": "Midazolam",
        "category": "sedative", "san_category": "S",
        "dose": "3", "unit": "mg/hr", "frequency": "continuous", "route": "IV infusion",
        "prn": False, "indication": "Sedation, switched to Propofol for daily awakening trial",
        "start_date": "2025-10-18", "end_date": "2025-10-30",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": '["呼吸抑制風險"]',
    },
    # pat_003
    {
        "id": "med_042", "patient_id": "pat_003",
        "name": "Vancomycin", "generic_name": "Vancomycin Hydrochloride",
        "category": "antibiotic", "san_category": None,
        "dose": "500", "unit": "mg", "frequency": "q12h", "route": "IV",
        "prn": False, "indication": "MRSA coverage, completed 14-day course",
        "start_date": "2025-10-18", "end_date": "2025-11-01",
        "status": "completed", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": '["腎功能不全，需 TDM 監測"]',
    },
    {
        "id": "med_043", "patient_id": "pat_003",
        "name": "Dopamine", "generic_name": "Dopamine Hydrochloride",
        "category": "vasopressor", "san_category": None,
        "dose": "3", "unit": "mcg/kg/min", "frequency": "continuous", "route": "IV infusion",
        "prn": False, "indication": "Renal-dose dopamine trial, discontinued per protocol",
        "start_date": "2025-10-18", "end_date": "2025-10-25",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": "[]",
    },
    {
        "id": "med_044", "patient_id": "pat_003",
        "name": "Fentanyl", "generic_name": "Fentanyl Citrate",
        "category": "analgesic", "san_category": "A",
        "dose": "25", "unit": "mcg/hr", "frequency": "continuous", "route": "IV infusion",
        "prn": False, "indication": "Pain control, switched to Morphine PRN",
        "start_date": "2025-10-18", "end_date": "2025-11-10",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": "[]",
    },
    # pat_004
    {
        "id": "med_045", "patient_id": "pat_004",
        "name": "Phenytoin", "generic_name": "Phenytoin Sodium",
        "category": "anticonvulsant", "san_category": None,
        "dose": "100", "unit": "mg", "frequency": "q8h", "route": "IV",
        "prn": False, "indication": "Seizure prophylaxis, switched to Levetiracetam",
        "start_date": "2025-10-20", "end_date": "2025-11-03",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": '["Drug interaction risk","需監測 free phenytoin level"]',
    },
    {
        "id": "med_046", "patient_id": "pat_004",
        "name": "Cefazolin", "generic_name": "Cefazolin Sodium",
        "category": "antibiotic", "san_category": None,
        "dose": "1000", "unit": "mg", "frequency": "q8h", "route": "IV",
        "prn": False, "indication": "Surgical prophylaxis, completed 3-day course",
        "start_date": "2025-10-20", "end_date": "2025-10-23",
        "status": "completed", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": "[]",
    },
    {
        "id": "med_047", "patient_id": "pat_004",
        "name": "Midazolam", "generic_name": "Midazolam",
        "category": "sedative", "san_category": "S",
        "dose": "2", "unit": "mg", "frequency": "q6h PRN", "route": "IV",
        "prn": True, "indication": "Agitation control post-TBI, weaned off",
        "start_date": "2025-10-20", "end_date": "2025-11-15",
        "status": "discontinued", "prescribed_by": '{"id":"usr_002","name":"李穎灝"}',
        "warnings": '["TBI 後需謹慎使用鎮靜劑"]',
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    for m in DISCONTINUED_MEDS:
        exists = conn.execute(
            sa.text("SELECT 1 FROM medications WHERE id = :id"), {"id": m["id"]}
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
                    :id, :patient_id, :name, :generic_name, :category, :san_category,
                    :dose, :unit, :frequency, :route, :prn, :indication,
                    :start_date, :end_date, :status, :prescribed_by::jsonb, :warnings::jsonb
                )
            """),
            m,
        )


def downgrade() -> None:
    op.execute(
        "DELETE FROM medications WHERE id IN ("
        + ",".join(f"'{m['id']}'" for m in DISCONTINUED_MEDS)
        + ")"
    )
