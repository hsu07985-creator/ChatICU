"""Tests for admin vectors upload API (AO-08)."""

from unittest.mock import patch

import pytest

from app.config import settings


@pytest.mark.asyncio
async def test_admin_vectors_upload_success(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "RAG_DOCS_PATH", str(tmp_path))

    file_bytes = b"%PDF-1.4\nAO-08 upload test\n"
    with patch(
        "app.services.llm_services.rag_service.rag_service.load_and_chunk",
        return_value=[
            {
                "doc_id": "clinical_guidelines/sedation-guideline.pdf",
                "text": "sedation guidance",
                "category": "clinical_guidelines",
                "chunk_index": 0,
            }
        ],
    ) as mock_load, patch(
        "app.services.llm_services.rag_service.rag_service.index",
        return_value={
            "status": "indexed",
            "total_chunks": 11,
            "total_documents": 4,
        },
    ) as mock_index, patch(
        "app.services.llm_services.rag_service.rag_service.get_status",
        return_value={"embedding_model": "text-embedding-3-large"},
    ):
        response = await client.post(
            "/admin/vectors/upload",
            data={"collection": "clinical_guidelines", "metadata": '{"type":"guideline"}'},
            files={"file": ("sedation-guideline.pdf", file_bytes, "application/pdf")},
        )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["fileName"] == "sedation-guideline.pdf"
    assert payload["collection"] == "clinical_guidelines"
    assert payload["status"] == "indexed"
    assert payload["database"]["chunkCount"] == 11
    assert payload["database"]["documentCount"] == 4
    assert payload["metadata"]["type"] == "guideline"

    saved = tmp_path / "clinical_guidelines" / "sedation-guideline.pdf"
    assert saved.exists()
    assert saved.read_bytes() == file_bytes

    mock_load.assert_called_once_with(str(tmp_path))
    mock_index.assert_called_once()


@pytest.mark.asyncio
async def test_admin_vectors_upload_rejects_unsupported_extension(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "RAG_DOCS_PATH", str(tmp_path))

    response = await client.post(
        "/admin/vectors/upload",
        data={"collection": "clinical_guidelines"},
        files={"file": ("malware.exe", b"MZ", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Unsupported file extension" in response.json()["message"]


@pytest.mark.asyncio
async def test_admin_vectors_upload_rejects_invalid_metadata(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "RAG_DOCS_PATH", str(tmp_path))

    response = await client.post(
        "/admin/vectors/upload",
        data={"collection": "clinical_guidelines", "metadata": "invalid-json"},
        files={"file": ("sedation.pdf", b"%PDF", "application/pdf")},
    )
    assert response.status_code == 422
    assert "metadata must be valid JSON" in response.json()["message"]
