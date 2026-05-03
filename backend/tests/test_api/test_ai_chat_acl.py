"""Tests for W1-T1 patient-level ACL on AI chat.

Covers app/services/patient_acl.py:assert_patient_chat_access:
  - role gate (clinical vs non-clinical)
  - patient existence check (404 instead of leaking)
  - audit log emission for both success and failure
  - no-op when patient_id is None
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.user import User
from app.services.patient_acl import assert_patient_chat_access


def _user(role: str) -> User:
    return User(
        id="usr_acl_test",
        name="ACL Tester",
        username="acltest",
        password_hash="",
        email="acl@hospital.com",
        role=role,
        unit="ICU",
        active=True,
    )


@pytest.mark.asyncio
async def test_no_patient_id_skips_check(seeded_db):
    # patient_id=None → no DB check, no audit log, no exception
    await assert_patient_chat_access(seeded_db, _user("doctor"), None)
    rows = (await seeded_db.execute(select(AuditLog))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_existing_patient_clinical_role_succeeds(seeded_db):
    await assert_patient_chat_access(seeded_db, _user("doctor"), "pat_001")
    logs = (await seeded_db.execute(select(AuditLog))).scalars().all()
    assert len(logs) == 1
    assert logs[0].action == "ai_chat_patient_access"
    assert logs[0].target == "pat_001"
    assert logs[0].status == "success"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["admin", "doctor", "np", "nurse", "pharmacist"])
async def test_all_clinical_roles_pass(seeded_db, role):
    await assert_patient_chat_access(seeded_db, _user(role), "pat_001")


@pytest.mark.asyncio
async def test_non_clinical_role_rejected(seeded_db):
    with pytest.raises(HTTPException) as exc:
        await assert_patient_chat_access(seeded_db, _user("guest"), "pat_001")
    assert exc.value.status_code == 403

    logs = (await seeded_db.execute(select(AuditLog))).scalars().all()
    assert len(logs) == 1
    assert logs[0].action == "ai_chat_access_denied"
    assert logs[0].status == "failed"
    assert logs[0].details["reason"] == "non_clinical_role"


@pytest.mark.asyncio
async def test_unknown_patient_id_returns_404(seeded_db):
    with pytest.raises(HTTPException) as exc:
        await assert_patient_chat_access(seeded_db, _user("doctor"), "pat_doesnotexist")
    assert exc.value.status_code == 404

    logs = (await seeded_db.execute(select(AuditLog))).scalars().all()
    assert len(logs) == 1
    assert logs[0].action == "ai_chat_access_denied"
    assert logs[0].status == "failed"
    assert logs[0].details["reason"] == "patient_not_found"
    assert logs[0].target == "pat_doesnotexist"


@pytest.mark.asyncio
async def test_ip_recorded_in_audit(seeded_db):
    await assert_patient_chat_access(
        seeded_db, _user("nurse"), "pat_001", ip="10.1.2.3"
    )
    log = (await seeded_db.execute(select(AuditLog))).scalar_one()
    assert log.ip == "10.1.2.3"
