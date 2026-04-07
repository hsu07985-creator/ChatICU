"""Add q_score, result columns to culture_results + update seed data with colonies, normal flora, bile.

Revision ID: 044
Revises: 043
Create Date: 2026-04-08
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "044"
down_revision = "043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add new columns
    op.add_column("culture_results", sa.Column("q_score", sa.Integer(), nullable=True))
    op.add_column("culture_results", sa.Column("result", sa.String(200), nullable=True))

    # 2. Update existing sputum seed data with q_score and colonies in isolates
    conn = op.get_bind()

    # pat_001 Sputum M11411L014001 — Stenotrophomonas maltophilia, q_score=1, colonies=Moderate
    conn.execute(sa.text(
        "UPDATE culture_results SET q_score = 1, "
        "isolates = CAST(:iso AS jsonb) "
        "WHERE patient_id = 'pat_001' AND sheet_number = 'M11411L014001'"
    ).bindparams(
        iso=json.dumps([{"code": "XORG1", "organism": "Stenotrophomonas maltophilia", "colonies": "Moderate"}])
    ))

    # pat_001 Sputum M11411L014002 — Klebsiella pneumoniae, q_score=0, colonies=Heavy
    conn.execute(sa.text(
        "UPDATE culture_results SET q_score = 0, "
        "isolates = CAST(:iso AS jsonb) "
        "WHERE patient_id = 'pat_001' AND sheet_number = 'M11411L014002'"
    ).bindparams(
        iso=json.dumps([{"code": "XORG2", "organism": "Klebsiella pneumoniae", "colonies": "Heavy"}])
    ))

    # pat_001 Sputum M11410L036002 — was empty (no growth), set q_score=2
    conn.execute(sa.text(
        "UPDATE culture_results SET q_score = 2 "
        "WHERE patient_id = 'pat_001' AND sheet_number = 'M11410L036002'"
    ))

    # 3. Insert new Normal flora sputum culture for pat_001
    import uuid
    cid = f"culture_{uuid.uuid4().hex[:12]}"
    conn.execute(sa.text(
        "INSERT INTO culture_results "
        "(id, patient_id, sheet_number, specimen, specimen_code, "
        "department, collected_at, reported_at, isolates, susceptibility, "
        "q_score, result, created_at, updated_at) "
        "VALUES (:id, :pid, :sheet, :spec, :spec_code, :dept, "
        "CAST(:col_at AS timestamptz), CAST(:rep_at AS timestamptz), "
        "CAST(:iso AS jsonb), CAST(:susc AS jsonb), :q_score, :result, NOW(), NOW())"
    ).bindparams(
        id=cid, pid="pat_001", sheet="M11411L014003", spec="Sputum", spec_code="SP01",
        dept="加護病房一",
        col_at="2025-11-01T07:00:00+08:00", rep_at="2025-11-04T09:00:00+08:00",
        iso=json.dumps([]), susc=json.dumps([]),
        q_score=2, result="Normal oral flora",
    ))

    # 4. Insert bile culture for pat_002
    cid2 = f"culture_{uuid.uuid4().hex[:12]}"
    conn.execute(sa.text(
        "INSERT INTO culture_results "
        "(id, patient_id, sheet_number, specimen, specimen_code, "
        "department, collected_at, reported_at, isolates, susceptibility, "
        "q_score, result, created_at, updated_at) "
        "VALUES (:id, :pid, :sheet, :spec, :spec_code, :dept, "
        "CAST(:col_at AS timestamptz), CAST(:rep_at AS timestamptz), "
        "CAST(:iso AS jsonb), CAST(:susc AS jsonb), :q_score, :result, NOW(), NOW())"
    ).bindparams(
        id=cid2, pid="pat_002", sheet="M11411L020004", spec="Bile Fluid", spec_code="BF01",
        dept="加護病房一",
        col_at="2025-11-13T11:00:00+08:00", rep_at="2025-11-16T14:00:00+08:00",
        iso=json.dumps([
            {"code": "XORG1", "organism": "Escherichia coli", "colonies": "Heavy"},
            {"code": "XORG2", "organism": "Enterococcus casseliflavus", "colonies": "Light"},
        ]),
        susc=json.dumps([
            {"antibiotic": "Ampicillin", "code": "AMP", "result": "R"},
            {"antibiotic": "Ceftriaxone", "code": "CRO", "result": "S"},
            {"antibiotic": "Meropenem", "code": "MEM", "result": "S"},
            {"antibiotic": "Vancomycin", "code": "VAN", "result": "S"},
        ]),
        q_score=None, result=None,
    ))

    # 5. Insert "No growth to date" blood culture for pat_003
    cid3 = f"culture_{uuid.uuid4().hex[:12]}"
    conn.execute(sa.text(
        "INSERT INTO culture_results "
        "(id, patient_id, sheet_number, specimen, specimen_code, "
        "department, collected_at, reported_at, isolates, susceptibility, "
        "q_score, result, created_at, updated_at) "
        "VALUES (:id, :pid, :sheet, :spec, :spec_code, :dept, "
        "CAST(:col_at AS timestamptz), CAST(:rep_at AS timestamptz), "
        "CAST(:iso AS jsonb), CAST(:susc AS jsonb), :q_score, :result, NOW(), NOW())"
    ).bindparams(
        id=cid3, pid="pat_003", sheet="M11411L025004", spec="Blood", spec_code="BL01",
        dept="加護病房一",
        col_at="2025-11-16T20:00:00+08:00", rep_at="2025-11-19T08:00:00+08:00",
        iso=json.dumps([]), susc=json.dumps([]),
        q_score=None, result="No growth to date",
    ))


def downgrade() -> None:
    op.drop_column("culture_results", "result")
    op.drop_column("culture_results", "q_score")
    # Note: inserted seed rows remain; 025 handles cleanup via DELETE FROM culture_results
