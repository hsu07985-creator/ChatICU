"""Test RAG API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_rag_status(client):
    response = await client.get("/api/v1/rag/status")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "is_indexed" in data["data"]


@pytest.mark.asyncio
async def test_rag_query_not_indexed(client):
    response = await client.post(
        "/api/v1/rag/query",
        json={"question": "What is PADIS?"},
    )
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_rag_index_with_empty_dir(client, tmp_path):
    response = await client.post(
        "/api/v1/rag/index",
        json={"docs_path": str(tmp_path)},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["total_chunks"] == 0


@pytest.mark.asyncio
async def test_rag_index_and_query(client, tmp_path):
    # Create test documents
    cat_dir = tmp_path / "test_category"
    cat_dir.mkdir()
    (cat_dir / "doc1.txt").write_text("Sedation management in ICU patients requires careful monitoring.")
    (cat_dir / "doc2.txt").write_text("PADIS guidelines recommend daily sedation interruption.")

    # Index
    response = await client.post("/api/v1/rag/index", json={"docs_path": str(tmp_path)})
    assert response.status_code == 200
    assert response.json()["data"]["total_chunks"] >= 2

    # Query
    response = await client.post("/api/v1/rag/query", json={"question": "sedation management"})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "sources" in data["data"]
