"""Per-user scoping on pharmacy-advice endpoints.

Each pharmacist / admin only sees statistics and records they themselves
authored (``PharmacyAdvice.pharmacist_id`` for the widget path,
``PatientMessage.author_id`` for the bulletin-sync path). These tests
swap the mock auth user mid-test to confirm the filter isn't leaking
data across users.
"""
import pytest
import pytest_asyncio
from datetime import datetime, timezone

from app.main import app
from app.middleware.auth import get_current_user
from app.models.user import User
from app.models.pharmacy_advice import PharmacyAdvice
from app.models.message import PatientMessage


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
            unit="ICU",
            active=True,
        )
    return _inner


@pytest_asyncio.fixture
async def two_pharmacists(seeded_db):
    """Seed a second pharmacist alongside the default usr_test admin."""
    other = User(
        id="usr_pharm_b",
        name="Pharmacist B",
        username="pharmb",
        password_hash="",
        email="pharmb@hospital.com",
        role="pharmacist",
        unit="Pharmacy",
        active=True,
    )
    seeded_db.add(other)
    await seeded_db.commit()
    return seeded_db


@pytest.mark.asyncio
async def test_stats_isolated_per_pharmacist(client, two_pharmacists):
    # usr_test (admin) creates one advice via widget
    await client.post("/pharmacy/advice-records", json={
        "patientId": "pat_001",
        "adviceCode": "1-A",
        "adviceLabel": "給藥問題",
        "category": "1. 建議處方",
        "content": "A's advice",
    })

    # Swap mock auth to Pharmacist B, create two advices
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_b", "Pharmacist B", role="pharmacist",
    )
    try:
        for code in ("2-O", "3-R"):
            await client.post("/pharmacy/advice-records", json={
                "patientId": "pat_001",
                "adviceCode": code,
                "adviceLabel": "irrelevant",
                "category": "2. 主動建議" if code.startswith("2-") else "3. 建議監測",
                "content": f"B's advice {code}",
            })

        # Stats as B → sees only B's 2 rows
        stats_b = (await client.get("/pharmacy/advice-records/stats")).json()["data"]
        assert stats_b["total"] == 2
        by_pharm_b = {p["pharmacistName"] for p in stats_b["byPharmacist"]}
        assert by_pharm_b == {"Pharmacist B"}

        # List as B → only B's rows
        list_b = (await client.get("/pharmacy/advice-records")).json()["data"]
        assert list_b["total"] == 2
        assert all(r["pharmacistName"] == "Pharmacist B" for r in list_b["records"])
    finally:
        # Restore original user override (client fixture resets on teardown, but
        # be explicit so subsequent assertions aren't surprised).
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )

    # Stats as usr_test (admin) → sees only A's 1 row, NOT B's 2
    stats_a = (await client.get("/pharmacy/advice-records/stats")).json()["data"]
    assert stats_a["total"] == 1
    assert {p["pharmacistName"] for p in stats_a["byPharmacist"]} == {"Test Doctor"}

    list_a = (await client.get("/pharmacy/advice-records")).json()["data"]
    assert list_a["total"] == 1
    assert list_a["records"][0]["pharmacistName"] == "Test Doctor"


@pytest.mark.asyncio
async def test_orphan_tag_stats_isolated_per_author(client, two_pharmacists):
    """Orphans are scoped by PatientMessage.author_id so A doesn't see B's
    historical leftovers."""
    now = datetime.now(timezone.utc)
    two_pharmacists.add(PatientMessage(
        id="pmsg_orphan_A",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doctor",
        author_role="admin",
        message_type="general",
        content="A's orphan",
        timestamp=now,
        is_read=False,
        tags=["1-A 給藥問題"],
    ))
    two_pharmacists.add(PatientMessage(
        id="pmsg_orphan_B",
        patient_id="pat_001",
        author_id="usr_pharm_b",
        author_name="Pharmacist B",
        author_role="pharmacist",
        message_type="general",
        content="B's orphan",
        timestamp=now,
        is_read=False,
        tags=["2-O 建議用藥/建議增加用藥"],
    ))
    await two_pharmacists.commit()

    # As A → 1 orphan
    resp_a = (await client.get("/pharmacy/advice-records/orphan-tag-stats")).json()["data"]
    assert resp_a["total"] == 1
    assert resp_a["samples"][0]["messageId"] == "pmsg_orphan_A"

    # Swap to B → only B's orphan
    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_b", "Pharmacist B", role="pharmacist",
    )
    try:
        resp_b = (await client.get("/pharmacy/advice-records/orphan-tag-stats")).json()["data"]
        assert resp_b["total"] == 1
        assert resp_b["samples"][0]["messageId"] == "pmsg_orphan_B"
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )


@pytest.mark.asyncio
async def test_empty_when_user_never_authored_any_advice(client, two_pharmacists):
    """usr_test creates advice; Pharmacist B who never authored anything sees zero."""
    await client.post("/pharmacy/advice-records", json={
        "patientId": "pat_001",
        "adviceCode": "1-A",
        "adviceLabel": "給藥問題",
        "category": "1. 建議處方",
        "content": "only A's",
    })

    app.dependency_overrides[get_current_user] = _user_override(
        "usr_pharm_b", "Pharmacist B", role="pharmacist",
    )
    try:
        stats_b = (await client.get("/pharmacy/advice-records/stats")).json()["data"]
        assert stats_b["total"] == 0
        assert stats_b["byCategory"] == []
        assert stats_b["byPharmacist"] == []

        list_b = (await client.get("/pharmacy/advice-records")).json()["data"]
        assert list_b["total"] == 0
        assert list_b["records"] == []
    finally:
        app.dependency_overrides[get_current_user] = _user_override(
            "usr_test", "Test Doctor", role="admin",
        )
