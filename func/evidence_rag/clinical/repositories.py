"""Repository abstraction for clinical rule sources (JSON file or remote API)."""

from __future__ import annotations

import hashlib
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from .exceptions import ClinicalRuleError


@dataclass
class RepositoryPayload:
    manifest: dict[str, Any]
    dose: dict[str, Any]
    interaction: dict[str, Any]
    signature: str
    source_info: dict[str, Any]


class RuleRepository(ABC):
    """Abstract rule source used by ClinicalRuleStore."""

    @abstractmethod
    def load(self) -> RepositoryPayload:
        """Load and return rule payloads plus a cache signature."""

    @abstractmethod
    def clear_cache(self) -> None:
        """Clear repository-level cache."""

    @abstractmethod
    def describe(self) -> dict[str, Any]:
        """Describe repository configuration for observability."""


class JsonRuleRepository(RuleRepository):
    """Read rules from local manifest and JSON files."""

    def __init__(self, manifest_path: Path):
        self.manifest_path = manifest_path

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            raise ClinicalRuleError(f"Rule file does not exist: {path}")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise ClinicalRuleError(f"Invalid JSON: {path}: {exc}") from exc

    def _resolve_rule_path(self, raw_path: str) -> Path:
        p = Path(raw_path)
        if p.is_absolute():
            return p
        return (self.manifest_path.parent / p).resolve()

    def _signature(self, manifest: Path, dose: Path, interaction: Path) -> str:
        return ":".join(
            [
                str(manifest.stat().st_mtime_ns),
                str(dose.stat().st_mtime_ns),
                str(interaction.stat().st_mtime_ns),
            ]
        )

    def load(self) -> RepositoryPayload:
        manifest = self._read_json(self.manifest_path)
        rule_sets = manifest.get("rule_sets", {})
        dose_entry = dict(rule_sets.get("dose", {}))
        interaction_entry = dict(rule_sets.get("interaction", {}))
        dose_path = self._resolve_rule_path(str(dose_entry.get("path", "")))
        interaction_path = self._resolve_rule_path(str(interaction_entry.get("path", "")))
        if not dose_path.exists() or not interaction_path.exists():
            raise ClinicalRuleError(
                f"Rule set path missing. dose={dose_path.exists()} interaction={interaction_path.exists()}"
            )

        return RepositoryPayload(
            manifest=manifest,
            dose=self._read_json(dose_path),
            interaction=self._read_json(interaction_path),
            signature=self._signature(self.manifest_path, dose_path, interaction_path),
            source_info={
                "source": "json",
                "manifest_path": str(self.manifest_path.resolve()),
                "dose_path": str(dose_path),
                "interaction_path": str(interaction_path),
            },
        )

    def clear_cache(self) -> None:
        # No repository-level cache; store-level cache is sufficient for local files.
        return None

    def describe(self) -> dict[str, Any]:
        return {
            "source": "json",
            "manifest_path": str(self.manifest_path.resolve()),
        }


class ApiRuleRepository(RuleRepository):
    """Read rules from remote JSON API."""

    def __init__(
        self,
        *,
        api_url: str,
        timeout_sec: float = 8.0,
        poll_interval_sec: int = 30,
        bearer_token: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ):
        if not str(api_url or "").strip():
            raise ClinicalRuleError("ApiRuleRepository requires non-empty api_url")
        self.api_url = str(api_url).strip()
        self.timeout_sec = float(timeout_sec)
        self.poll_interval_sec = int(max(poll_interval_sec, 0))
        self.bearer_token = bearer_token
        self.extra_headers = dict(extra_headers or {})
        self._cached_payload: RepositoryPayload | None = None
        self._cached_ts: float = 0.0

    def _headers(self) -> dict[str, str]:
        out = {"Accept": "application/json"}
        if self.bearer_token:
            out["Authorization"] = f"Bearer {self.bearer_token}"
        out.update(self.extra_headers)
        return out

    def _fetch_json(self, url: str) -> dict[str, Any]:
        req = Request(url=url, headers=self._headers(), method="GET")
        try:
            with urlopen(req, timeout=self.timeout_sec) as resp:
                body = resp.read().decode("utf-8")
        except HTTPError as exc:
            raise ClinicalRuleError(
                f"Rule API HTTP error url={url} status={exc.code} reason={exc.reason}"
            ) from exc
        except URLError as exc:
            raise ClinicalRuleError(f"Rule API network error url={url}: {exc}") from exc
        except Exception as exc:
            raise ClinicalRuleError(f"Rule API request failed url={url}: {exc}") from exc

        try:
            payload = json.loads(body)
        except Exception as exc:
            raise ClinicalRuleError(f"Rule API returned invalid JSON url={url}: {exc}") from exc

        if not isinstance(payload, dict):
            raise ClinicalRuleError(f"Rule API payload must be JSON object url={url}")
        return payload

    def _resolve_remote_url(self, raw_url: str) -> str:
        parsed = urlparse(raw_url)
        if parsed.scheme and parsed.netloc:
            return raw_url
        return urljoin(self.api_url, raw_url)

    def _extract_bundle(self, root: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        manifest_raw = root.get("manifest", root)
        manifest = dict(manifest_raw if isinstance(manifest_raw, dict) else {})
        dose = root.get("dose")
        interaction = root.get("interaction")

        if isinstance(dose, dict) and isinstance(interaction, dict):
            return manifest, dose, interaction

        rule_sets = manifest.get("rule_sets", {})
        if not isinstance(rule_sets, dict):
            raise ClinicalRuleError("Rule API payload missing `rule_sets` and embedded `dose`/`interaction`")

        dose_entry = dict(rule_sets.get("dose", {}))
        interaction_entry = dict(rule_sets.get("interaction", {}))
        dose_ref = str(dose_entry.get("url") or dose_entry.get("path") or "").strip()
        interaction_ref = str(interaction_entry.get("url") or interaction_entry.get("path") or "").strip()
        if not dose_ref or not interaction_ref:
            raise ClinicalRuleError(
                "Rule API manifest must include dose and interaction `url` or `path`"
            )

        dose_payload = self._fetch_json(self._resolve_remote_url(dose_ref))
        interaction_payload = self._fetch_json(self._resolve_remote_url(interaction_ref))
        return manifest, dose_payload, interaction_payload

    def _hash_signature(
        self,
        *,
        manifest: dict[str, Any],
        dose: dict[str, Any],
        interaction: dict[str, Any],
    ) -> str:
        canonical = json.dumps(
            {"manifest": manifest, "dose": dose, "interaction": interaction},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def load(self) -> RepositoryPayload:
        now = time.monotonic()
        if (
            self._cached_payload is not None
            and self.poll_interval_sec > 0
            and (now - self._cached_ts) < self.poll_interval_sec
        ):
            return self._cached_payload

        root = self._fetch_json(self.api_url)
        manifest, dose, interaction = self._extract_bundle(root)
        # Cache signature must track payload content, not only vendor-provided signature.
        # Some upstream APIs may return a static/incorrect signature value.
        signature_raw = root.get("signature")
        signature = self._hash_signature(manifest=manifest, dose=dose, interaction=interaction)

        payload = RepositoryPayload(
            manifest=manifest,
            dose=dose,
            interaction=interaction,
            signature=signature,
            source_info={
                "source": "api",
                "api_url": self.api_url,
                "upstream_signature": str(signature_raw or ""),
                "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
            },
        )
        self._cached_payload = payload
        self._cached_ts = now
        return payload

    def clear_cache(self) -> None:
        self._cached_payload = None
        self._cached_ts = 0.0

    def describe(self) -> dict[str, Any]:
        return {
            "source": "api",
            "api_url": self.api_url,
            "timeout_sec": self.timeout_sec,
            "poll_interval_sec": self.poll_interval_sec,
            "auth_enabled": bool(self.bearer_token),
        }
