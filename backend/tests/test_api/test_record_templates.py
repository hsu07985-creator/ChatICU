"""Tests for /record-templates CRUD endpoints."""

import pytest


@pytest.mark.asyncio
async def test_list_templates_empty(client):
    resp = await client.get("/record-templates", params={"recordType": "progress-note"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["templates"] == []


@pytest.mark.asyncio
async def test_create_template(client):
    resp = await client.post("/record-templates", json={
        "name": "ICU Progress Note",
        "description": "Standard ICU daily template",
        "record_type": "progress-note",
        "role_scope": "doctor",
        "content": "## Assessment\n\n## Plan\n",
        "is_system": False,
        "sort_order": 1,
    })
    assert resp.status_code == 200
    body = resp.json()
    data = body["data"]
    assert data["id"].startswith("rtpl_")
    assert data["name"] == "ICU Progress Note"
    assert data["recordType"] == "progress-note"
    assert data["roleScope"] == "doctor"
    assert data["isActive"] is True
    assert data["canEdit"] is True
    assert data["canDelete"] is True
    return data["id"]


@pytest.mark.asyncio
async def test_create_and_list(client):
    # Create
    create_resp = await client.post("/record-templates", json={
        "name": "Nurse Handoff",
        "record_type": "nursing-record",
        "role_scope": "nurse",
        "content": "## Handoff Notes\n",
        "is_system": False,
        "sort_order": 0,
    })
    assert create_resp.status_code == 200

    # List
    list_resp = await client.get("/record-templates", params={"recordType": "nursing-record"})
    assert list_resp.status_code == 200
    templates = list_resp.json()["data"]["templates"]
    assert len(templates) >= 1
    assert any(t["name"] == "Nurse Handoff" for t in templates)


@pytest.mark.asyncio
async def test_update_template(client):
    # Create first
    create_resp = await client.post("/record-templates", json={
        "name": "Draft Template",
        "record_type": "progress-note",
        "role_scope": "admin",
        "content": "draft content",
        "is_system": False,
        "sort_order": 0,
    })
    tpl_id = create_resp.json()["data"]["id"]

    # Update
    patch_resp = await client.patch(f"/record-templates/{tpl_id}", json={
        "name": "Updated Template",
        "content": "updated content",
    })
    assert patch_resp.status_code == 200
    data = patch_resp.json()["data"]
    assert data["name"] == "Updated Template"
    assert data["content"] == "updated content"


@pytest.mark.asyncio
async def test_update_nonexistent(client):
    resp = await client.patch("/record-templates/nonexistent", json={"name": "X"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_template(client):
    # Create
    create_resp = await client.post("/record-templates", json={
        "name": "To Delete",
        "record_type": "progress-note",
        "role_scope": "admin",
        "content": "will be deleted",
        "is_system": False,
        "sort_order": 0,
    })
    tpl_id = create_resp.json()["data"]["id"]

    # Delete
    del_resp = await client.delete(f"/record-templates/{tpl_id}")
    assert del_resp.status_code == 200

    # Verify gone
    list_resp = await client.get("/record-templates", params={"recordType": "progress-note"})
    templates = list_resp.json()["data"]["templates"]
    assert not any(t["id"] == tpl_id for t in templates)


@pytest.mark.asyncio
async def test_delete_nonexistent(client):
    resp = await client.delete("/record-templates/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_system_template_visibility(client):
    """System templates with matching role_scope should be visible."""
    # Admin creates a system template for all roles
    resp = await client.post("/record-templates", json={
        "name": "System Template",
        "record_type": "progress-note",
        "role_scope": "all",
        "content": "system content",
        "is_system": True,
        "sort_order": 0,
    })
    assert resp.status_code == 200
    assert resp.json()["data"]["isSystem"] is True

    # Should appear in list (admin sees all)
    list_resp = await client.get("/record-templates", params={"recordType": "progress-note"})
    templates = list_resp.json()["data"]["templates"]
    assert any(t["name"] == "System Template" for t in templates)
