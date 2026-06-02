"""Public DTOs and internal rule dataclasses for duplicate detection.

These dataclasses form the public contract consumed by the REST API, AI
snapshot builder and cache layer (``DuplicateAlert`` / ``DuplicateMember``)
plus the internal override-rule rows (``_UpgradeRule`` / ``_WhitelistRule``).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Literal, Optional

# ---------------------------------------------------------------------------
# Public type aliases
# ---------------------------------------------------------------------------
Level = Literal["critical", "high", "moderate", "low", "info"]
Layer = Literal["L1", "L2", "L3", "L4"]
Context = Literal["inpatient", "outpatient", "icu", "discharge"]


@dataclass
class DuplicateMember:
    """One medication participating in a duplicate alert."""

    medication_id: str
    generic_name: str
    atc_code: Optional[str]
    route: Optional[str]
    is_prn: bool
    last_admin_at: Optional[datetime]

    def to_dict(self) -> dict:
        # Emit camelCase keys to match the frontend TypeScript interface
        # (src/lib/api/medications.ts). Dataclass field names stay snake_case
        # so unit tests that poke at fields directly remain unchanged.
        return {
            "medicationId": self.medication_id,
            "genericName": self.generic_name,
            "atcCode": self.atc_code,
            "route": self.route,
            "isPrn": self.is_prn,
            "lastAdminAt": (
                self.last_admin_at.isoformat()
                if self.last_admin_at is not None
                else None
            ),
        }


@dataclass
class DuplicateAlert:
    """A single duplicate-medication finding, shared across all consumers."""

    fingerprint: str
    level: Level
    layer: Layer
    mechanism: str
    members: List[DuplicateMember]
    recommendation: str
    evidence_url: Optional[str]
    auto_downgraded: bool
    downgrade_reason: Optional[str]

    def to_dict(self) -> dict:
        # Emit camelCase keys to match the frontend TypeScript interface
        # (src/lib/api/medications.ts). Dataclass field names stay snake_case
        # so unit tests that poke at fields directly remain unchanged.
        return {
            "fingerprint": self.fingerprint,
            "level": self.level,
            "layer": self.layer,
            "mechanism": self.mechanism,
            "members": [m.to_dict() for m in self.members],
            "recommendation": self.recommendation,
            "evidenceUrl": self.evidence_url,
            "autoDowngraded": self.auto_downgraded,
            "downgradeReason": self.downgrade_reason,
        }


@dataclass
class _UpgradeRule:
    pattern_1: str
    pattern_2: str
    severity: str
    reason: str
    evidence_url: Optional[str]


@dataclass
class _WhitelistRule:
    pattern_1: str
    pattern_2: str
    reason: str
