"""Source Registry for the multi-source RAG orchestrator (B02).

Manages 3 knowledge sources:
  - Source A (Clinical RAG): PAD / Guideline / NHI modules via HTTP
  - Source B (Drug RAG Qdrant): 22K drugs via HTTP
  - Source C (Drug Graph): in-process NetworkX graph via drug_graph_bridge

Provides health checks, availability tracking, and priority-based
source selection per intent using source_priorities.json.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)


# ── Enums & Models ────────────────────────────────────────────────────────

class SourceType(str, Enum):
    clinical_rag = "clinical_rag"
    drug_rag = "drug_rag"
    drug_graph = "drug_graph"


class SourceStatus(BaseModel):
    """Health status for a single source."""
    name: str
    source_type: SourceType
    is_available: bool = False
    last_checked: Optional[str] = None  # ISO 8601
    latency_ms: Optional[float] = None
    error: Optional[str] = None


class SourceConfig(BaseModel):
    """Configuration for a single knowledge source."""
    name: str
    source_type: SourceType
    base_url: Optional[str] = None
    is_available: bool = False
    last_checked: Optional[float] = None  # epoch timestamp
    check_interval_seconds: int = 60


class SourcePriorityEntry(BaseModel):
    """A single source entry in the priority list."""
    source: str
    priority: int = 1
    required: bool = False
    cascade_condition: Optional[str] = None


class IntentSourceConfig(BaseModel):
    """Per-intent source priority configuration."""
    strategy: str = "parallel"  # "parallel" or "sequential"
    sources: List[SourcePriorityEntry] = Field(default_factory=list)
    min_sources_for_confidence: int = 1
    refuse_if_no_results: bool = False
    confidence_threshold: float = 0.55
    cascade_condition: Optional[str] = None


# ── Source Registry ───────────────────────────────────────────────────────

class SourceRegistry:
    """Manages knowledge source configuration, health, and priority selection."""

    def __init__(self) -> None:
        self._sources: Dict[str, SourceConfig] = {}
        self._priorities: Dict[str, IntentSourceConfig] = {}
        self._initialize_sources()
        self._load_priorities()

    def _initialize_sources(self) -> None:
        """Register the 3 knowledge sources with default configuration."""
        self._sources["source_a_clinical"] = SourceConfig(
            name="source_a_clinical",
            source_type=SourceType.clinical_rag,
            base_url=settings.SOURCE_A_URL,
            check_interval_seconds=60,
        )
        self._sources["source_b_qdrant"] = SourceConfig(
            name="source_b_qdrant",
            source_type=SourceType.drug_rag,
            base_url=settings.SOURCE_B_URL,
            check_interval_seconds=60,
        )
        self._sources["source_c_graph"] = SourceConfig(
            name="source_c_graph",
            source_type=SourceType.drug_graph,
            base_url=None,  # In-process, no URL
            check_interval_seconds=300,  # Graph rarely changes
        )

    def _load_priorities(self) -> None:
        """Load per-intent source priorities from JSON config file."""
        config_path = Path(settings.SOURCE_PRIORITIES_PATH)
        # Try relative to backend/ directory first
        if not config_path.is_absolute():
            backend_dir = Path(__file__).resolve().parents[2]
            config_path = backend_dir / config_path

        if not config_path.exists():
            logger.warning(
                "[ORCH] Source priorities config not found at %s, using defaults",
                config_path,
            )
            return

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                raw = json.load(f)

            for intent_name, intent_config in raw.items():
                sources_raw = intent_config.get("sources", [])
                sources = [SourcePriorityEntry(**s) for s in sources_raw]
                self._priorities[intent_name] = IntentSourceConfig(
                    strategy=intent_config.get("strategy", "parallel"),
                    sources=sources,
                    min_sources_for_confidence=intent_config.get(
                        "min_sources_for_confidence", 1
                    ),
                    refuse_if_no_results=intent_config.get(
                        "refuse_if_no_results", False
                    ),
                    confidence_threshold=intent_config.get(
                        "confidence_threshold", 0.55
                    ),
                    cascade_condition=intent_config.get("cascade_condition"),
                )

            logger.info(
                "[ORCH] Loaded source priorities for %d intents from %s",
                len(self._priorities),
                config_path,
            )
        except Exception as exc:
            logger.error(
                "[ORCH] Failed to load source priorities from %s: %s",
                config_path,
                exc,
            )

    async def check_health(self, source_name: str) -> bool:
        """Check health of a single source. Returns True if available."""
        source = self._sources.get(source_name)
        if source is None:
            logger.warning("[ORCH] Unknown source: %s", source_name)
            return False

        now = time.time()

        # Skip check if recently checked and still within interval
        if (
            source.last_checked is not None
            and (now - source.last_checked) < source.check_interval_seconds
        ):
            return source.is_available

        start = time.monotonic()
        try:
            if source.source_type == SourceType.drug_graph:
                available = await self._check_graph_health()
            else:
                available = await self._check_http_health(source.base_url or "")
        except Exception as exc:
            logger.warning(
                "[ORCH] Health check failed for %s: %s", source_name, exc
            )
            available = False

        elapsed_ms = (time.monotonic() - start) * 1000
        source.is_available = available
        source.last_checked = now

        logger.debug(
            "[ORCH] Health check %s: available=%s latency=%.1fms",
            source_name,
            available,
            elapsed_ms,
        )
        return available

    async def check_all(self) -> Dict[str, SourceStatus]:
        """Check health of all registered sources."""
        results: Dict[str, SourceStatus] = {}
        for name, source in self._sources.items():
            start = time.monotonic()
            error_msg: Optional[str] = None
            try:
                is_available = await self.check_health(name)
            except Exception as exc:
                is_available = False
                error_msg = str(exc)

            elapsed_ms = (time.monotonic() - start) * 1000
            results[name] = SourceStatus(
                name=name,
                source_type=source.source_type,
                is_available=is_available,
                last_checked=datetime.now(timezone.utc).isoformat(),
                latency_ms=round(elapsed_ms, 1),
                error=error_msg,
            )
        return results

    def get_available_sources(
        self,
        intent: str,
        priorities: Optional[Dict[str, Any]] = None,
    ) -> List[SourcePriorityEntry]:
        """Get ordered list of sources for a given intent.

        Uses source_priorities.json config. Falls back to returning all
        available sources if no config is found for the intent.

        Args:
            intent: The classified intent name.
            priorities: Optional override for priority config (for testing).

        Returns:
            List of SourcePriorityEntry sorted by priority (lowest = highest priority).
        """
        if priorities:
            # Use provided priorities dict directly
            sources_raw = priorities.get("sources", [])
            entries = [
                SourcePriorityEntry(**s) if isinstance(s, dict) else s
                for s in sources_raw
            ]
        elif intent in self._priorities:
            entries = self._priorities[intent].sources
        else:
            # Fallback: return all sources with equal priority
            logger.debug(
                "[ORCH] No priority config for intent=%s, returning all sources",
                intent,
            )
            entries = [
                SourcePriorityEntry(source=name, priority=idx + 1)
                for idx, name in enumerate(self._sources.keys())
            ]

        # Sort by priority (ascending = highest priority first)
        return sorted(entries, key=lambda e: e.priority)

    def get_intent_config(self, intent: str) -> Optional[IntentSourceConfig]:
        """Get full intent configuration including strategy and thresholds."""
        return self._priorities.get(intent)

    def get_source(self, source_name: str) -> Optional[SourceConfig]:
        """Get a source configuration by name."""
        return self._sources.get(source_name)

    @property
    def sources(self) -> Dict[str, SourceConfig]:
        """Read-only access to registered sources."""
        return dict(self._sources)

    @property
    def priorities(self) -> Dict[str, IntentSourceConfig]:
        """Read-only access to loaded priorities."""
        return dict(self._priorities)

    # ── Internal health check implementations ─────────────────────────────

    @staticmethod
    async def _check_http_health(base_url: str) -> bool:
        """Check HTTP health endpoint."""
        if not base_url:
            return False
        url = f"{base_url.rstrip('/')}/health"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                return resp.status_code == 200
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout):
            return False
        except Exception as exc:
            logger.debug("[ORCH] HTTP health check error for %s: %s", url, exc)
            return False

    @staticmethod
    async def _check_graph_health() -> bool:
        """Check Drug Graph (Source C) availability in-process."""
        if not settings.DRUG_GRAPH_ENABLED:
            return False
        try:
            from app.services.drug_graph_bridge import drug_graph_bridge
            return drug_graph_bridge.is_ready()
        except Exception:
            return False


# Module-level singleton
source_registry = SourceRegistry()
