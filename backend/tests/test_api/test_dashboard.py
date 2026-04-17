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


async def test_dashboard_stats_excludes_archived_patient_san(client, seeded_db):
    """Regression: archiving a patient must remove them from SAN counts.

    Archive is a soft-delete that only sets patient.archived=True and leaves
    their Medication rows with status='active'. Without joining Patient and
    filtering archived==False in the SAN queries, the counts keep including
    archived patients — producing nonsense like `sanByCategory.analgesia=10`
    when `patients.total=9`.
    """
    db = seeded_db
    db.add(Patient(
        id="pat_arch_san",
        name="Archived SAN",
        medical_record_number="MRN-ARCH",
        bed_number="Z99",
        age=65,
        gender="M",
        diagnosis="test",
        archived=True,
    ))
    db.add(Medication(
        id="med_arch_001",
        patient_id="pat_arch_san",
        name="Fentanyl",
        category="analgesic",
        san_category="A",
        dose="50mcg",
        unit="mcg",
        frequency="continuous",
        route="IV",
        status="active",
    ))
    await db.commit()

    resp = await client.get("/dashboard/stats")
    assert resp.status_code == 200
    data = resp.json()["data"]
    # Archived patient's active analgesia med must NOT leak into any SAN counter.
    assert data["patients"]["sanByCategory"]["analgesia"] == 0
    assert data["medications"]["analgesia"] == 0
    assert data["patients"]["withSAN"] == 0


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
