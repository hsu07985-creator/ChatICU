"""Tests for GET/POST /pharmacy/advice-records endpoints."""

import pytest


@pytest.mark.asyncio
async def test_list_advice_records_empty(client):
    """GET /pharmacy/advice-records returns empty list when no records exist."""
    response = await client.get("/pharmacy/advice-records")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["records"] == []
    assert data["data"]["total"] == 0


@pytest.mark.asyncio
async def test_create_advice_record(client):
    """POST /pharmacy/advice-records creates a new advice record."""
    payload = {
        "patientId": "pat_001",
        "adviceCode": "1-4",
        "adviceLabel": "用藥劑量/頻次問題",
        "category": "1. 建議處方",
        "content": "建議 Vancomycin 劑量調整為 1g Q24H",
        "linkedMedications": ["Vancomycin"],
    }
    response = await client.post("/pharmacy/advice-records", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    record = data["data"]
    assert record["patientId"] == "pat_001"
    assert record["patientName"] == "許先生"
    assert record["bedNumber"] == "I-1"
    assert record["adviceCode"] == "1-4"
    assert record["adviceLabel"] == "用藥劑量/頻次問題"
    assert record["category"] == "1. 建議處方"
    assert record["content"] == "建議 Vancomycin 劑量調整為 1g Q24H"
    assert record["linkedMedications"] == ["Vancomycin"]
    assert record["pharmacistName"] == "Test Doctor"
    assert record["id"].startswith("adv_")
    assert record["timestamp"] is not None


@pytest.mark.asyncio
async def test_create_advice_record_autoposts_message(client):
    """Saving an advice record should auto-post a medication-advice message to the patient board."""
    marker = "E2E_AUTOSYNC_MARKER"
    payload = {
        "patientId": "pat_001",
        "adviceCode": "1-9",
        "adviceLabel": "藥品交互作用",
        "category": "1. 建議處方",
        "content": f"建議檢視 Propofol + Fentanyl 交互作用\n\n{marker}",
        "linkedMedications": ["Propofol", "Fentanyl"],
    }
    resp = await client.post("/pharmacy/advice-records", json=payload)
    assert resp.status_code == 200

    msg_list = await client.get("/patients/pat_001/messages")
    assert msg_list.status_code == 200
    messages = msg_list.json()["data"]["messages"]
    assert any(marker in (m.get("content") or "") for m in messages)


@pytest.mark.asyncio
async def test_create_then_list_advice_records(client):
    """Create a record then verify it appears in the list."""
    # Create
    payload = {
        "patientId": "pat_001",
        "adviceCode": "2-3",
        "adviceLabel": "建議用藥/建議增加用藥",
        "category": "2. 主動建議",
        "content": "建議增加 Pantoprazole 40mg IV Q12H 預防消化道出血",
    }
    create_resp = await client.post("/pharmacy/advice-records", json=payload)
    assert create_resp.status_code == 200
    created_id = create_resp.json()["data"]["id"]

    # List
    list_resp = await client.get("/pharmacy/advice-records")
    assert list_resp.status_code == 200
    records = list_resp.json()["data"]["records"]
    assert len(records) >= 1
    ids = [r["id"] for r in records]
    assert created_id in ids


@pytest.mark.asyncio
async def test_list_advice_records_filter_category(client):
    """Filtering by category returns only matching records."""
    # Create two records in different categories
    await client.post("/pharmacy/advice-records", json={
        "patientId": "pat_001",
        "adviceCode": "1-1",
        "adviceLabel": "建議更適當用藥",
        "category": "1. 建議處方",
        "content": "Test content A",
    })
    await client.post("/pharmacy/advice-records", json={
        "patientId": "pat_001",
        "adviceCode": "3-1",
        "adviceLabel": "建議藥品濃度監測",
        "category": "3. 建議監測",
        "content": "Test content B",
    })

    # Filter by category
    resp = await client.get("/pharmacy/advice-records", params={"category": "3. 建議監測"})
    assert resp.status_code == 200
    records = resp.json()["data"]["records"]
    assert all(r["category"] == "3. 建議監測" for r in records)


@pytest.mark.asyncio
async def test_create_advice_record_invalid_patient(client):
    """Creating a record with non-existent patient returns 404."""
    payload = {
        "patientId": "NONEXIST",
        "adviceCode": "1-4",
        "adviceLabel": "用藥劑量/頻次問題",
        "category": "1. 建議處方",
        "content": "Some content",
    }
    response = await client.post("/pharmacy/advice-records", json=payload)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_advice_record_invalid_category(client):
    """Creating a record with invalid category returns 422."""
    payload = {
        "patientId": "pat_001",
        "adviceCode": "1-4",
        "adviceLabel": "Test",
        "category": "無效類別",
        "content": "Some content",
    }
    response = await client.post("/pharmacy/advice-records", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_advice_record_invalid_code_format(client):
    """Creating a record with invalid advice code returns 422."""
    payload = {
        "patientId": "pat_001",
        "adviceCode": "invalid",
        "adviceLabel": "Test",
        "category": "1. 建議處方",
        "content": "Some content",
    }
    response = await client.post("/pharmacy/advice-records", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_advice_record_response_contract(client):
    """Verify response follows the standard envelope contract."""
    response = await client.get("/pharmacy/advice-records")
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert data["success"] is True
    assert "data" in data
    assert "records" in data["data"]
    assert "total" in data["data"]
    assert isinstance(data["data"]["records"], list)
    assert isinstance(data["data"]["total"], int)


# ── F19: Invalid month filter must return 422, not silently ignored ──────


@pytest.mark.asyncio
async def test_advice_records_invalid_month_returns_422(client):
    """GET /pharmacy/advice-records?month=BAD returns 422."""
    response = await client.get("/pharmacy/advice-records", params={"month": "invalid"})
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False


@pytest.mark.asyncio
async def test_advice_records_invalid_month_13_returns_422(client):
    """GET /pharmacy/advice-records?month=2026-13 returns 422 (month out of range)."""
    response = await client.get("/pharmacy/advice-records", params={"month": "2026-13"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_advice_records_valid_month_ok(client):
    """GET /pharmacy/advice-records?month=2026-01 returns 200."""
    response = await client.get("/pharmacy/advice-records", params={"month": "2026-01"})
    assert response.status_code == 200
    assert response.json()["success"] is True


@pytest.mark.asyncio
async def test_advice_stats_invalid_month_returns_422(client):
    """GET /pharmacy/advice-records/stats?month=BAD returns 422."""
    response = await client.get("/pharmacy/advice-records/stats", params={"month": "not-a-date"})
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
