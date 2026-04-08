"""Tests for Drug RAG client (B03)."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.drug_rag_client import (
    DrugRagChunk,
    DrugRagClient,
    DrugRagResponse,
    EvidenceItem,
)


def _mock_httpx_response(data, status_code=200):
    """Create a mock httpx Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = data
    resp.raise_for_status.return_value = None
    resp.text = str(data)
    return resp


class TestDrugRagClientQuery:
    """Test DrugRagClient.query method."""

    @pytest.mark.asyncio
    async def test_successful_query(self):
        mock_data = {
            "answer": "Vancomycin dosing should be adjusted for renal function.",
            "category": "dosing",
            "citations": [
                {
                    "chunk_id": "vanco_dose_001",
                    "text": "Vancomycin: adjust dose per CrCl...",
                    "score": 0.92,
                    "source_type": "monograph",
                    "drug_name": "Vancomycin",
                },
                {
                    "chunk_id": "vanco_dose_002",
                    "text": "For CrCl < 30, consider TDM...",
                    "score": 0.85,
                    "drug_name": "Vancomycin",
                },
            ],
        }
        mock_resp = _mock_httpx_response(mock_data)

        with patch("app.services.drug_rag_client.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            client = DrugRagClient(base_url="http://localhost:8100")
            result = await client.query("Vancomycin dosing in renal failure")

        assert result.success is True
        assert result.answer is not None
        assert "Vancomycin" in result.answer
        assert len(result.chunks) == 2
        assert result.chunks[0].chunk_id == "vanco_dose_001"
        assert result.chunks[0].score == 0.92
        assert result.category == "dosing"

    @pytest.mark.asyncio
    async def test_query_with_category_hint(self):
        mock_data = {
            "answer": "Some answer",
            "category": "interaction",
            "citations": [],
        }
        mock_resp = _mock_httpx_response(mock_data)

        with patch("app.services.drug_rag_client.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            client = DrugRagClient(base_url="http://localhost:8100")
            result = await client.query(
                "Warfarin interactions",
                category_hint="interaction",
            )

        assert result.success is True
        # Verify category was sent in payload
        call_kwargs = mock_client.post.call_args
        payload = call_kwargs.kwargs.get("json", call_kwargs[1].get("json", {}))
        assert payload.get("category") == "interaction"

    @pytest.mark.asyncio
    async def test_query_timeout_returns_empty(self):
        with patch("app.services.drug_rag_client.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(
                side_effect=httpx.ReadTimeout("timeout")
            )
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            client = DrugRagClient(base_url="http://localhost:8100", timeout=2.0)
            result = await client.query("test query")

        assert result.success is False
        assert "timeout" in (result.error or "")
        assert len(result.chunks) == 0

    @pytest.mark.asyncio
    async def test_query_connection_error(self):
        with patch("app.services.drug_rag_client.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(
                side_effect=httpx.ConnectError("refused")
            )
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            client = DrugRagClient(base_url="http://localhost:8100")
            result = await client.query("test query")

        assert result.success is False
        assert result.error == "connection_failed"

    @pytest.mark.asyncio
    async def test_query_http_error(self):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 500
        mock_resp.text = "Internal Server Error"
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500", request=MagicMock(), response=mock_resp
        )

        with patch("app.services.drug_rag_client.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            client = DrugRagClient(base_url="http://localhost:8100")
            result = await client.query("test query")

        assert result.success is False
        assert "http_500" in (result.error or "")


class TestDrugRagClientHealth:
    """Test DrugRagClient.health method."""

    @pytest.mark.asyncio
    async def test_health_check_success(self):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 200

        with patch("app.services.drug_rag_client.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            client = DrugRagClient(base_url="http://localhost:8100")
            result = await client.health()

        assert result is True

    @pytest.mark.asyncio
    async def test_health_check_failure(self):
        with patch("app.services.drug_rag_client.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(
                side_effect=httpx.ConnectError("refused")
            )
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            client = DrugRagClient(base_url="http://localhost:8100")
            result = await client.health()

        assert result is False


class TestEvidenceItemConversion:
    """Test conversion from DrugRagResponse to EvidenceItem format."""

    def test_convert_chunks_to_evidence_items(self):
        response = DrugRagResponse(
            success=True,
            answer="Test answer",
            chunks=[
                DrugRagChunk(
                    chunk_id="chunk_001",
                    text="Vancomycin dose adjustment...",
                    score=0.92,
                    source_type="monograph",
                    drug_name="Vancomycin",
                ),
                DrugRagChunk(
                    chunk_id="chunk_002",
                    text="Meropenem pharmacokinetics...",
                    score=0.78,
                    source_type="pharmacology",
                    drug_name="Meropenem",
                ),
            ],
        )

        client = DrugRagClient(base_url="http://localhost:8100")
        items = client.to_evidence_items(response)

        assert len(items) == 2
        assert items[0].chunk_id == "chunk_001"
        assert items[0].source_system == "drug_rag_qdrant"
        assert items[0].relevance_score == 0.92
        assert items[0].drug_names == ["Vancomycin"]
        assert items[0].evidence_grade == "monograph"
        assert items[1].drug_names == ["Meropenem"]

    def test_convert_empty_response(self):
        response = DrugRagResponse(success=False, error="timeout")
        client = DrugRagClient(base_url="http://localhost:8100")
        items = client.to_evidence_items(response)
        assert len(items) == 0

    def test_convert_chunk_without_drug_name(self):
        response = DrugRagResponse(
            success=True,
            chunks=[
                DrugRagChunk(
                    chunk_id="chunk_003",
                    text="General pharmacology...",
                    score=0.60,
                    drug_name=None,
                ),
            ],
        )

        client = DrugRagClient(base_url="http://localhost:8100")
        items = client.to_evidence_items(response)
        assert len(items) == 1
        assert items[0].drug_names == []


class TestModels:
    """Test Pydantic models."""

    def test_drug_rag_chunk_defaults(self):
        c = DrugRagChunk()
        assert c.chunk_id == ""
        assert c.text == ""
        assert c.score == 0.0

    def test_drug_rag_response_defaults(self):
        r = DrugRagResponse()
        assert r.success is False
        assert r.chunks == []
        assert r.error is None

    def test_evidence_item_defaults(self):
        e = EvidenceItem()
        assert e.source_system == "drug_rag_qdrant"
        assert e.evidence_grade == "monograph"
        assert e.drug_names == []
