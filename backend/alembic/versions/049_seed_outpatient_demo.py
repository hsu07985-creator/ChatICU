"""Seed outpatient demo medications for pat_001.

Revision ID: 049
Revises: 048
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None

# 4 demo outpatient medications for pat_001
_OUTPATIENT_MEDS = [
    {
        "id": "med_opd_001",
        "patient_id": "pat_001",
        "name": "Tamsulosin",
        "generic_name": "Tamsulosin HCl",
        "dose": "0.4",
        "unit": "mg",
        "frequency": "QD",
        "route": "PO",
        "indication": "BPH (良性攝護腺肥大)",
        "start_date": "2025-09-15",
        "end_date": "2026-03-15",
        "status": "active",
        "source_type": "outpatient",
        "source_campus": "仁愛",
        "prescribing_hospital": "臺北市立聯合醫院",
        "prescribing_department": "泌尿科",
        "prescribing_doctor_name": "張德揚",
        "days_supply": 28,
        "is_external": False,
    },
    {
        "id": "med_opd_002",
        "patient_id": "pat_001",
        "name": "Amlodipine",
        "generic_name": "Amlodipine Besylate",
        "dose": "5",
        "unit": "mg",
        "frequency": "QD",
        "route": "PO",
        "indication": "Hypertension (高血壓)",
        "start_date": "2025-06-01",
        "end_date": "2026-06-01",
        "status": "active",
        "source_type": "outpatient",
        "source_campus": "中興",
        "prescribing_hospital": "臺北市立聯合醫院",
        "prescribing_department": "心臟內科",
        "prescribing_doctor_name": "王建民",
        "days_supply": 28,
        "is_external": False,
    },
    {
        "id": "med_opd_003",
        "patient_id": "pat_001",
        "name": "Metformin",
        "generic_name": "Metformin HCl",
        "dose": "500",
        "unit": "mg",
        "frequency": "BID",
        "route": "PO",
        "indication": "DM type 2 (第二型糖尿病)",
        "start_date": "2025-04-10",
        "end_date": "2026-04-10",
        "status": "active",
        "source_type": "outpatient",
        "source_campus": "陽明",
        "prescribing_hospital": "臺北市立聯合醫院",
        "prescribing_department": "新陳代謝科",
        "prescribing_doctor_name": "陳美玲",
        "days_supply": 28,
        "is_external": False,
    },
    {
        "id": "med_opd_004",
        "patient_id": "pat_001",
        "name": "Atorvastatin",
        "generic_name": "Atorvastatin Calcium",
        "dose": "20",
        "unit": "mg",
        "frequency": "QD HS",
        "route": "PO",
        "indication": "Hyperlipidemia (高血脂)",
        "start_date": "2025-07-20",
        "end_date": "2026-07-20",
        "status": "active",
        "source_type": "outpatient",
        "source_campus": "忠孝",
        "prescribing_hospital": "臺北市立聯合醫院",
        "prescribing_department": "心臟內科",
        "prescribing_doctor_name": "林志明",
        "days_supply": 28,
        "is_external": False,
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    for med in _OUTPATIENT_MEDS:
        exists = conn.execute(
            sa.text("SELECT 1 FROM medications WHERE id = :id"),
            {"id": med["id"]},
        ).fetchone()
        if exists:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO medications "
                "(id, patient_id, name, generic_name, dose, unit, frequency, route, "
                "indication, start_date, end_date, status, "
                "source_type, source_campus, prescribing_hospital, "
                "prescribing_department, prescribing_doctor_name, days_supply, is_external) "
                "VALUES (:id, :patient_id, :name, :generic_name, :dose, :unit, :frequency, :route, "
                ":indication, :start_date, :end_date, :status, "
                ":source_type, :source_campus, :prescribing_hospital, "
                ":prescribing_department, :prescribing_doctor_name, :days_supply, :is_external)"
            ),
            med,
        )


def downgrade() -> None:
    conn = op.get_bind()
    for med in _OUTPATIENT_MEDS:
        conn.execute(
            sa.text("DELETE FROM medications WHERE id = :id"),
            {"id": med["id"]},
        )
