"""Contract tests for GET /patients/{id}/bootstrap (Phase 3.1).

The bootstrap endpoint is a pure aggregator: each sub-payload MUST match the
shape returned by the corresponding individual endpoint. These tests assert
both the wrapper schema AND that values agree with the per-endpoint route, so
drift between bootstrap and the source endpoints is caught by CI.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio

from app.models.lab_data import LabData
from app.models.medication import Medication
from app.models.ventilator import VentilatorSetting
from app.models.vital_sign import VitalSign


@pytest_asyncio.fixture
async def bootstrap_seed(seeded_db):
    """Seed pat_001 with one record in each first-screen category."""
    db = seeded_db
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            LabData(
                id="lab_boot_001",
                patient_id="pat_001",
                timestamp=now,
                biochemistry={"BUN": 15.0, "Cr": 1.2},
                hematology={"WBC": 8.5, "Hb": 12.0},
            ),
            Medication(
                id="med_boot_001",
                patient_id="pat_001",
                name="Propofol",
                generic_name="Propofol",
                category="sedative",
                san_category="S",
                dose="50",
                unit="mg/hr",
                frequency="continuous",
                route="IV",
                prn=False,
                start_date=date(2026, 2, 17),
                status="active",
            ),
            VitalSign(
                id="vs_boot_001",
                patient_id="pat_001",
                timestamp=now,
                heart_rate=88,
                systolic_bp=120,
                diastolic_bp=80,
                spo2=97,
                temperature=37.0,
            ),
            VentilatorSetting(
                id="vent_boot_001",
                patient_id="pat_001",
                timestamp=now,
                mode="SIMV",
                fio2=40,
                peep=5,
                tidal_volume=450,
                respiratory_rate=14,
            ),
        ]
    )
    await db.commit()
    return db


@pytest.mark.asyncio
async def test_bootstrap_returns_all_five_subpayloads(client, bootstrap_seed):
    """Happy path: bootstrap returns the 5 keys with the expected shapes."""
    resp = await client.get("/patients/pat_001/bootstrap")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True

    data = body["data"]
    assert set(data.keys()) == {
        "patient",
        "latestLab",
        "medications",
        "latestVitals",
        "latestVentilator",
    }

    # patient — same shape as GET /patients/{id}
    assert data["patient"]["id"] == "pat_001"
    assert data["patient"]["bedNumber"] == "I-1"
    assert "ventilatorDays" in data["patient"]

    # latestLab — same shape as GET /lab-data/latest
    assert data["latestLab"]["patientId"] == "pat_001"
    assert data["latestLab"]["biochemistry"]["Cr"] == 1.2
    for cat in ("hematology", "bloodGas", "venousBloodGas", "inflammatory"):
        assert cat in data["latestLab"]

    # medications — same shape as GET /medications
    meds = data["medications"]
    assert set(meds.keys()) == {"medications", "grouped", "interactions"}
    assert len(meds["medications"]) == 1
    assert meds["medications"][0]["name"] == "Propofol"
    assert "sedation" in meds["grouped"]
    assert len(meds["grouped"]["sedation"]) == 1
    assert isinstance(meds["interactions"], list)

    # latestVitals — same shape as GET /vital-signs/latest
    vs = data["latestVitals"]
    assert vs["patientId"] == "pat_001"
    assert vs["heartRate"] == 88
    assert vs["bloodPressure"]["systolic"] == 120
    assert "referenceRanges" in vs

    # latestVentilator — same shape as GET /ventilator/latest
    vent = data["latestVentilator"]
    assert vent["patientId"] == "pat_001"
    assert vent["mode"] == "SIMV"
    assert vent["fio2"] == 40
    assert vent["tidalVolume"] == 450


@pytest.mark.asyncio
async def test_bootstrap_returns_404_for_missing_patient(client, seeded_db):
    """Missing patient surfaces 404 (matches GET /patients/{id} behavior)."""
    resp = await client.get("/patients/pat_999/bootstrap")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_bootstrap_handles_missing_optional_data(client, seeded_db):
    """Patient with no lab/vital/vent/meds: nullables stay null, meds stay
    a dict with empty arrays — frontend can render skeleton without checking
    for missing keys."""
    resp = await client.get("/patients/pat_001/bootstrap")
    assert resp.status_code == 200
    data = resp.json()["data"]

    assert data["patient"]["id"] == "pat_001"
    assert data["latestLab"] is None
    assert data["latestVitals"] is None
    assert data["latestVentilator"] is None

    # medications must remain a structured dict even when empty so frontend
    # destructuring stays safe (avoids `data.medications.medications` undefined)
    meds = data["medications"]
    assert meds["medications"] == []
    assert meds["interactions"] == []
    assert set(meds["grouped"].keys()) == {
        "sedation", "analgesia", "nmb", "other", "outpatient",
    }
    for arr in meds["grouped"].values():
        assert arr == []


@pytest.mark.asyncio
async def test_bootstrap_matches_individual_endpoints(client, bootstrap_seed):
    """Anti-drift: each sub-payload MUST equal the response of the route it
    aggregates. If a future change to /lab-data/latest or /medications etc.
    isn't reflected in bootstrap, this test fails."""
    boot = (await client.get("/patients/pat_001/bootstrap")).json()["data"]

    patient_resp = await client.get("/patients/pat_001")
    assert boot["patient"] == patient_resp.json()["data"]

    lab_resp = await client.get("/patients/pat_001/lab-data/latest")
    assert boot["latestLab"] == lab_resp.json()["data"]

    meds_resp = await client.get("/patients/pat_001/medications?status=all")
    assert boot["medications"] == meds_resp.json()["data"]

    vs_resp = await client.get("/patients/pat_001/vital-signs/latest")
    assert boot["latestVitals"] == vs_resp.json()["data"]

    vent_resp = await client.get("/patients/pat_001/ventilator/latest")
    assert boot["latestVentilator"] == vent_resp.json()["data"]
