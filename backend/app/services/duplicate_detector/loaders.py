"""RuleRepository — lazy DB-first / CSV-fallback loading of seed data.

Consolidates the three near-identical (override / mechanism-group /
endpoint-group) load pipelines that previously lived as ~6 methods on
DuplicateDetector. Each dataset is loaded at most once (lazy), trying the
DB first and falling back to the bundled CSV when the table is missing or
empty. Behaviour is byte-for-byte equivalent to the pre-split methods.
"""
from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .knowledge import _SUBTYPE_COVERAGE_GROUPS
from .models import _UpgradeRule, _WhitelistRule

logger = logging.getLogger(__name__)

# Directory holding the bundled CSV seed files (app/fhir/code_maps).
_CODE_MAPS_DIR = Path(__file__).resolve().parent.parent.parent / "fhir" / "code_maps"


def _non_comment_lines(fh: Iterable[str]) -> Iterable[str]:
    """Yield CSV lines, skipping blank lines and ``#`` comment lines."""
    for line in fh:
        if line.lstrip() and not line.lstrip().startswith("#"):
            yield line


class RuleRepository:
    """Holds override / mechanism-group / endpoint-group seed data.

    One instance per DuplicateDetector. Loads are lazy and idempotent: the
    first call to each ``load_*`` runs (DB → CSV fallback), subsequent calls
    are no-ops.
    """

    def __init__(self, session: AsyncSession):
        self.session = session

        self._overrides_loaded = False
        self.upgrade_rules: List[_UpgradeRule] = []
        self.whitelist_rules: List[_WhitelistRule] = []

        # L3 mechanism groups. Shape:
        # {group_key: {"zh": str, "en": str, "severity": str, "members": set[str]}}
        self._mechanism_groups_loaded = False
        self.mechanism_groups: Dict[str, Dict[str, Any]] = {}

        # L4 endpoint groups. Shape:
        # {group_key: {"zh": str, "en": str, "severity": str,
        #              "members_by_atc": dict[str, {ingredient, subtype}],
        #              "requires_subtypes": Optional[set[str]]}}
        self._endpoint_groups_loaded = False
        self.endpoint_groups: Dict[str, Dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Generic lazy DB-first / CSV-fallback driver
    # ------------------------------------------------------------------
    async def _lazy_load(
        self,
        *,
        name: str,
        db_loader: Callable[[], Awaitable[None]],
        csv_loader: Callable[[], None],
        has_data: Callable[[], bool],
        after: Optional[Callable[[], None]] = None,
    ) -> None:
        """Run a DB-first / CSV-fallback load exactly once.

        Mirrors the original per-dataset ``_load_*`` orchestration:
          1. Try the DB loader; if it populated data, stop (after-hook runs).
          2. Otherwise fall back to the CSV loader.
          3. Run the optional ``after`` hook (idempotent post-processing).
        """
        try:
            await db_loader()
            if has_data():
                if after is not None:
                    after()
                return
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "duplicate_detector: %s DB load failed: %s", name, exc
            )

        try:
            csv_loader()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "duplicate_detector: %s CSV load failed: %s", name, exc
            )

        if after is not None:
            after()

    # ------------------------------------------------------------------
    # Overrides (§3.1 upgrade + §3.3 whitelist)
    # ------------------------------------------------------------------
    async def load_overrides(self) -> None:
        if self._overrides_loaded:
            return
        self._overrides_loaded = True  # set early to avoid repeated retries on failure
        await self._lazy_load(
            name="override",
            db_loader=self._load_overrides_from_db,
            csv_loader=self._load_overrides_from_csv,
            has_data=lambda: bool(self.upgrade_rules or self.whitelist_rules),
        )

    async def _load_overrides_from_db(self) -> None:
        row_iter: Iterable[Tuple[str, str, str, Optional[str], Optional[str], Optional[str]]]
        result = await self.session.execute(
            text(
                "SELECT rule_type, atc_code_1, atc_code_2, severity_override, "
                "reason, evidence_url FROM duplicate_rule_overrides"
            )
        )
        row_iter = result.all()
        for rule_type, a1, a2, sev, reason, ev in row_iter:
            self._ingest_override_row(rule_type, a1, a2, sev, reason, ev)

    def _load_overrides_from_csv(self) -> None:
        csv_path = _CODE_MAPS_DIR / "duplicate_rule_overrides.csv"
        if not csv_path.is_file():
            logger.info("duplicate_detector: %s not found; skipping CSV load", csv_path)
            return

        with csv_path.open("r", encoding="utf-8") as fh:
            # The CSV has comment lines beginning with "#" — skip those.
            non_comment = (line for line in fh if not line.lstrip().startswith("#"))
            reader = csv.DictReader(non_comment)
            for row in reader:
                self._ingest_override_row(
                    (row.get("rule_type") or "").strip(),
                    (row.get("atc_code_1") or "").strip(),
                    (row.get("atc_code_2") or "").strip(),
                    (row.get("severity_override") or "").strip() or None,
                    (row.get("reason") or "").strip() or None,
                    (row.get("evidence_url") or "").strip() or None,
                )

    def _ingest_override_row(
        self,
        rule_type: str,
        atc1: str,
        atc2: str,
        sev: Optional[str],
        reason: Optional[str],
        evidence_url: Optional[str],
    ) -> None:
        if not rule_type or not atc1 or not atc2:
            return
        rt = rule_type.lower()
        if rt == "upgrade":
            self.upgrade_rules.append(
                _UpgradeRule(
                    pattern_1=atc1,
                    pattern_2=atc2,
                    severity=(sev or "critical").lower(),
                    reason=reason or "",
                    evidence_url=evidence_url,
                )
            )
        elif rt == "whitelist":
            self.whitelist_rules.append(
                _WhitelistRule(
                    pattern_1=atc1, pattern_2=atc2, reason=reason or ""
                )
            )

    # ------------------------------------------------------------------
    # L3 mechanism groups
    # ------------------------------------------------------------------
    async def load_mechanism_groups(self) -> None:
        if self._mechanism_groups_loaded:
            return
        self._mechanism_groups_loaded = True  # set early to avoid retry storms
        await self._lazy_load(
            name="mechanism group",
            db_loader=self._load_mechanism_groups_from_db,
            csv_loader=self._load_mechanism_groups_from_csv,
            has_data=lambda: bool(self.mechanism_groups),
        )

    async def _load_mechanism_groups_from_db(self) -> None:
        # Pull the full group × member table in one round trip.
        result = await self.session.execute(
            text(
                "SELECT g.group_key, g.group_name_zh, g.group_name_en, "
                "g.severity, m.atc_code "
                "FROM drug_mechanism_groups g "
                "JOIN drug_mechanism_group_members m "
                "  ON m.group_id = g.id"
            )
        )
        rows = result.all()
        for group_key, zh, en, severity, atc in rows:
            if not group_key or not atc:
                continue
            entry = self.mechanism_groups.setdefault(
                group_key,
                {
                    "zh": zh or group_key,
                    "en": en or "",
                    "severity": (severity or "high").lower(),
                    "members": set(),
                },
            )
            # Keep the first non-null zh/en/severity we see (all rows for a
            # group have identical group-level fields).
            if zh and not entry.get("zh"):
                entry["zh"] = zh
            if en and not entry.get("en"):
                entry["en"] = en
            if severity and entry.get("severity") in (None, "", "high"):
                entry["severity"] = severity.lower()
            entry["members"].add(atc.strip())

    def _load_mechanism_groups_from_csv(self) -> None:
        groups_csv = _CODE_MAPS_DIR / "drug_mechanism_groups.csv"
        members_csv = _CODE_MAPS_DIR / "drug_mechanism_group_members.csv"

        if not groups_csv.is_file() or not members_csv.is_file():
            logger.info(
                "duplicate_detector: mechanism CSVs not found (%s / %s); "
                "skipping L3 groups",
                groups_csv,
                members_csv,
            )
            return

        # Groups
        with groups_csv.open("r", encoding="utf-8") as fh:
            reader = csv.DictReader(_non_comment_lines(fh))
            for row in reader:
                key = (row.get("group_key") or "").strip()
                if not key:
                    continue
                self.mechanism_groups[key] = {
                    "zh": (row.get("group_name_zh") or key).strip(),
                    "en": (row.get("group_name_en") or "").strip(),
                    "severity": (
                        (row.get("severity") or "high").strip().lower()
                    ),
                    "members": set(),
                }

        # Members
        with members_csv.open("r", encoding="utf-8") as fh:
            reader = csv.DictReader(_non_comment_lines(fh))
            for row in reader:
                key = (row.get("group_key") or "").strip()
                atc = (row.get("atc_code") or "").strip()
                if not key or not atc:
                    continue
                entry = self.mechanism_groups.get(key)
                if entry is None:
                    # Member references an unknown group — skip rather than
                    # auto-create, to surface CSV drift.
                    logger.debug(
                        "duplicate_detector: member references unknown "
                        "group_key=%r (atc=%s)",
                        key,
                        atc,
                    )
                    continue
                entry["members"].add(atc)

    # ------------------------------------------------------------------
    # L4 endpoint groups
    # ------------------------------------------------------------------
    async def load_endpoint_groups(self) -> None:
        if self._endpoint_groups_loaded:
            return
        self._endpoint_groups_loaded = True
        await self._lazy_load(
            name="endpoint group",
            db_loader=self._load_endpoint_groups_from_db,
            csv_loader=self._load_endpoint_groups_from_csv,
            has_data=lambda: bool(self.endpoint_groups),
            # Tag subtype-coverage groups after load (idempotent).
            after=self._apply_subtype_coverage_requirements,
        )

    async def _load_endpoint_groups_from_db(self) -> None:
        result = await self.session.execute(
            text(
                "SELECT g.group_key, g.group_name_zh, g.group_name_en, "
                "g.severity, m.atc_code, m.active_ingredient, "
                "m.member_subtype "
                "FROM drug_endpoint_groups g "
                "JOIN drug_endpoint_group_members m "
                "  ON m.group_id = g.id"
            )
        )
        rows = result.all()
        for group_key, zh, en, severity, atc, ingredient, subtype in rows:
            if not group_key or not atc:
                continue
            entry = self.endpoint_groups.setdefault(
                group_key,
                {
                    "zh": zh or group_key,
                    "en": en or "",
                    "severity": (severity or "high").lower(),
                    "members_by_atc": {},
                    "requires_subtypes": None,
                },
            )
            if zh and not entry.get("zh"):
                entry["zh"] = zh
            if en and not entry.get("en"):
                entry["en"] = en
            if severity and not entry.get("severity"):
                entry["severity"] = severity.lower()
            entry["members_by_atc"][atc.strip()] = {
                "ingredient": (ingredient or "").strip() or None,
                "subtype": (subtype or "").strip() or None,
            }

    def _load_endpoint_groups_from_csv(self) -> None:
        groups_csv = _CODE_MAPS_DIR / "drug_endpoint_groups.csv"
        members_csv = _CODE_MAPS_DIR / "drug_endpoint_group_members.csv"

        if not groups_csv.is_file() or not members_csv.is_file():
            logger.info(
                "duplicate_detector: endpoint CSVs not found (%s / %s); "
                "skipping L4 groups",
                groups_csv,
                members_csv,
            )
            return

        # Groups
        with groups_csv.open("r", encoding="utf-8") as fh:
            reader = csv.DictReader(_non_comment_lines(fh))
            for row in reader:
                key = (row.get("group_key") or "").strip()
                if not key:
                    continue
                self.endpoint_groups[key] = {
                    "zh": (row.get("group_name_zh") or key).strip(),
                    "en": (row.get("group_name_en") or "").strip(),
                    "severity": (
                        (row.get("severity") or "high").strip().lower()
                    ),
                    "members_by_atc": {},
                    "requires_subtypes": None,
                }

        # Members
        with members_csv.open("r", encoding="utf-8") as fh:
            reader = csv.DictReader(_non_comment_lines(fh))
            for row in reader:
                key = (row.get("group_key") or "").strip()
                atc = (row.get("atc_code") or "").strip()
                if not key or not atc:
                    continue
                entry = self.endpoint_groups.get(key)
                if entry is None:
                    logger.debug(
                        "duplicate_detector: endpoint member references "
                        "unknown group_key=%r (atc=%s)",
                        key,
                        atc,
                    )
                    continue
                entry["members_by_atc"][atc] = {
                    "ingredient": (
                        (row.get("active_ingredient") or "").strip() or None
                    ),
                    "subtype": (
                        (row.get("member_subtype") or "").strip() or None
                    ),
                }

    def _apply_subtype_coverage_requirements(self) -> None:
        """Tag groups whose ATC hits must span multiple subtypes (B 類).

        Today only ``nephrotoxic_triple_whammy`` is subtype-coverage: hit is
        valid only if ≥ 1 NSAID + ≥ 1 RAAS + ≥ 1 diuretic member coexist.
        Kept hard-coded (per task spec) rather than derived from CSV so the
        requirement is explicit and code-review visible.
        """
        for group_key, required in _SUBTYPE_COVERAGE_GROUPS.items():
            entry = self.endpoint_groups.get(group_key)
            if entry is None:
                continue
            entry["requires_subtypes"] = set(required)
