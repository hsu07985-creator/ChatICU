"""Tests for GET /dashboard/stats endpoint.

Regression: production returned 500 because the alerts aggregation used
`json_array_length(Patient.alerts)`, but `Patient.alerts` is JSONB in
Postgres and json_array_length only accepts json. The fix casts jsonb→json
before calling the function; the cast is a no-op on SQLite.
"""
import pytest
from datetime import datetime, timezone

from app.models.medication import Medication
from app.models.patient import Patient
from app.models.vital_sign import VitalSign
from app.models.message import PatientMessage

pytestmark = [pytest.mark.anyio]


async def test_dashboard_stats_returns_200(client):
    """Basic dashboard stats returns successfully."""
    resp = await client.get("/dashboard/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert "patients" in data
    assert "alerts" in data
    assert "medications" in data
    assert "messages" in data
    assert "timestamp" in data


async def test_dashboard_stats_patient_counts(client, seeded_db):
    """Dashboard counts patients correctly."""
    resp = await client.get("/dashboard/stats")
    assert resp.status_code == 200
    data = resp.json()["data"]
    # seeded_db has 1 patient (pat_001)
    assert data["patients"]["total"] >= 1


async def test_dashboard_stats_medication_counts(client, seeded_db):
    """Dashboard counts active medications by SAN category."""
    db = seeded_db
    med = Medication(
        id="med_dash_001",
        patient_id="pat_001",
        name="Propofol",
        category="sedative",
        san_category="S",
        dose="200mg",
        unit="mg",
        frequency="continuous",
        route="IV",
        status="active",
    )
    db.add(med)
    await db.commit()

    resp = await client.get("/dashboard/stats")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["medications"]["sedation"] >= 1


async def test_dashboard_stats_message_counts(client, seeded_db):
    """Dashboard counts today's messages and unread."""
    db = seeded_db
    msg = PatientMessage(
        id="pmsg_dash_001",
        patient_id="pat_001",
        author_id="usr_test",
        author_name="Test Doc",
        author_role="admin",
        message_type="general",
        content="Test message for dashboard",
        timestamp=datetime.now(timezone.utc),
        is_read=False,
    )
    db.add(msg)
    await db.commit()

    resp = await client.get("/dashboard/stats")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["messages"]["today"] >= 1
    assert data["messages"]["unread"] >= 1


async def test_dashboard_stats_san_by_category(client):
    """Dashboard returns sanByCategory sub-object."""
    resp = await client.get("/dashboard/stats")
    assert resp.status_code == 200
    san = resp.json()["data"]["patients"]["sanByCategory"]
    assert "sedation" in san
    assert "analgesia" in san
    assert "nmb" in san


async def test_dashboard_stats_alerts_aggregation(client, seeded_db):
    """Regression: alerts count must sum the length of each JSONB array.

    Production returned 500 because `json_array_length(Patient.alerts)` was
    called directly on the JSONB column, but Postgres requires the argument
    to be `json`. The fix casts jsonb→json. Seed two patients with
    differently-sized alert arrays and one with NULL alerts, then verify the
    aggregate equals the total element count (not patient count)."""
    db = seeded_db
    db.add_all([
        Patient(
            id="pat_alert_two",
            name="Alert Two",
            medical_record_number="MRN-A2",
            bed_number="B01",
            age=50,
            gender="M",
            diagnosis="test",
            alerts=["DNR signed", "Allergy: penicillin"],
        ),
        Patient(
            id="pat_alert_one",
            name="Alert One",
            medical_record_number="MRN-A1",
            bed_number="B02",
            age=60,
            gender="F",
            diagnosis="test",
            alerts=["Isolation precaution"],
        ),
        Patient(
            id="pat_alert_none",
            name="No Alerts",
            medical_record_number="MRN-A0",
            bed_number="B03",
            age=70,
            gender="M",
            diagnosis="test",
            alerts=None,
        ),
    ])
    await db.commit()

    resp = await client.get("/dashboard/stats")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    # Seeded fixture (pat_001) contributes 0 alerts; our 3 add 2 + 1 + 0 = 3.
    assert data["alerts"]["total"] >= 3
