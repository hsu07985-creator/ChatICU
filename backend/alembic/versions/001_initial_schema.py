"""initial schema — all 15 tables

Revision ID: 001_initial
Revises:
Create Date: 2026-02-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Independent tables (no foreign keys) ──

    op.create_table(
        'users',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('username', sa.String(100), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('unit', sa.String(100), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('username'),
    )
    op.create_index('ix_users_username', 'users', ['username'])

    op.create_table(
        'patients',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('bed_number', sa.String(20), nullable=False),
        sa.Column('medical_record_number', sa.String(50), nullable=False),
        sa.Column('age', sa.Integer(), nullable=False),
        sa.Column('gender', sa.String(10), nullable=False),
        sa.Column('height', sa.Float(), nullable=True),
        sa.Column('weight', sa.Float(), nullable=True),
        sa.Column('bmi', sa.Float(), nullable=True),
        sa.Column('diagnosis', sa.String(500), nullable=False),
        sa.Column('symptoms', postgresql.JSONB(), nullable=True),
        sa.Column('intubated', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('critical_status', sa.String(20), nullable=True),
        sa.Column('sedation', postgresql.JSONB(), nullable=True),
        sa.Column('analgesia', postgresql.JSONB(), nullable=True),
        sa.Column('nmb', postgresql.JSONB(), nullable=True),
        sa.Column('admission_date', sa.Date(), nullable=True),
        sa.Column('icu_admission_date', sa.Date(), nullable=True),
        sa.Column('ventilator_days', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('attending_physician', sa.String(100), nullable=True),
        sa.Column('department', sa.String(100), nullable=True),
        sa.Column('alerts', postgresql.JSONB(), nullable=True),
        sa.Column('consent_status', sa.String(20), nullable=True),
        sa.Column('allergies', postgresql.JSONB(), nullable=True),
        sa.Column('blood_type', sa.String(10), nullable=True),
        sa.Column('code_status', sa.String(20), nullable=True),
        sa.Column('has_dnr', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_isolated', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('last_update', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_patients_bed_number', 'patients', ['bed_number'])
    op.create_index('ix_patients_medical_record_number', 'patients', ['medical_record_number'])

    op.create_table(
        'drug_interactions',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('drug1', sa.String(200), nullable=False),
        sa.Column('drug2', sa.String(200), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('mechanism', sa.Text(), nullable=True),
        sa.Column('clinical_effect', sa.Text(), nullable=True),
        sa.Column('management', sa.Text(), nullable=True),
        sa.Column('references', sa.Text(), nullable=True),
    )
    op.create_index('ix_drug_interactions_drug1', 'drug_interactions', ['drug1'])
    op.create_index('ix_drug_interactions_drug2', 'drug_interactions', ['drug2'])

    op.create_table(
        'iv_compatibilities',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('drug1', sa.String(200), nullable=False),
        sa.Column('drug2', sa.String(200), nullable=False),
        sa.Column('solution', sa.String(50), nullable=True),
        sa.Column('compatible', sa.Boolean(), nullable=False),
        sa.Column('time_stability', sa.String(50), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('references', sa.Text(), nullable=True),
    )
    op.create_index('ix_iv_compatibilities_drug1', 'iv_compatibilities', ['drug1'])
    op.create_index('ix_iv_compatibilities_drug2', 'iv_compatibilities', ['drug2'])

    op.create_table(
        'error_reports',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), nullable=True),
        sa.Column('reporter_id', sa.String(50), nullable=False),
        sa.Column('reporter_name', sa.String(100), nullable=False),
        sa.Column('reporter_role', sa.String(20), nullable=False),
        sa.Column('error_type', sa.String(50), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('medication_name', sa.String(200), nullable=True),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('action_taken', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column('reviewed_by', postgresql.JSONB(), nullable=True),
        sa.Column('resolution', sa.Text(), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_error_reports_patient_id', 'error_reports', ['patient_id'])
    op.create_index('ix_error_reports_reporter_id', 'error_reports', ['reporter_id'])

    op.create_table(
        'ai_sessions',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('user_id', sa.String(50), nullable=False),
        sa.Column('patient_id', sa.String(50), nullable=True),
        sa.Column('title', sa.String(200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_ai_sessions_user_id', 'ai_sessions', ['user_id'])
    op.create_index('ix_ai_sessions_patient_id', 'ai_sessions', ['patient_id'])

    # ── Tables with foreign keys ──

    op.create_table(
        'vital_signs',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), sa.ForeignKey('patients.id'), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('heart_rate', sa.Integer(), nullable=True),
        sa.Column('systolic_bp', sa.Integer(), nullable=True),
        sa.Column('diastolic_bp', sa.Integer(), nullable=True),
        sa.Column('mean_bp', sa.Float(), nullable=True),
        sa.Column('respiratory_rate', sa.Integer(), nullable=True),
        sa.Column('spo2', sa.Integer(), nullable=True),
        sa.Column('temperature', sa.Float(), nullable=True),
        sa.Column('reference_ranges', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_vital_signs_patient_id', 'vital_signs', ['patient_id'])

    op.create_table(
        'lab_data',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), sa.ForeignKey('patients.id'), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('biochemistry', postgresql.JSONB(), nullable=True),
        sa.Column('hematology', postgresql.JSONB(), nullable=True),
        sa.Column('blood_gas', postgresql.JSONB(), nullable=True),
        sa.Column('inflammatory', postgresql.JSONB(), nullable=True),
        sa.Column('coagulation', postgresql.JSONB(), nullable=True),
        sa.Column('corrections', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_lab_data_patient_id', 'lab_data', ['patient_id'])

    op.create_table(
        'medications',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), sa.ForeignKey('patients.id'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('generic_name', sa.String(200), nullable=True),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('san_category', sa.String(5), nullable=True),
        sa.Column('dose', sa.String(50), nullable=True),
        sa.Column('unit', sa.String(20), nullable=True),
        sa.Column('frequency', sa.String(50), nullable=True),
        sa.Column('route', sa.String(20), nullable=True),
        sa.Column('prn', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('indication', sa.String(500), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default=sa.text("'active'")),
        sa.Column('prescribed_by', postgresql.JSONB(), nullable=True),
        sa.Column('warnings', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_medications_patient_id', 'medications', ['patient_id'])

    op.create_table(
        'patient_messages',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), sa.ForeignKey('patients.id'), nullable=False),
        sa.Column('author_id', sa.String(50), nullable=False),
        sa.Column('author_name', sa.String(100), nullable=False),
        sa.Column('author_role', sa.String(20), nullable=False),
        sa.Column('message_type', sa.String(30), nullable=False, server_default=sa.text("'general'")),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('linked_medication', sa.String(200), nullable=True),
        sa.Column('advice_code', sa.String(10), nullable=True),
        sa.Column('read_by', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_patient_messages_patient_id', 'patient_messages', ['patient_id'])
    op.create_index('ix_patient_messages_author_id', 'patient_messages', ['author_id'])

    op.create_table(
        'ventilator_settings',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), sa.ForeignKey('patients.id'), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('mode', sa.String(20), nullable=True),
        sa.Column('fio2', sa.Integer(), nullable=True),
        sa.Column('peep', sa.Integer(), nullable=True),
        sa.Column('tidal_volume', sa.Integer(), nullable=True),
        sa.Column('respiratory_rate', sa.Integer(), nullable=True),
        sa.Column('inspiratory_pressure', sa.Integer(), nullable=True),
        sa.Column('pressure_support', sa.Integer(), nullable=True),
        sa.Column('ie_ratio', sa.String(10), nullable=True),
        sa.Column('pip', sa.Integer(), nullable=True),
        sa.Column('plateau', sa.Integer(), nullable=True),
        sa.Column('compliance', sa.Integer(), nullable=True),
        sa.Column('resistance', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_ventilator_settings_patient_id', 'ventilator_settings', ['patient_id'])

    op.create_table(
        'weaning_assessments',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('patient_id', sa.String(50), sa.ForeignKey('patients.id'), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('rsbi', sa.Integer(), nullable=True),
        sa.Column('nif', sa.Integer(), nullable=True),
        sa.Column('vt', sa.Integer(), nullable=True),
        sa.Column('rr', sa.Integer(), nullable=True),
        sa.Column('spo2', sa.Integer(), nullable=True),
        sa.Column('fio2', sa.Integer(), nullable=True),
        sa.Column('peep', sa.Integer(), nullable=True),
        sa.Column('gcs', sa.Integer(), nullable=True),
        sa.Column('cough_strength', sa.String(20), nullable=True),
        sa.Column('secretions', sa.String(20), nullable=True),
        sa.Column('hemodynamic_stability', sa.Boolean(), nullable=True),
        sa.Column('recommendation', sa.Text(), nullable=True),
        sa.Column('readiness_score', sa.Integer(), nullable=True),
        sa.Column('assessed_by', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_weaning_assessments_patient_id', 'weaning_assessments', ['patient_id'])

    op.create_table(
        'team_chat_messages',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('user_id', sa.String(50), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('user_name', sa.String(100), nullable=False),
        sa.Column('user_role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('pinned_by', postgresql.JSONB(), nullable=True),
        sa.Column('pinned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_team_chat_messages_user_id', 'team_chat_messages', ['user_id'])

    op.create_table(
        'audit_logs',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('user_id', sa.String(50), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('user_name', sa.String(100), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('target', sa.String(200), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default=sa.text("'success'")),
        sa.Column('ip', sa.String(50), nullable=True),
        sa.Column('details', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'])

    op.create_table(
        'ai_messages',
        sa.Column('id', sa.String(50), primary_key=True),
        sa.Column('session_id', sa.String(50), sa.ForeignKey('ai_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('citations', postgresql.JSONB(), nullable=True),
        sa.Column('suggested_actions', postgresql.JSONB(), nullable=True),
        sa.Column('token_count', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_ai_messages_session_id', 'ai_messages', ['session_id'])


def downgrade() -> None:
    # Drop in reverse order (FK-dependent tables first)
    op.drop_table('ai_messages')
    op.drop_table('audit_logs')
    op.drop_table('team_chat_messages')
    op.drop_table('weaning_assessments')
    op.drop_table('ventilator_settings')
    op.drop_table('patient_messages')
    op.drop_table('medications')
    op.drop_table('lab_data')
    op.drop_table('vital_signs')
    op.drop_table('ai_sessions')
    op.drop_table('error_reports')
    op.drop_table('iv_compatibilities')
    op.drop_table('drug_interactions')
    op.drop_table('patients')
    op.drop_table('users')
