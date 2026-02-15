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
    assert record["patientName"] == "張三"
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
