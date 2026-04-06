"""Tests for shared custom tags CRUD endpoints."""
import pytest

pytestmark = pytest.mark.anyio


async def test_list_custom_tags_empty(client):
    resp = await client.get("/patients/pat_001/messages/custom-tags")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"] == []


async def test_create_custom_tag(client):
    resp = await client.post(
        "/patients/pat_001/messages/custom-tags",
        json={"name": "營養評估"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    tag = body["data"]
    assert tag["name"] == "營養評估"
    assert tag["id"].startswith("ctag_")
    assert tag["createdById"] is not None
    assert tag["createdByName"] is not None


async def test_preset_tags_includes_custom(client):
    # Create a custom tag first
    await client.post(
        "/patients/pat_001/messages/custom-tags",
        json={"name": "自訂標籤A"},
    )
    resp = await client.get("/patients/pat_001/messages/preset-tags")
    assert resp.status_code == 200
    tags = resp.json()["data"]
    assert "自訂標籤A" in tags
    # System presets should still be there
    assert "重要" in tags
    assert "追蹤" in tags


async def test_create_duplicate_custom_tag(client):
    await client.post(
        "/patients/pat_001/messages/custom-tags",
        json={"name": "重複測試"},
    )
    resp = await client.post(
        "/patients/pat_001/messages/custom-tags",
        json={"name": "重複測試"},
    )
    assert resp.status_code == 409


async def test_create_preset_tag_conflict(client):
    resp = await client.post(
        "/patients/pat_001/messages/custom-tags",
        json={"name": "重要"},
    )
    assert resp.status_code == 409


async def test_delete_custom_tag(client):
    # Create then delete
    create_resp = await client.post(
        "/patients/pat_001/messages/custom-tags",
        json={"name": "待刪除"},
    )
    tag_id = create_resp.json()["data"]["id"]

    del_resp = await client.delete(
        f"/patients/pat_001/messages/custom-tags/{tag_id}"
    )
    assert del_resp.status_code == 200
    assert "已刪除" in del_resp.json()["message"]

    # Verify it's gone from preset-tags
    preset_resp = await client.get("/patients/pat_001/messages/preset-tags")
    assert "待刪除" not in preset_resp.json()["data"]


async def test_delete_nonexistent_tag(client):
    resp = await client.delete(
        "/patients/pat_001/messages/custom-tags/ctag_nonexist"
    )
    assert resp.status_code == 404


async def test_list_custom_tags_with_data(client):
    await client.post(
        "/patients/pat_001/messages/custom-tags",
        json={"name": "列表測試"},
    )
    resp = await client.get("/patients/pat_001/messages/custom-tags")
    assert resp.status_code == 200
    tags = resp.json()["data"]
    names = [t["name"] for t in tags]
    assert "列表測試" in names
