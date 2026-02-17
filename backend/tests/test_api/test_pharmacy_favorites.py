"""Tests for IV compatibility favorites endpoints."""

import pytest


@pytest.mark.asyncio
async def test_compatibility_favorites_crud(client):
    # Empty
    resp = await client.get("/pharmacy/compatibility-favorites")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["favorites"] == []
    assert data["total"] == 0

    # Create
    payload = {"drugA": "Propofol", "drugB": "Fentanyl", "solution": "NS"}
    create_resp = await client.post("/pharmacy/compatibility-favorites", json=payload)
    assert create_resp.status_code == 200
    fav = create_resp.json()["data"]
    assert fav["id"].startswith("fav_")
    assert fav["drugA"]
    assert fav["drugB"]
    assert fav["solution"] == "NS"

    # Create again (idempotent)
    create2 = await client.post("/pharmacy/compatibility-favorites", json=payload)
    assert create2.status_code == 200
    fav2 = create2.json()["data"]
    assert fav2["id"] == fav["id"]

    # List includes it
    list_resp = await client.get("/pharmacy/compatibility-favorites")
    assert list_resp.status_code == 200
    items = list_resp.json()["data"]["favorites"]
    assert len(items) == 1
    assert items[0]["id"] == fav["id"]

    # Delete
    del_resp = await client.delete(f"/pharmacy/compatibility-favorites/{fav['id']}")
    assert del_resp.status_code == 200

    # Empty again
    resp2 = await client.get("/pharmacy/compatibility-favorites")
    assert resp2.status_code == 200
    data2 = resp2.json()["data"]
    assert data2["favorites"] == []
    assert data2["total"] == 0

