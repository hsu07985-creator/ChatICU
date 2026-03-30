"""seed culture_results data (fix JSONB insert from 024)

Revision ID: 025
Revises: 024
Create Date: 2026-03-30
"""
import json
import uuid

from alembic import op
import sqlalchemy as sa

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None

SEED_CULTURES = [
    ("pat_001", "M11411L014001", "Sputum", "SP01", "加護病房一",
     "2025-11-10T08:30:00+08:00", "2025-11-13T14:00:00+08:00",
     [{"code": "XORG1", "organism": "Stenotrophomonas maltophilia"}],
     [{"antibiotic": "Levofloxacin", "code": "LVX", "result": "S"},
      {"antibiotic": "Trimethoprim/Sulfamethoxazole", "code": "SXT", "result": "S"}]),
    ("pat_001", "M11411L014002", "Sputum", "SP01", "加護病房一",
     "2025-11-05T06:15:00+08:00", "2025-11-08T10:30:00+08:00",
     [{"code": "XORG2", "organism": "Klebsiella pneumoniae"}],
     [{"antibiotic": "Meropenem", "code": "MEM", "result": "S"},
      {"antibiotic": "Ceftazidime", "code": "CAZ", "result": "R"},
      {"antibiotic": "Piperacillin/Tazobactam", "code": "TZP", "result": "I"},
      {"antibiotic": "Amikacin", "code": "AMK", "result": "S"}]),
    ("pat_001", "M11410L036001", "Blood", "BL01", "加護病房一",
     "2025-10-28T17:00:00+08:00", "2025-10-31T13:00:00+08:00", [], []),
    ("pat_001", "M11410L036002", "Sputum", "SP03", "加護病房一",
     "2025-10-25T09:00:00+08:00", "2025-10-28T11:00:00+08:00", [], []),
    ("pat_002", "M11411L020001", "Blood", "BL01", "加護病房一",
     "2025-11-12T03:00:00+08:00", "2025-11-15T09:30:00+08:00",
     [{"code": "XORG1", "organism": "Escherichia coli"},
      {"code": "XORG2", "organism": "Enterococcus faecalis"}],
     [{"antibiotic": "Ampicillin", "code": "AMP", "result": "R"},
      {"antibiotic": "Ceftriaxone", "code": "CRO", "result": "S"},
      {"antibiotic": "Ciprofloxacin", "code": "CIP", "result": "R"},
      {"antibiotic": "Meropenem", "code": "MEM", "result": "S"},
      {"antibiotic": "Vancomycin", "code": "VAN", "result": "S"}]),
    ("pat_002", "M11411L020002", "Urine(導尿)", "UR024", "加護病房一",
     "2025-11-12T03:10:00+08:00", "2025-11-14T16:00:00+08:00",
     [{"code": "XORG1", "organism": "Escherichia coli"}],
     [{"antibiotic": "Ampicillin", "code": "AMP", "result": "R"},
      {"antibiotic": "Ceftriaxone", "code": "CRO", "result": "S"},
      {"antibiotic": "Ciprofloxacin", "code": "CIP", "result": "R"},
      {"antibiotic": "Nitrofurantoin", "code": "NIT", "result": "S"}]),
    ("pat_002", "M11411L020003", "Blood", "BL01", "加護病房一",
     "2025-11-08T22:00:00+08:00", "2025-11-11T14:00:00+08:00", [], []),
    ("pat_003", "M11411L025001", "Urine(導尿)", "UR024", "加護病房一",
     "2025-11-14T10:00:00+08:00", "2025-11-17T11:00:00+08:00",
     [{"code": "XORG1", "organism": "Candida albicans"}],
     [{"antibiotic": "Fluconazole", "code": "FCA", "result": "S"},
      {"antibiotic": "Amphotericin B", "code": "AMB", "result": "S"},
      {"antibiotic": "Caspofungin", "code": "CAS", "result": "S"}]),
    ("pat_003", "M11411L025002", "Blood", "BL01", "加護病房一",
     "2025-11-14T10:05:00+08:00", "2025-11-17T15:00:00+08:00", [], []),
    ("pat_003", "M11411L025003", "Urine(導尿)", "UR024", "加護病房一",
     "2025-11-08T08:00:00+08:00", "2025-11-10T14:00:00+08:00", [], []),
    ("pat_004", "M11411L030001", "Wound", "WD01", "加護病房一",
     "2025-11-15T14:00:00+08:00", "2025-11-18T10:00:00+08:00",
     [{"code": "XORG1", "organism": "Staphylococcus aureus (MSSA)"}],
     [{"antibiotic": "Oxacillin", "code": "OXA", "result": "S"},
      {"antibiotic": "Vancomycin", "code": "VAN", "result": "S"},
      {"antibiotic": "Clindamycin", "code": "CLI", "result": "S"},
      {"antibiotic": "Trimethoprim/Sulfamethoxazole", "code": "SXT", "result": "S"}]),
    ("pat_004", "M11411L030002", "CSF", "CS01", "加護病房一",
     "2025-11-15T14:30:00+08:00", "2025-11-18T16:00:00+08:00", [], []),
]


def upgrade() -> None:
    # Clear any partial data from 024's failed seed attempt
    op.execute(sa.text("DELETE FROM culture_results"))

    # Re-seed with proper JSONB casting
    for pid, sheet, spec, spec_code, dept, col_at, rep_at, iso, susc in SEED_CULTURES:
        cid = f"culture_{uuid.uuid4().hex[:12]}"
        op.execute(
            sa.text(
                "INSERT INTO culture_results "
                "(id, patient_id, sheet_number, specimen, specimen_code, "
                "department, collected_at, reported_at, isolates, susceptibility, "
                "created_at, updated_at) "
                "VALUES (:id, :pid, :sheet, :spec, :spec_code, :dept, "
                "CAST(:col_at AS timestamptz), CAST(:rep_at AS timestamptz), "
                "CAST(:iso AS jsonb), CAST(:susc AS jsonb), NOW(), NOW())"
            ).bindparams(
                id=cid, pid=pid, sheet=sheet, spec=spec, spec_code=spec_code,
                dept=dept, col_at=col_at, rep_at=rep_at,
                iso=json.dumps(iso), susc=json.dumps(susc),
            )
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM culture_results"))
