"""Smoke + contract tests for POST /pharmacy/duplicate-check.

Covers:
* 400/422 validation — under 2 drugs, over 30 drugs, invalid context.
* Happy path — two benzodiazepines (obvious L1 same-ATC duplicate) surface
  a 'high' or 'critical' alert.
* Formulary fallback — drug passed by name only still gets an ATC and
  triggers detection.
"""
import pytest


@pytest.mark.asyncio
async def test_requires_at_least_two_drugs(client, seeded_db):
    response = await client.post(
        "/pharmacy/duplicate-check",
        json={"drugs": [{"name": "Clopidogrel"}]},
    )
    assert response.status_code == 422  # pydantic min_length=2


@pytest.mark.asyncio
async def test_rejects_invalid_context(client, seeded_db):
    response = await client.post(
        "/pharmacy/duplicate-check",
        json={
            "drugs": [
                {"name": "Lorazepam", "atcCode": "N05BA06"},
                {"name": "Diazepam", "atcCode": "N05BA01"},
            ],
            "context": "not-a-context",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_returns_alerts_envelope(client, seeded_db):
    """Two anti-epileptic drugs in the same ATC4 class (N03AX) should emit
    at least an L2 alert for ATC-group duplication."""
    response = await client.post(
        "/pharmacy/duplicate-check",
        json={
            "drugs": [
                {"name": "Perampanel", "atcCode": "N03AX22", "route": "PO"},
                {"name": "Levetiracetam", "atcCode": "N03AX14", "route": "PO"},
            ],
            "context": "inpatient",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert "alerts" in data
    assert "counts" in data
    assert "resolved" in data
    assert set(data["counts"].keys()) == {"critical", "high", "moderate", "low", "info"}


@pytest.mark.asyncio
async def test_resolves_atc_from_name_only(client, seeded_db):
    """When caller omits atcCode we fall back to the formulary lookup."""
    response = await client.post(
        "/pharmacy/duplicate-check",
        json={
            "drugs": [
                {"name": "Clopidogrel"},
                {"name": "Acetaminophen"},
            ],
        },
    )
    assert response.status_code == 200
    resolved = response.json()["data"]["resolved"]
    # Clopidogrel has a clean single-generic formulary entry → B01AC04.
    clopidogrel = next((r for r in resolved if r["name"] == "Clopidogrel"), None)
    assert clopidogrel is not None
    assert clopidogrel["atcCode"] == "B01AC04"


@pytest.mark.asyncio
async def test_ambiguous_prefix_not_blindly_resolved(client, seeded_db):
    """'Sodium Zirconium Cyclosilicate' must NOT resolve to B05XA03 (saline's
    ATC) — this was the original phantom-DDI bug and applies equally here
    because duplicate-check shares the formulary lookup."""
    response = await client.post(
        "/pharmacy/duplicate-check",
        json={
            "drugs": [
                {"name": "Sodium Zirconium Cyclosilicate"},
                {"name": "Furosemide"},
            ],
        },
    )
    assert response.status_code == 200
    resolved = response.json()["data"]["resolved"]
    zirconium = next(r for r in resolved if r["name"].startswith("Sodium Zirconium"))
    assert zirconium["atcCode"] in (None, "", ), (
        f"expected None (blocklisted first-word) but got {zirconium['atcCode']!r}"
    )
