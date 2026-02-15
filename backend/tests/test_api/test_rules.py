"""Test rules API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_ckd_staging(client):
    response = await client.post(
        "/api/v1/rules/ckd-stage",
        json={"egfr": 45.0},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["stage"] == "G3a"


@pytest.mark.asyncio
async def test_ckd_staging_with_proteinuria(client):
    response = await client.post(
        "/api/v1/rules/ckd-stage",
        json={"egfr": 50.0, "has_proteinuria": True},
    )
    assert response.status_code == 200
    data = response.json()
    assert "Proteinuria" in data["data"]["recommendations"][0]
