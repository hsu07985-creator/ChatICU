"""Tests for source registry (B02)."""

import json
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.source_registry import (
    IntentSourceConfig,
    SourceConfig,
    SourcePriorityEntry,
    SourceRegistry,
    SourceStatus,
    SourceType,
)


class TestSourceRegistryInit:
    """Test SourceRegistry initialization."""

    def test_registry_has_three_sources(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        assert "source_a_clinical" in registry.sources
        assert "source_b_qdrant" in registry.sources
        assert "source_c_graph" in registry.sources

    def test_source_types(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        assert registry.sources["source_a_clinical"].source_type == SourceType.clinical_rag
        assert registry.sources["source_b_qdrant"].source_type == SourceType.drug_rag
        assert registry.sources["source_c_graph"].source_type == SourceType.drug_graph


class TestSourcePriorities:
    """Test loading and using source priorities."""

    def test_load_priorities_from_json(self):
        priorities_data = {
            "pair_interaction": {
                "strategy": "parallel",
                "sources": [
                    {"source": "source_c_graph", "priority": 1, "required": False},
                    {"source": "source_b_qdrant", "priority": 2, "required": False},
                ],
                "min_sources_for_confidence": 1,
                "refuse_if_no_results": False,
                "confidence_threshold": 0.60,
            }
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(priorities_data, f)
            tmp_path = f.name

        try:
            with patch("app.services.source_registry.settings") as mock_settings:
                mock_settings.SOURCE_A_URL = "http://localhost:8000"
                mock_settings.SOURCE_B_URL = "http://localhost:8100"
                mock_settings.DRUG_GRAPH_ENABLED = True
                mock_settings.SOURCE_PRIORITIES_PATH = tmp_path
                registry = SourceRegistry()

            assert "pair_interaction" in registry.priorities
            config = registry.priorities["pair_interaction"]
            assert config.strategy == "parallel"
            assert len(config.sources) == 2
            assert config.confidence_threshold == 0.60
        finally:
            os.unlink(tmp_path)

    def test_get_available_sources_for_known_intent(self):
        priorities_data = {
            "iv_compatibility": {
                "strategy": "sequential",
                "sources": [
                    {"source": "source_c_graph", "priority": 1, "required": True},
                ],
                "refuse_if_no_results": True,
                "confidence_threshold": 0.90,
            }
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(priorities_data, f)
            tmp_path = f.name

        try:
            with patch("app.services.source_registry.settings") as mock_settings:
                mock_settings.SOURCE_A_URL = "http://localhost:8000"
                mock_settings.SOURCE_B_URL = "http://localhost:8100"
                mock_settings.DRUG_GRAPH_ENABLED = True
                mock_settings.SOURCE_PRIORITIES_PATH = tmp_path
                registry = SourceRegistry()

            sources = registry.get_available_sources("iv_compatibility")
            assert len(sources) == 1
            assert sources[0].source == "source_c_graph"
            assert sources[0].required is True
        finally:
            os.unlink(tmp_path)

    def test_get_available_sources_unknown_intent_returns_all(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        sources = registry.get_available_sources("unknown_intent_xyz")
        assert len(sources) == 3

    def test_get_available_sources_sorted_by_priority(self):
        priorities_data = {
            "dose_calculation": {
                "strategy": "parallel",
                "sources": [
                    {"source": "source_b_qdrant", "priority": 2, "required": True},
                    {"source": "source_a_pad", "priority": 1, "required": False},
                ],
            }
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(priorities_data, f)
            tmp_path = f.name

        try:
            with patch("app.services.source_registry.settings") as mock_settings:
                mock_settings.SOURCE_A_URL = "http://localhost:8000"
                mock_settings.SOURCE_B_URL = "http://localhost:8100"
                mock_settings.DRUG_GRAPH_ENABLED = True
                mock_settings.SOURCE_PRIORITIES_PATH = tmp_path
                registry = SourceRegistry()

            sources = registry.get_available_sources("dose_calculation")
            assert sources[0].source == "source_a_pad"
            assert sources[0].priority == 1
            assert sources[1].source == "source_b_qdrant"
            assert sources[1].priority == 2
        finally:
            os.unlink(tmp_path)


class TestIntentConfig:
    """Test get_intent_config method."""

    def test_get_intent_config_returns_none_for_unknown(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        assert registry.get_intent_config("nonexistent_intent") is None

    def test_get_intent_config_returns_config(self):
        priorities_data = {
            "dose_calculation": {
                "strategy": "parallel",
                "sources": [
                    {"source": "source_a_pad", "priority": 1},
                ],
                "confidence_threshold": 0.75,
            }
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(priorities_data, f)
            tmp_path = f.name

        try:
            with patch("app.services.source_registry.settings") as mock_settings:
                mock_settings.SOURCE_A_URL = "http://localhost:8000"
                mock_settings.SOURCE_B_URL = "http://localhost:8100"
                mock_settings.DRUG_GRAPH_ENABLED = True
                mock_settings.SOURCE_PRIORITIES_PATH = tmp_path
                registry = SourceRegistry()

            config = registry.get_intent_config("dose_calculation")
            assert config is not None
            assert config.confidence_threshold == 0.75
            assert config.strategy == "parallel"
        finally:
            os.unlink(tmp_path)


class TestHealthCheck:
    """Test health check functionality."""

    @pytest.mark.asyncio
    async def test_check_health_graph_available(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        with patch(
            "app.services.source_registry.SourceRegistry._check_graph_health",
            new_callable=AsyncMock,
            return_value=True,
        ):
            result = await registry.check_health("source_c_graph")
            assert result is True

    @pytest.mark.asyncio
    async def test_check_health_unknown_source(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        result = await registry.check_health("nonexistent_source")
        assert result is False

    @pytest.mark.asyncio
    async def test_check_health_http_failure(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        with patch(
            "app.services.source_registry.SourceRegistry._check_http_health",
            new_callable=AsyncMock,
            return_value=False,
        ):
            result = await registry.check_health("source_a_clinical")
            assert result is False

    @pytest.mark.asyncio
    async def test_check_all_returns_dict(self):
        with patch("app.services.source_registry.settings") as mock_settings:
            mock_settings.SOURCE_A_URL = "http://localhost:8000"
            mock_settings.SOURCE_B_URL = "http://localhost:8100"
            mock_settings.DRUG_GRAPH_ENABLED = True
            mock_settings.SOURCE_PRIORITIES_PATH = "/nonexistent/path.json"
            registry = SourceRegistry()

        with patch(
            "app.services.source_registry.SourceRegistry._check_http_health",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "app.services.source_registry.SourceRegistry._check_graph_health",
            new_callable=AsyncMock,
            return_value=False,
        ):
            results = await registry.check_all()
            assert len(results) == 3
            for name, status in results.items():
                assert isinstance(status, SourceStatus)
                assert status.name == name


class TestModels:
    """Test Pydantic models."""

    def test_source_status_model(self):
        s = SourceStatus(
            name="test",
            source_type=SourceType.clinical_rag,
            is_available=True,
            last_checked="2026-03-02T10:00:00Z",
            latency_ms=5.2,
        )
        assert s.name == "test"
        assert s.is_available is True

    def test_source_priority_entry(self):
        e = SourcePriorityEntry(
            source="source_c_graph",
            priority=1,
            required=True,
        )
        assert e.source == "source_c_graph"
        assert e.required is True

    def test_intent_source_config_defaults(self):
        c = IntentSourceConfig()
        assert c.strategy == "parallel"
        assert c.min_sources_for_confidence == 1
        assert c.refuse_if_no_results is False
        assert c.confidence_threshold == 0.55


class TestCheckHttpHealthUsesSharedClient:
    """Audit doc #7B: ``_check_http_health`` must reuse the shared
    ``httpx.AsyncClient`` from ``app.services._http`` so its connection
    pool is shared with drug_rag_client / pad_client. A regression here
    would mean every health probe re-handshakes its own TCP/TLS
    connection — invisible in unit tests but expensive in prod.
    """

    @pytest.mark.asyncio
    async def test_calls_get_shared_client_and_passes_per_call_timeout(self):
        from unittest.mock import AsyncMock, MagicMock, patch

        import httpx

        ok = MagicMock(spec=httpx.Response)
        ok.status_code = 200
        shared = MagicMock()
        shared.get = AsyncMock(return_value=ok)

        with patch(
            "app.services.source_registry.get_shared_client", return_value=shared
        ) as mock_factory:
            result = await SourceRegistry._check_http_health("http://probe-target")

        assert result is True
        mock_factory.assert_called_once()
        # Per-call timeout still 5.0s (was the constructor default).
        assert shared.get.call_args.kwargs.get("timeout") == 5.0
        # URL composed with /health suffix.
        url_arg = shared.get.call_args.args[0]
        assert url_arg == "http://probe-target/health"

    @pytest.mark.asyncio
    async def test_does_not_construct_new_async_client(self):
        """Belt-and-braces: if anyone re-introduces a per-call
        ``async with httpx.AsyncClient(...)`` inside _check_http_health,
        this test catches it because httpx.AsyncClient never gets
        instantiated when the helper is exercised.
        """
        from unittest.mock import AsyncMock, MagicMock, patch

        import httpx

        ok = MagicMock(spec=httpx.Response)
        ok.status_code = 200
        shared = MagicMock()
        shared.get = AsyncMock(return_value=ok)

        with patch(
            "app.services.source_registry.get_shared_client", return_value=shared
        ), patch(
            "app.services.source_registry.httpx.AsyncClient"
        ) as mock_async_client:
            await SourceRegistry._check_http_health("http://probe-target")

        mock_async_client.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_base_url_short_circuits_without_calling_client(self):
        from unittest.mock import patch

        with patch(
            "app.services.source_registry.get_shared_client"
        ) as mock_factory:
            result = await SourceRegistry._check_http_health("")

        assert result is False
        mock_factory.assert_not_called()
