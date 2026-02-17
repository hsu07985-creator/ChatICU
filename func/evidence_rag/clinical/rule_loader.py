"""Load clinical rule sets through repository abstraction."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .exceptions import ClinicalRuleError
from .repositories import JsonRuleRepository, RuleRepository
from .validators import validate_dose_rules, validate_interaction_rules


@dataclass
class LoadedRuleSets:
    dose: dict[str, Any]
    interaction: dict[str, Any]
    manifest: dict[str, Any]
    source_info: dict[str, Any]


class ClinicalRuleStore:
    """Loads and caches clinical rules from configured repository."""

    def __init__(
        self,
        manifest_path: Path | None = None,
        repository: RuleRepository | None = None,
    ):
        if repository is None:
            if manifest_path is None:
                raise ClinicalRuleError("ClinicalRuleStore requires manifest_path or repository")
            repository = JsonRuleRepository(Path(manifest_path))
        self.repository = repository
        self._cached_payload: LoadedRuleSets | None = None
        self._cached_signature: str | None = None

    def load(self) -> LoadedRuleSets:
        repo_payload = self.repository.load()
        sig = repo_payload.signature
        if self._cached_payload is not None and self._cached_signature == sig:
            return self._cached_payload

        dose_payload = repo_payload.dose
        interaction_payload = repo_payload.interaction

        validate_dose_rules(dose_payload)
        validate_interaction_rules(interaction_payload)

        loaded = LoadedRuleSets(
            dose=dose_payload,
            interaction=interaction_payload,
            manifest=repo_payload.manifest,
            source_info=repo_payload.source_info,
        )
        self._cached_payload = loaded
        self._cached_signature = sig
        return loaded

    def clear_cache(self) -> None:
        self.repository.clear_cache()
        self._cached_payload = None
        self._cached_signature = None

    def reload(self) -> LoadedRuleSets:
        self.clear_cache()
        return self.load()

    def snapshot(self) -> dict[str, Any]:
        loaded = self.load()
        dose_rules = list(loaded.dose.get("rules", []))
        interaction_rules = list(loaded.interaction.get("rules", []))
        source_info = dict(loaded.source_info or {})
        repo_desc = dict(self.repository.describe())
        manifest_path = str(source_info.get("manifest_path") or repo_desc.get("manifest_path") or "")
        return {
            "active_release": str(loaded.manifest.get("active_release", "")),
            "manifest_path": manifest_path,
            "dose_version": str(loaded.dose.get("version", "")),
            "interaction_version": str(loaded.interaction.get("version", "")),
            "dose_rule_count": len(dose_rules),
            "interaction_rule_count": len(interaction_rules),
            "dose_rule_ids": [str(x.get("rule_id", "")) for x in dose_rules],
            "interaction_rule_ids": [str(x.get("rule_id", "")) for x in interaction_rules],
            "rule_source": str(source_info.get("source") or repo_desc.get("source") or ""),
            "repository": repo_desc,
            "source_info": source_info,
        }
