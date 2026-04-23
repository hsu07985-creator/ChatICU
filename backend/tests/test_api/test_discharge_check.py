"""Tests for GET /patients/{patient_id}/discharge-check (Wave 6a).

Covers the four scenarios called out in the task spec:
  1. Discharged patient with IV PPI (SUP) inpatient + no PPI on discharge
     → missedDiscontinuations entry with category='sup_ppi', severity='high'.
  2. Patient still inpatient (discharge_date is None) → 200 + empty arrays.
  3. Discharge order set has its own duplicate (two PPIs) → dischargeDuplicates
     non-empty (carried through DuplicateDetector).
  4. PRN-only inpatient med absent from discharge → listed with severity='low'.

Auth is handled by the shared ``client`` fixture (conftest.py) which overrides
``get_current_user`` so we don't need a real login round-trip.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.models.medication import Medication
from app.models.patient import Patient


async def _insert_patient(session, *, pid="pat_dc1", discharged=True, dd=date(2026, 4, 20)):
    p = Patient(
        id=pid,
        name="Test Discharge Patient",
        bed_number=f"D-{pid[-1]}",
        medical_record_number=f"MR-{pid}",
        age=70,
        gender="男",
        diagnosis="pneumonia",
        intubated=False,
        ventilator_days=0,
        discharge_date=dd if discharged else None,
        discharge_type="一般出院" if discharged else None,
    )
    session.add(p)
    await session.commit()
    return p


def _med(
    *,
    id: str,
    patient_id: str,
    name: str,
    generic_name: str,
    atc_code: str,
    source_type: str = "inpatient",
    route: str = "IV",
    indication: str = "",
    prn: bool = False,
    is_antibiotic: bool = False,
    start_date=None,
    end_date=None,
    status: str = "active",
    days_supply=None,
):
    return Medication(
        id=id,
        patient_id=patient_id,
        name=name,
        generic_name=generic_name,
        atc_code=atc_code,
        source_type=source_type,
        route=route,
        indication=indication,
        prn=prn,
        is_antibiotic=is_antibiotic,
        start_date=start_date,
        end_date=end_date,
        status=status,
        days_supply=days_supply,
    )


# ─────────────────────────────────────────────────────────────────────
# 1. Discharged patient: IV PPI (SUP) inpatient, no PPI on discharge.
#    → missedDiscontinuations contains a sup_ppi / high entry.
# ─────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_sup_ppi_missed_discontinuation(client, seeded_db):
    session = seeded_db
    p = await _insert_patient(session, pid="pat_dc1", dd=date(2026, 4, 20))

    session.add_all(
        [
            # Inpatient IV Pantoprazole for SUP — started during admission,
            # no end_date so it is active through discharge.
            _med(
                id="med_sup_1",
                patient_id=p.id,
                name="Pantoprazole",
                generic_name="Pantoprazole",
                atc_code="A02BC02",
                source_type="inpatient",
                route="IV",
                indication="SUP (stress ulcer prophylaxis)",
                start_date=date(2026, 4, 10),
            ),
            # Unrelated outpatient / discharge med (not a PPI).
            _med(
                id="med_dc_abx",
                patient_id=p.id,
                name="Amoxicillin",
                generic_name="Amoxicillin",
                atc_code="J01CA04",
                source_type="outpatient",
                route="PO",
                days_supply=7,
            ),
        ]
    )
    await session.commit()

    resp = await client.get(f"/patients/{p.id}/discharge-check")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]

    assert data["dischargeDate"] == "2026-04-20"
    assert data["dischargeType"] == "一般出院"
    assert data["counts"]["missedDiscontinuations"] >= 1

    sup_hits = [
        m for m in data["missedDiscontinuations"] if m["category"] == "sup_ppi"
    ]
    assert len(sup_hits) == 1
    hit = sup_hits[0]
    assert hit["severity"] == "high"
    assert hit["medicationId"] == "med_sup_1"
    assert "SUP" in hit["reason"] or "PPI" in hit["reason"]


# ─────────────────────────────────────────────────────────────────────
# 2. Patient still inpatient (no discharge_date) → empty envelope.
# ─────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_still_inpatient_returns_empty(client, seeded_db):
    session = seeded_db
    p = await _insert_patient(session, pid="pat_dc2", discharged=False)

    # Add one inpatient med to be sure we don't accidentally include it.
    session.add(
        _med(
            id="med_still_1",
            patient_id=p.id,
            name="Pantoprazole",
            generic_name="Pantoprazole",
            atc_code="A02BC02",
            source_type="inpatient",
            route="IV",
            indication="SUP",
            start_date=date(2026, 4, 10),
        )
    )
    await session.commit()

    resp = await client.get(f"/patients/{p.id}/discharge-check")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]

    assert data["dischargeDate"] is None
    assert data["inpatientActiveAtDischarge"] == []
    assert data["dischargeMedications"] == []
    assert data["missedDiscontinuations"] == []
    assert data["dischargeDuplicates"] == []
    assert data["counts"]["missedDiscontinuations"] == 0
    assert data["counts"]["dischargeDuplicates"] == {
        "critical": 0,
        "high": 0,
        "moderate": 0,
        "low": 0,
        "info": 0,
    }


# ─────────────────────────────────────────────────────────────────────
# 3. Discharge set has its own duplicate (two PPIs) → dischargeDuplicates
#    non-empty. Proves DuplicateDetector is wired correctly in context="discharge".
# ─────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_discharge_set_has_internal_duplicate(client, seeded_db):
    session = seeded_db
    p = await _insert_patient(session, pid="pat_dc3", dd=date(2026, 4, 22))

    session.add_all(
        [
            # Two PPIs on the discharge set — classic PPI × PPI (L2 same-L4).
            _med(
                id="med_dis_ppi_a",
                patient_id=p.id,
                name="Omeprazole",
                generic_name="Omeprazole",
                atc_code="A02BC01",
                source_type="outpatient",
                route="PO",
                days_supply=14,
            ),
            _med(
                id="med_dis_ppi_b",
                patient_id=p.id,
                name="Esomeprazole",
                generic_name="Esomeprazole",
                atc_code="A02BC05",
                source_type="outpatient",
                route="PO",
                days_supply=14,
            ),
        ]
    )
    await session.commit()

    resp = await client.get(f"/patients/{p.id}/discharge-check")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]

    # DuplicateDetector must surface at least one alert for the PPI pair.
    assert len(data["dischargeDuplicates"]) >= 1
    alert_ids = {
        mem["medicationId"]
        for alert in data["dischargeDuplicates"]
        for mem in alert["members"]
    }
    assert {"med_dis_ppi_a", "med_dis_ppi_b"}.issubset(alert_ids)

    # Totals wire into counts (sum > 0 across any severity bucket).
    total = sum(data["counts"]["dischargeDuplicates"].values())
    assert total >= 1


# ─────────────────────────────────────────────────────────────────────
# 4. PRN inpatient med not on discharge → severity='low', category='prn_only'.
# ─────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_prn_inpatient_flagged_low(client, seeded_db):
    session = seeded_db
    p = await _insert_patient(session, pid="pat_dc4", dd=date(2026, 4, 21))

    session.add_all(
        [
            # PRN Morphine, inpatient, active through discharge. NOTE: Morphine
            # is NOT classified as is_antibiotic and has no SUP indication, so
            # it should land squarely in the prn_only bucket.
            _med(
                id="med_prn_morph",
                patient_id=p.id,
                name="Morphine",
                generic_name="Morphine",
                atc_code="N02AA01",
                source_type="inpatient",
                route="IV",
                indication="pain PRN",
                prn=True,
                start_date=date(2026, 4, 12),
            ),
            # Arbitrary unrelated discharge med so the set isn't empty.
            _med(
                id="med_dis_acet",
                patient_id=p.id,
                name="Acetaminophen",
                generic_name="Acetaminophen",
                atc_code="N02BE01",
                source_type="outpatient",
                route="PO",
                days_supply=7,
            ),
        ]
    )
    await session.commit()

    resp = await client.get(f"/patients/{p.id}/discharge-check")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]

    prn_hits = [
        m for m in data["missedDiscontinuations"] if m["category"] == "prn_only"
    ]
    assert len(prn_hits) == 1
    assert prn_hits[0]["severity"] == "low"
    assert prn_hits[0]["medicationId"] == "med_prn_morph"
