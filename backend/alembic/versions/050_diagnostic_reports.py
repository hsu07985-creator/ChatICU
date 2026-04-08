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
    # --- pat_002 林小姐: 敗血性休克併多重器官衰竭 ---
    {
        "id": "rpt_006",
        "patient_id": "pat_002",
        "report_type": "imaging",
        "exam_name": "Chest X-ray (Portable)",
        "exam_date": "2025-11-02 07:30:00+08",
        "body_text": (
            "Portable AP view of the chest:\n"
            "- ETT tip 4 cm above the carina.\n"
            "- Right IJV CVC with tip in the SVC.\n"
            "- NG tube tip in the stomach.\n"
            "- Bilateral diffuse alveolar infiltrates, worse on the right.\n"
            "- Small bilateral pleural effusions.\n"
            "- No pneumothorax."
        ),
        "impression": (
            "Bilateral alveolar infiltrates with small pleural effusions.\n"
            "Consider ARDS vs fluid overload in the setting of septic shock."
        ),
        "reporter_name": "RAD08-陳怡安",
        "status": "final",
    },
    {
        "id": "rpt_007",
        "patient_id": "pat_002",
        "report_type": "imaging",
        "exam_name": "CT Abdomen & Pelvis with contrast",
        "exam_date": "2025-11-03 14:20:00+08",
        "body_text": (
            "CT abdomen and pelvis with IV contrast:\n"
            "- Diffuse bowel wall thickening involving the ascending and transverse colon.\n"
            "- Mild pericolonic fat stranding.\n"
            "- Bilateral small pleural effusions with adjacent atelectasis.\n"
            "- Mild ascites in the pelvis.\n"
            "- No free air or abscess formation.\n"
            "- Liver, spleen, and pancreas appear unremarkable.\n"
            "- Bilateral kidneys show normal size with mildly delayed nephrogram."
        ),
        "impression": (
            "Diffuse colitis with pericolonic inflammatory changes.\n"
            "Differential: infectious colitis, ischemic colitis.\n"
            "No drainable abscess or free air."
        ),
        "reporter_name": "RAD12-王志明",
        "status": "final",
    },
    {
        "id": "rpt_008",
        "patient_id": "pat_002",
        "report_type": "procedure",
        "exam_name": "Echocardiography (TTE)",
        "exam_date": "2025-11-04 10:00:00+08",
        "body_text": (
            "Transthoracic echocardiography:\n"
            "- LV systolic function: hyperdynamic, estimated EF 70%.\n"
            "- LV wall motion: normal.\n"
            "- RV size and function: mildly dilated, TAPSE 14mm (mildly reduced).\n"
            "- Valvular: trace MR, mild TR (estimated RVSP 42 mmHg).\n"
            "- No pericardial effusion.\n"
            "- IVC: dilated 2.3 cm with <50% respiratory variation."
        ),
        "impression": (
            "Hyperdynamic LV function (sepsis physiology).\n"
            "Mild RV dysfunction with elevated RVSP.\n"
            "Elevated estimated RAP."
        ),
        "reporter_name": "CV05-林書豪",
        "status": "final",
    },
    {
        "id": "rpt_009",
        "patient_id": "pat_002",
        "report_type": "imaging",
        "exam_name": "Chest CT with contrast (CTPA)",
        "exam_date": "2025-11-06 09:00:00+08",
        "body_text": (
            "CT pulmonary angiography:\n"
            "- No pulmonary embolism.\n"
            "- Bilateral moderate pleural effusions with compressive atelectasis.\n"
            "- Diffuse ground-glass opacity in both lungs, compatible with ARDS.\n"
            "- Mediastinal lymphadenopathy (short axis up to 12mm).\n"
            "- ETT, CVC in satisfactory position.\n"
            "- Small pericardial effusion."
        ),
        "impression": (
            "No PE. Bilateral ARDS pattern with pleural effusions.\n"
            "Reactive mediastinal lymphadenopathy.\n"
            "Small pericardial effusion."
        ),
        "reporter_name": "RAD12-王志明",
        "status": "final",
    },
    # --- pat_003 陳女士: 急性腎衰竭併肺水腫 ---
    {
        "id": "rpt_010",
        "patient_id": "pat_003",
        "report_type": "imaging",
        "exam_name": "Chest X-ray (Portable)",
        "exam_date": "2025-10-28 06:45:00+08",
        "body_text": (
            "Portable AP view of the chest:\n"
            "- No ETT. NG tube tip in the stomach.\n"
            "- Right subclavian double-lumen dialysis catheter with tip in the RA.\n"
            "- Bilateral perihilar haziness with Kerley B lines.\n"
            "- Bilateral pleural effusions, moderate.\n"
            "- Upper lobe pulmonary venous distention.\n"
            "- Cardiomegaly (CTR ~0.60)."
        ),
        "impression": (
            "Pulmonary edema with bilateral pleural effusions.\n"
            "Cardiomegaly. Dialysis catheter in satisfactory position."
        ),
        "reporter_name": "RAD08-陳怡安",
        "status": "final",
    },
    {
        "id": "rpt_011",
        "patient_id": "pat_003",
        "report_type": "imaging",
        "exam_name": "Renal Ultrasound",
        "exam_date": "2025-10-29 10:30:00+08",
        "body_text": (
            "Renal ultrasound:\n"
            "- Right kidney: 10.2 cm, normal cortical thickness, no hydronephrosis.\n"
            "- Left kidney: 10.5 cm, normal cortical thickness, no hydronephrosis.\n"
            "- Bilateral increased renal cortical echogenicity.\n"
            "- No renal mass or calculus identified.\n"
            "- Bladder: Foley catheter in situ, minimal residual."
        ),
        "impression": (
            "Bilateral increased renal cortical echogenicity, compatible with medical renal disease.\n"
            "No hydronephrosis or obstructive uropathy."
        ),
        "reporter_name": "RAD15-張雅婷",
        "status": "final",
    },
    {
        "id": "rpt_012",
        "patient_id": "pat_003",
        "report_type": "procedure",
        "exam_name": "Echocardiography (TTE)",
        "exam_date": "2025-10-30 11:30:00+08",
        "body_text": (
            "Transthoracic echocardiography:\n"
            "- LV systolic function: preserved, estimated EF 55%.\n"
            "- Concentric LV hypertrophy (IVSd 13mm).\n"
            "- Diastolic dysfunction: E/e' ratio 18 (Grade II).\n"
            "- Valvular: moderate MR, mild TR.\n"
            "- Moderate pericardial effusion without tamponade physiology.\n"
            "- IVC: dilated 2.5 cm, no respiratory variation."
        ),
        "impression": (
            "Preserved LVEF with concentric hypertrophy.\n"
            "Grade II diastolic dysfunction (elevated filling pressure).\n"
            "Moderate pericardial effusion. Volume overload physiology."
        ),
        "reporter_name": "CV05-林書豪",
        "status": "final",
    },
    {
        "id": "rpt_013",
        "patient_id": "pat_003",
        "report_type": "imaging",
        "exam_name": "Chest X-ray post-HD",
        "exam_date": "2025-11-01 16:00:00+08",
        "body_text": (
            "Portable AP view of the chest (post-hemodialysis):\n"
            "- Dialysis catheter unchanged.\n"
            "- Interval improvement of pulmonary edema.\n"
            "- Decreased bilateral pleural effusions.\n"
            "- Persistent cardiomegaly.\n"
            "- No new consolidation or pneumothorax."
        ),
        "impression": (
            "Interval improvement of pulmonary edema post-hemodialysis.\n"
            "Persistent cardiomegaly and small residual effusions."
        ),
        "reporter_name": "RAD08-陳怡安",
        "status": "final",
    },
    # --- pat_004 黃先生: 創傷性腦損傷 ---
    {
        "id": "rpt_014",
        "patient_id": "pat_004",
        "report_type": "imaging",
        "exam_name": "CT Without C.M. Brain",
        "exam_date": "2025-11-12 02:15:00+08",
        "body_text": (
            "Non-contrast CT of the head (trauma protocol):\n"
            "- Right frontotemporal acute epidural hematoma (max thickness 15mm).\n"
            "- Midline shift 6mm to the left.\n"
            "- Right temporal bone linear fracture.\n"
            "- Diffuse cerebral edema with effacement of sulci and basal cisterns.\n"
            "- No intraventricular hemorrhage.\n"
            "- Pneumocephalus in the right frontal region."
        ),
        "impression": (
            "Acute right frontotemporal epidural hematoma with mass effect.\n"
            "Midline shift 6mm. Right temporal bone fracture.\n"
            "Diffuse cerebral edema. Neurosurgical emergency."
        ),
        "reporter_name": "RAD12-王志明",
        "status": "final",
    },
    {
        "id": "rpt_015",
        "patient_id": "pat_004",
        "report_type": "imaging",
        "exam_name": "CT C-spine without contrast",
        "exam_date": "2025-11-12 02:30:00+08",
        "body_text": (
            "Non-contrast CT of the cervical spine:\n"
            "- No acute cervical spine fracture or dislocation.\n"
            "- Mild degenerative changes at C5-C6 and C6-C7.\n"
            "- Prevertebral soft tissue within normal limits.\n"
            "- Spinal canal patent at all levels.\n"
            "- Bilateral vertebral artery foramina intact."
        ),
        "impression": (
            "No acute cervical spine injury.\n"
            "Mild degenerative changes at C5-C7."
        ),
        "reporter_name": "RAD12-王志明",
        "status": "final",
    },
    {
        "id": "rpt_016",
        "patient_id": "pat_004",
        "report_type": "imaging",
        "exam_name": "CT Brain post-op follow-up",
        "exam_date": "2025-11-13 08:00:00+08",
        "body_text": (
            "Non-contrast CT of the head (post-craniotomy):\n"
            "- s/p right frontotemporal craniotomy for EDH evacuation.\n"
            "- Residual thin subdural collection along the right convexity (5mm).\n"
            "- Improved midline shift (now 2mm).\n"
            "- Persistent diffuse cerebral edema.\n"
            "- Right frontal EVD catheter with tip in the frontal horn of the right lateral ventricle.\n"
            "- Pneumocephalus decreased compared to prior."
        ),
        "impression": (
            "Post-craniotomy changes with near-complete EDH evacuation.\n"
            "Residual thin subdural collection. Improved mass effect.\n"
            "EVD in satisfactory position."
        ),
        "reporter_name": "RAD08-陳怡安",
        "status": "final",
    },
    {
        "id": "rpt_017",
        "patient_id": "pat_004",
        "report_type": "procedure",
        "exam_name": "清醒腦波 EEG",
        "exam_date": "2025-11-16 14:00:00+08",
        "body_text": (
            "Indication: post-traumatic brain injury, consciousness evaluation\n\n"
            "Finding:\n"
            "1. Background: diffuse theta-delta slowing (3-5 Hz, 20-50 uV), no posterior dominant rhythm.\n"
            "2. Right hemisphere: intermittent polymorphic delta activity (IPDA) over right frontotemporal region.\n"
            "3. Reactivity: minimal attenuation with painful stimulation.\n"
            "4. No definite epileptiform discharges.\n"
            "5. No electrographic seizures recorded during 30 minutes of monitoring.\n\n"
            "Conclusion: severe diffuse encephalopathy with right hemispheric emphasis, consistent with structural lesion."
        ),
        "impression": (
            "Severe diffuse encephalopathy with focal right hemispheric dysfunction.\n"
            "No epileptiform discharges or electrographic seizures."
        ),
        "reporter_name": "DAX32-廖岐禮",
        "status": "final",
    },
    {
        "id": "rpt_018",
        "patient_id": "pat_004",
        "report_type": "imaging",
        "exam_name": "Chest X-ray (Portable)",
        "exam_date": "2025-11-14 07:00:00+08",
        "body_text": (
            "Portable AP view of the chest:\n"
            "- ETT tip 3.5 cm above the carina.\n"
            "- NG tube tip in the stomach.\n"
            "- Right subclavian CVC with tip in the SVC.\n"
            "- Lungs: clear bilateral lung fields.\n"
            "- No pleural effusion or pneumothorax.\n"
            "- Heart size normal."
        ),
        "impression": (
            "Lines and tubes in satisfactory position.\n"
            "No acute cardiopulmonary abnormality."
        ),
        "reporter_name": "RAD08-陳怡安",
        "status": "final",
    },
]


def upgrade() -> None:
    conn = op.get_bind()

    # Create table idempotently (may already exist from startup_migrations)
    conn.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS diagnostic_reports ("
        "id VARCHAR(50) PRIMARY KEY, "
        "patient_id VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, "
        "report_type VARCHAR(50) NOT NULL, "
        "exam_name VARCHAR(200) NOT NULL, "
        "exam_date TIMESTAMPTZ NOT NULL, "
        "body_text TEXT NOT NULL, "
        "impression TEXT, "
        "reporter_name VARCHAR(100), "
        "status VARCHAR(20) NOT NULL DEFAULT 'final', "
        "created_at TIMESTAMPTZ DEFAULT NOW())"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_diagnostic_reports_patient_id "
        "ON diagnostic_reports (patient_id)"
    ))

    # Seed demo data
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
