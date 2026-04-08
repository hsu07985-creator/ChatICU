"""Tests for PATCH /pharmacy/advice-records/{id}/response endpoint."""

import pytest


async def _create_advice(client, patient_id="pat_001"):
    """Helper: create an advice record and return its ID."""
    payload = {
        "patientId": patient_id,
        "adviceCode": "1-D",
        "adviceLabel": "藥品併用問題",
        "category": "1. 建議處方",
        "content": "建議調整 Vancomycin 劑量",
    }
    resp = await client.post("/pharmacy/advice-records", json=payload)
    assert resp.status_code == 200
    return resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_respond_accept_advice(client):
    """Doctor accepts advice -> accepted=True, respondedByName set, auto-reply exists."""
    advice_id = await _create_advice(client)

    resp = await client.patch(
        f"/pharmacy/advice-records/{advice_id}/response",
        json={"accepted": True},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["accepted"] is True
    assert data["respondedByName"] is not None

    # Verify auto-reply exists in patient messages
    msg_resp = await client.get("/patients/pat_001/messages")
    assert msg_resp.status_code == 200
    messages = msg_resp.json()["data"]["messages"]
    replies_found = False
    for m in messages:
        for r in m.get("replies", []):
            if "已接受" in r.get("content", ""):
                replies_found = True
                break
    assert replies_found, "Auto-reply with '已接受' not found"


@pytest.mark.asyncio
async def test_respond_reject_advice(client):
    """Doctor rejects advice -> accepted=False."""
    advice_id = await _create_advice(client)

    resp = await client.patch(
        f"/pharmacy/advice-records/{advice_id}/response",
        json={"accepted": False},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["accepted"] is False


@pytest.mark.asyncio
async def test_respond_with_note(client):
    """Accept with a note -> auto-reply contains the note text."""
    advice_id = await _create_advice(client)

    resp = await client.patch(
        f"/pharmacy/advice-records/{advice_id}/response",
        json={"accepted": True, "note": "同意調整劑量"},
    )
    assert resp.status_code == 200

    msg_resp = await client.get("/patients/pat_001/messages")
    messages = msg_resp.json()["data"]["messages"]
    note_found = False
    for m in messages:
        for r in m.get("replies", []):
            if "同意調整劑量" in r.get("content", ""):
                note_found = True
    assert note_found, "Note text not found in auto-reply"


@pytest.mark.asyncio
async def test_respond_duplicate_returns_409(client):
    """Responding twice to the same advice returns 409."""
    advice_id = await _create_advice(client)

    resp1 = await client.patch(
        f"/pharmacy/advice-records/{advice_id}/response",
        json={"accepted": True},
    )
    assert resp1.status_code == 200

    resp2 = await client.patch(
        f"/pharmacy/advice-records/{advice_id}/response",
        json={"accepted": False},
    )
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_respond_nonexistent_returns_404(client):
    """Responding to non-existent advice returns 404."""
    resp = await client.patch(
        "/pharmacy/advice-records/adv_nonexist/response",
        json={"accepted": True},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_advice_record_id_linked_on_create(client):
    """Creating advice links the auto-posted PatientMessage via adviceRecordId."""
    advice_id = await _create_advice(client)

    msg_resp = await client.get("/patients/pat_001/messages")
    messages = msg_resp.json()["data"]["messages"]
    linked = [m for m in messages if m.get("adviceRecordId") == advice_id]
    assert len(linked) >= 1, f"No message linked to advice {advice_id}"


@pytest.mark.asyncio
async def test_list_pending_advice(client):
    """Filter accepted=pending returns only unresponded advice records."""
    id1 = await _create_advice(client)
    id2 = await _create_advice(client)

    # Accept the first one
    await client.patch(
        f"/pharmacy/advice-records/{id1}/response",
        json={"accepted": True},
    )

    # List pending
    resp = await client.get("/pharmacy/advice-records", params={"accepted": "pending"})
    assert resp.status_code == 200
    records = resp.json()["data"]["records"]
    record_ids = [r["id"] for r in records]
    assert id2 in record_ids
    assert id1 not in record_ids


@pytest.mark.asyncio
async def test_messages_include_advice_accepted(client):
    """After responding, GET messages includes adviceAccepted field."""
    advice_id = await _create_advice(client)

    await client.patch(
        f"/pharmacy/advice-records/{advice_id}/response",
        json={"accepted": True},
    )

    msg_resp = await client.get("/patients/pat_001/messages")
    messages = msg_resp.json()["data"]["messages"]
    linked = [m for m in messages if m.get("adviceRecordId") == advice_id]
    assert len(linked) >= 1
    assert linked[0]["adviceAccepted"] is True
