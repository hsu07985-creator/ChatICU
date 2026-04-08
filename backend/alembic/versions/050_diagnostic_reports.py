"""Create diagnostic_reports table and seed demo data.

Revision ID: 050
Revises: 049
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None

_DEMO_REPORTS = [
    {
        "id": "rpt_001",
        "patient_id": "pat_001",
        "report_type": "imaging",
        "exam_name": "CT Without C.M. Brain",
        "exam_date": "2025-10-20 10:30:00+08",
        "body_text": (
            "CT of head without contrast enhancement shows:\n"
            "- s/p right lateral ventricle drainage. s/p left craniotomy and a left burr hole.\n"
            "- brain atrophy with prominent sulci, fissures and ventricles.\n"
            "- confluent hypodensity at the periventricular white matter.\n"
            "- old insult in the left patietal-occipital-temporal lobes.\n"
            "- lacunes at bilateral basal ganglia, thalami, and pons.\n"
            "- atherosclerosis with mural calcification in the intracranial arteries."
        ),
        "impression": (
            "Brain atrophy. old insults and lacunes. post-operative changes.\n"
            "Suggest clinical correlation."
        ),
        "reporter_name": "RAD12-王志明",
        "status": "final",
    },
    {
        "id": "rpt_002",
        "patient_id": "pat_001",
        "report_type": "imaging",
        "exam_name": "Chest X-ray (Portable)",
        "exam_date": "2025-10-18 08:15:00+08",
        "body_text": (
            "Portable AP view of the chest:\n"
            "- ETT tip at approximately 3 cm above the carina.\n"
            "- NG tube tip in the stomach.\n"
            "- Right subclavian CVC with tip in the SVC.\n"
            "- Bilateral diffuse ground-glass opacities, more prominent in the lower lobes.\n"
            "- No pneumothorax identified.\n"
            "- Mild cardiomegaly."
        ),
        "impression": (
            "Bilateral diffuse infiltrates, compatible with ARDS or pulmonary edema.\n"
            "Lines and tubes in satisfactory position."
        ),
        "reporter_name": "RAD08-陳怡安",
        "status": "final",
    },
    {
        "id": "rpt_003",
        "patient_id": "pat_001",
        "report_type": "procedure",
        "exam_name": "清醒腦波 EEG",
        "exam_date": "2025-11-05 14:00:00+08",
        "body_text": (
            "Indication: conscious change\n\n"
            "Finding:\n"
            "1. Diffuse background slowing, theta predominant (5-6 Hz, 20-30 uV).\n"
            "2. Beta wave: 14-16 Hz, 5-10 uV.\n"
            "3. Hyperventilation: cannot cooperate.\n"
            "4. Photic sensitivity: no photic drive response.\n"
            "5. No epiletiform discharge.\n\n"
            "Conclusion: the EEG findings suggest diffuse cortical dysfunction."
        ),
        "impression": "Diffuse cortical dysfunction. No epileptiform discharge.",
        "reporter_name": "DAX32-廖岐禮",
        "status": "final",
    },
    {
        "id": "rpt_004",
        "patient_id": "pat_001",
        "report_type": "procedure",
        "exam_name": "Echocardiography (TTE)",
        "exam_date": "2025-10-25 11:00:00+08",
        "body_text": (
            "Transthoracic echocardiography:\n"
            "- LV systolic function: mildly reduced, estimated EF 45%.\n"
            "- LV wall motion: global hypokinesis.\n"
            "- RV size and function: normal.\n"
            "- Valvular: mild MR, mild TR. No significant AS or AI.\n"
            "- No pericardial effusion.\n"
            "- IVC: dilated with <50% respiratory variation, estimated RAP 10-15 mmHg."
        ),
        "impression": (
            "Mildly reduced LV systolic function with global hypokinesis (EF ~45%).\n"
            "Mild MR/TR. Elevated estimated RAP."
        ),
        "reporter_name": "CV05-林書豪",
        "status": "final",
    },
    {
        "id": "rpt_005",
        "patient_id": "pat_001",
        "report_type": "imaging",
        "exam_name": "Chest CT with contrast",
        "exam_date": "2025-11-10 09:45:00+08",
        "body_text": (
            "CT chest with IV contrast:\n"
            "- No pulmonary embolism identified.\n"
            "- Bilateral pleural effusions, moderate on right, small on left.\n"
            "- Bilateral dependent consolidations, likely atelectasis vs infection.\n"
            "- Diffuse ground-glass opacity in both lungs.\n"
            "- Mediastinal lymph nodes, borderline size (short axis up to 10mm).\n"
            "- ETT, CVC and NG tube in satisfactory position."
        ),
        "impression": (
            "No PE. Bilateral pleural effusions and consolidations.\n"
            "Differential includes atelectasis, infection, or ARDS."
        ),
        "reporter_name": "RAD12-王志明",
        "status": "final",
    },
]


def upgrade() -> None:
    op.create_table(
        "diagnostic_reports",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("patient_id", sa.String(50), sa.ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("report_type", sa.String(50), nullable=False),
        sa.Column("exam_name", sa.String(200), nullable=False),
        sa.Column("exam_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("impression", sa.Text(), nullable=True),
        sa.Column("reporter_name", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'final'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_diagnostic_reports_patient_id", "diagnostic_reports", ["patient_id"])

    # Seed demo data
    conn = op.get_bind()
    for r in _DEMO_REPORTS:
        exists = conn.execute(
            sa.text("SELECT 1 FROM diagnostic_reports WHERE id = :id"),
            {"id": r["id"]},
        ).fetchone()
        if exists:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO diagnostic_reports "
                "(id, patient_id, report_type, exam_name, exam_date, body_text, impression, reporter_name, status) "
                "VALUES (:id, :patient_id, :report_type, :exam_name, :exam_date, :body_text, :impression, :reporter_name, :status)"
            ),
            r,
        )


def downgrade() -> None:
    op.drop_index("ix_diagnostic_reports_patient_id")
    op.drop_table("diagnostic_reports")
