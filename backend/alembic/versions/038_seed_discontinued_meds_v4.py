"""seed discontinued medications using op.execute + bindparams pattern

Revision ID: 038
Revises: 037
Create Date: 2026-04-06
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None

MEDS = [
    {"id": "med_036", "pid": "pat_001", "name": "Ceftriaxone", "gname": "Ceftriaxone Sodium", "cat": "antibiotic", "san": None, "dose": "2000", "unit": "mg", "freq": "q12h", "route": "IV", "prn": False, "indication": "Empirical therapy for pneumonia", "sdate": "2025-10-17", "edate": "2025-10-24", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": []},
    {"id": "med_037", "pid": "pat_001", "name": "Propofol", "gname": "Propofol", "cat": "sedative", "san": "S", "dose": "50", "unit": "mg/hr", "freq": "continuous", "route": "IV infusion", "prn": False, "indication": "Initial sedation, switched to Dormicum", "sdate": "2025-10-17", "edate": "2025-10-22", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": ["高三酸甘油酯血症風險"]},
    {"id": "med_038", "pid": "pat_001", "name": "Norepinephrine", "gname": "Norepinephrine Bitartrate", "cat": "vasopressor", "san": None, "dose": "0.1", "unit": "mcg/kg/min", "freq": "continuous", "route": "IV infusion", "prn": False, "indication": "Septic shock, hemodynamic support", "sdate": "2025-10-17", "edate": "2025-11-05", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": []},
    {"id": "med_039", "pid": "pat_002", "name": "Dopamine", "gname": "Dopamine Hydrochloride", "cat": "vasopressor", "san": None, "dose": "5", "unit": "mcg/kg/min", "freq": "continuous", "route": "IV infusion", "prn": False, "indication": "Initial hemodynamic support, switched to Norepinephrine", "sdate": "2025-10-18", "edate": "2025-10-20", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": []},
    {"id": "med_040", "pid": "pat_002", "name": "Piperacillin/Tazobactam", "gname": "Piperacillin Sodium / Tazobactam Sodium", "cat": "antibiotic", "san": None, "dose": "4500", "unit": "mg", "freq": "q6h", "route": "IV", "prn": False, "indication": "Empirical broad-spectrum coverage, de-escalated to Meropenem", "sdate": "2025-10-18", "edate": "2025-10-25", "status": "completed", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": []},
    {"id": "med_041", "pid": "pat_002", "name": "Midazolam", "gname": "Midazolam", "cat": "sedative", "san": "S", "dose": "3", "unit": "mg/hr", "freq": "continuous", "route": "IV infusion", "prn": False, "indication": "Sedation, switched to Propofol for daily awakening trial", "sdate": "2025-10-18", "edate": "2025-10-30", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": ["呼吸抑制風險"]},
    {"id": "med_042", "pid": "pat_003", "name": "Vancomycin", "gname": "Vancomycin Hydrochloride", "cat": "antibiotic", "san": None, "dose": "500", "unit": "mg", "freq": "q12h", "route": "IV", "prn": False, "indication": "MRSA coverage, completed 14-day course", "sdate": "2025-10-18", "edate": "2025-11-01", "status": "completed", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": ["腎功能不全，需 TDM 監測"]},
    {"id": "med_043", "pid": "pat_003", "name": "Dopamine", "gname": "Dopamine Hydrochloride", "cat": "vasopressor", "san": None, "dose": "3", "unit": "mcg/kg/min", "freq": "continuous", "route": "IV infusion", "prn": False, "indication": "Renal-dose dopamine trial, discontinued per protocol", "sdate": "2025-10-18", "edate": "2025-10-25", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": []},
    {"id": "med_044", "pid": "pat_003", "name": "Fentanyl", "gname": "Fentanyl Citrate", "cat": "analgesic", "san": "A", "dose": "25", "unit": "mcg/hr", "freq": "continuous", "route": "IV infusion", "prn": False, "indication": "Pain control, switched to Morphine PRN", "sdate": "2025-10-18", "edate": "2025-11-10", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": []},
    {"id": "med_045", "pid": "pat_004", "name": "Phenytoin", "gname": "Phenytoin Sodium", "cat": "anticonvulsant", "san": None, "dose": "100", "unit": "mg", "freq": "q8h", "route": "IV", "prn": False, "indication": "Seizure prophylaxis, switched to Levetiracetam", "sdate": "2025-10-20", "edate": "2025-11-03", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": ["Drug interaction risk", "需監測 free phenytoin level"]},
    {"id": "med_046", "pid": "pat_004", "name": "Cefazolin", "gname": "Cefazolin Sodium", "cat": "antibiotic", "san": None, "dose": "1000", "unit": "mg", "freq": "q8h", "route": "IV", "prn": False, "indication": "Surgical prophylaxis, completed 3-day course", "sdate": "2025-10-20", "edate": "2025-10-23", "status": "completed", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": []},
    {"id": "med_047", "pid": "pat_004", "name": "Midazolam", "gname": "Midazolam", "cat": "sedative", "san": "S", "dose": "2", "unit": "mg", "freq": "q6h PRN", "route": "IV", "prn": True, "indication": "Agitation control post-TBI, weaned off", "sdate": "2025-10-20", "edate": "2025-11-15", "status": "discontinued", "pby": {"id": "usr_002", "name": "李穎灝"}, "warnings": ["TBI 後需謹慎使用鎮靜劑"]},
]


def upgrade() -> None:
    conn = op.get_bind()
    patient_count = conn.execute(sa.text("SELECT count(*) FROM patients")).scalar()
    if patient_count == 0:
        return

    for m in MEDS:
        op.execute(
            sa.text(
                "INSERT INTO medications "
                "(id, patient_id, name, generic_name, category, san_category, "
                "dose, unit, frequency, route, prn, indication, "
                "start_date, end_date, status, prescribed_by, warnings) "
                "VALUES (:id, :pid, :name, :gname, :cat, :san, "
                ":dose, :unit, :freq, :route, :prn, :indication, "
                "CAST(:sdate AS date), CAST(:edate AS date), :status, "
                "CAST(:pby AS jsonb), CAST(:warnings AS jsonb)) "
                "ON CONFLICT (id) DO NOTHING"
            ).bindparams(
                id=m["id"], pid=m["pid"], name=m["name"], gname=m["gname"],
                cat=m["cat"], san=m["san"], dose=m["dose"], unit=m["unit"],
                freq=m["freq"], route=m["route"], prn=m["prn"],
                indication=m["indication"], sdate=m["sdate"], edate=m["edate"],
                status=m["status"], pby=json.dumps(m["pby"]),
                warnings=json.dumps(m["warnings"]),
            )
        )


def downgrade() -> None:
    ids = ",".join(f"'{m['id']}'" for m in MEDS)
    op.execute(f"DELETE FROM medications WHERE id IN ({ids})")
