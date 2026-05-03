"""Pharmacist SOAP record endpoints — TC-FU-T2.

Covers the persisted SOAP flow that backs ``pharmacist-soap-editor.tsx``:
* create + retrieve own
* per-user scope (pharmacist B never sees pharmacist A's rows)
* role gating (only pharmacist / admin can create)
* admin sees only their own (no global admin override)
* search across assessment + plan free text
"""
import pytest
import pytest_asyncio

from app.main import app
from app.middleware.auth import get_current_user
from app.models.user import User


pytestmark = pytest.mark.anyio


def _user_override(user_id: str, name: str, role: str = "pharmacist"):
    async def _inner():
        return User(
            id=user_id,
            name=name,
            username=user_id,
            password_hash="",
            email=f"{user_id}@hospital.com",
            role=role,
            unit="Pharmacy" if role == "pharmacist" else "ICU",
            active=True,
        )
    return _inner


@pytest_asyncio.fixture
async def two_pharmacists(seeded_db):
    """Seed pharmacist B and pharmacist A alongside the default usr_test admin."""
    seeded_db.add(User(
        id="usr_pharm_a",
        name="Pharmacist A",
        username="pharma",
        password_hash="",
        email="pharma@hospital.com",
        role="pharmacist",
        unit="Pharmacy",
        active=True,
    ))
    seeded_db.add(User(
        id="usr_pharm_b",
        name="Pharmacist B",
        username="pharmb",
        password_hash="",
        email="pharmb@hospital.com",
        role="pharmacist",
        unit="Pharmacy",
        active=True,
    ))
    seeded_db.add(User(
        id="usr_doctor_x",
        name="Doctor X",
        username="docx",
        password_hash="",
        email="docx@hospital.com",
        role="doctor",
        unit="ICU",
        active=True,
    ))
    await seeded_db.commit()
    return seeded_db


@pytest.mark.asyncio
async def test_pharmacist_can_create_and_retrieve_own_soap(client, two_pharmacists):
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_a", "Pharmacist A", role="pharmacist",
    )
    try:
        resp = await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_001",
            "subjective": "c/o dyspnea",
            "objective": "Cr 1.8, K 5.8",
            "assessment": "AKI on CKD",
            "plan": "Hold ARB; recheck Cr q24h",
            "polished": "S — c/o dyspnea\n\nO — Cr 1.8, K 5.8\n\nA — AKI on CKD\n\nP — Hold ARB; recheck Cr q24h",
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["success"] is True
        rec = body["data"]
        assert rec["id"].startswith("psoap_")
        assert rec["pharmacistName"] == "Pharmacist A"
        assert rec["patientId"] == "pat_001"
        assert rec["bedNumber"] == "I-1"
        assert rec["assessment"] == "AKI on CKD"
        assert rec["plan"].startswith("Hold ARB")
        assert rec["polishedContent"].startswith("S — ")

        list_resp = await client.get("/pharmacy/soap-records")
        assert list_resp.status_code == 200
        list_body = list_resp.json()["data"]
        assert list_body["total"] == 1
        assert list_body["records"][0]["id"] == rec["id"]
        assert list_body["records"][0]["patientName"] == "許先生"
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_other_pharmacist_cannot_see_my_soap(client, two_pharmacists):
    # Pharmacist A creates one
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_a", "Pharmacist A", role="pharmacist",
    )
    try:
        await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_001",
            "assessment": "A's assessment",
            "plan": "A's plan",
        })

        # Switch to Pharmacist B
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_pharm_b", "Pharmacist B", role="pharmacist",
        )
        list_b = (await client.get("/pharmacy/soap-records")).json()["data"]
        assert list_b["total"] == 0
        assert list_b["records"] == []
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_non_pharmacist_cannot_create(client, two_pharmacists):
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_doctor_x", "Doctor X", role="doctor",
    )
    try:
        resp = await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_001",
            "assessment": "Doctor's note",
            "plan": "Doctor's plan",
        })
        assert resp.status_code == 403, resp.text
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_admin_only_sees_own(client, two_pharmacists):
    """Admin (usr_test) is *not* given a global view; they see only their own."""
    # Pharmacist A creates one
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_a", "Pharmacist A", role="pharmacist",
    )
    try:
        await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_001",
            "assessment": "A's assessment",
            "plan": "A's plan",
        })
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )

    # As admin (usr_test) — created none of their own → list is empty
    list_admin = (await client.get("/pharmacy/soap-records")).json()["data"]
    assert list_admin["total"] == 0
    assert list_admin["records"] == []

    # Admin then creates one of their own → only sees that one
    create_resp = await client.post("/pharmacy/soap-records", json={
        "patientId": "pat_001",
        "assessment": "admin assessment",
        "plan": "admin plan",
    })
    assert create_resp.status_code == 200
    list_admin2 = (await client.get("/pharmacy/soap-records")).json()["data"]
    assert list_admin2["total"] == 1
    assert list_admin2["records"][0]["pharmacistName"] == "Test Doctor"


@pytest.mark.asyncio
async def test_search_filters_by_assessment_or_plan_text(client, two_pharmacists):
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_a", "Pharmacist A", role="pharmacist",
    )
    try:
        # Three SOAPs with different searchable terms.
        await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_001",
            "assessment": "CRE pneumonia worsening",
            "plan": "Add ceftazidime-avibactam",
        })
        await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_001",
            "assessment": "AKI on CKD",
            "plan": "Hold ARB",
        })
        await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_001",
            "assessment": "stable septic shock",
            "plan": "Continue meropenem 1g q8h",
        })

        # search hits assessment field
        r1 = await client.get("/pharmacy/soap-records", params={"search": "CRE"})
        d1 = r1.json()["data"]
        assert d1["total"] == 1
        assert "CRE" in d1["records"][0]["assessment"]

        # search hits plan field
        r2 = await client.get("/pharmacy/soap-records", params={"search": "meropenem"})
        d2 = r2.json()["data"]
        assert d2["total"] == 1
        assert "meropenem" in d2["records"][0]["plan"]

        # search miss
        r3 = await client.get("/pharmacy/soap-records", params={"search": "xyz_no_match"})
        assert r3.json()["data"]["total"] == 0
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_invalid_patient_id_returns_422(client, two_pharmacists):
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_a", "Pharmacist A", role="pharmacist",
    )
    try:
        resp = await client.post("/pharmacy/soap-records", json={
            "patientId": "pat_does_not_exist",
            "assessment": "x",
            "plan": "y",
        })
        assert resp.status_code == 422, resp.text
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )
