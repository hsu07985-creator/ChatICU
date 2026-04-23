"""Duplicate medication detection service (L1/L2 + auto-downgrade + overrides).

Central Single Source of Truth per docs/duplicate-medication-integration-plan.md §2.
Consumed by the REST API, AI clinical snapshot builder, and the pre-computed
cache layer — all call DuplicateDetector(session).analyze(meds).

Wave 1 scope (this file):
  * L1 — same ATC L5 (7 chars) grouping              → critical
  * L2 — same ATC L4 prefix (5 chars)                → high
  * auto-downgrade rules (route / salt / overlap / PRN-vs-scheduled)
  * overrides (§3.1 upgrade  + §3.3 whitelist), wildcard-aware
  * fingerprint dedupe — same member set keeps highest level

Wave 2 (stubbed via _detect_l3 / _detect_l4 returning []):
  * L3 mechanism-group joins (drug_mechanism_groups / _members)
  * L4 endpoint-group joins  (drug_endpoint_groups  / _members)
  * Problem-list based adequacy downgrade

Input flexibility: analyze() accepts either ORM Medication objects or dicts
(matching the shape in backend/tests/fixtures/duplicate_cases.json). Both are
normalised into a uniform internal dict via _normalize_med().
"""
from __future__ import annotations

import csv
import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Literal, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public type aliases
# ---------------------------------------------------------------------------
Level = Literal["critical", "high", "moderate", "low", "info"]
Layer = Literal["L1", "L2", "L3", "L4"]
Context = Literal["inpatient", "outpatient", "icu", "discharge"]

_LEVEL_RANK: Dict[str, int] = {
    "critical": 5,
    "high": 4,
    "moderate": 3,
    "low": 2,
    "info": 1,
}

# Auto-downgrade reasons
_REASON_DIFF_ROUTE = "route_switch"
_REASON_DIFF_SALT = "salt_switch"
_REASON_OVERLAP_TRANSITION = "transitional_overlap_le_48h"
_REASON_PRN_SCHEDULED = "prn_plus_scheduled"

# Overlap window (hours) for transitional-bridging downgrade
_OVERLAP_WINDOW_HOURS = 48
# Minimum spread between last_admin_at values for a same-L5/same-route pair to
# be treated as a switching window (vs a concurrent duplicate order error).
# 12h-apart same-L5/same-route admin ⇒ duplicate order; ≥ 24h-apart ⇒ transition.
_TRANSITION_MIN_SPREAD_HOURS = 24
# Any med whose last_admin_at is older than this is treated as inactive
_ACTIVE_WINDOW_HOURS = 48

# Target levels for the PRN+scheduled downgrade (guide §2.3 / §6.3).
# High → Low (two steps) & Critical → Moderate per guide tables.
_PRN_DOWNGRADE_MAP: Dict[str, str] = {
    "critical": "moderate",
    "high": "low",
    "moderate": "low",
}

# Long-acting opioid / BZD L5 codes — exempted from PRN+scheduled downgrade
# (per guide §2.3 footnote: "非長效 BZD／Opioid 才降")
_LONG_ACTING_OPIOID_BZD_ATC = {
    "N02AB03",  # Fentanyl (patch is long-acting; bolus IV may differ but we
                # err on the cautious side — don't auto-downgrade)
    "N02AE01",  # Buprenorphine
    "N07BC02",  # Methadone
    "N05BA01",  # Diazepam (long-acting BZD)
    "N05BA09",  # Clobazam
    "N03AE01",  # Clonazepam
}

# ---------------------------------------------------------------------------
# Recommendation mapping — mechanism / group_key → clinician-facing sentence
# ---------------------------------------------------------------------------
_RECOMMENDATIONS: Dict[str, str] = {
    # §3.1 Critical — absolute duplicates
    "PPI × PPI": (
        "停用其中一 PPI；若為換藥過渡期，overlap ≤ 48h 後應停單方。"
    ),
    "SSRI × SSRI": (
        "血清素症候群風險；換藥需 cross-taper 4–7 天，避免同時併用。"
    ),
    "NSAID × NSAID": (
        "口服 NSAID 併用無加成止痛；GI 出血／AKI／CV 風險倍增，保留一品即可。"
    ),
    "ACEI × ARB": (
        "KDIGO 2024 任何情境皆不建議；高鉀／AKI 風險顯著，停一品。"
    ),
    "Statin × Statin": (
        "HMG-CoA reductase 抑制無加成 LDL 降幅；肌病／橫紋肌溶解風險，停一品。"
    ),
    "Oral anticoagulant × Oral anticoagulant": (
        "致命性出血；橋接換藥需依指引（Warfarin→DOAC 需 INR-gated）。"
    ),
    "Long-acting BZD × Long-acting BZD": (
        "呼吸抑制、跌倒、譫妄；Beers 2023 老人全面避免 BZD，若非短期明確必要應停一。"
    ),
    "Metformin mono + Metformin combo": (
        "開立複方時必須停 Metformin 單方；max 2,000–2,550 mg/d。"
    ),
    "β-blocker × β-blocker": (
        "心搏過緩、AV block、HF 惡化；換藥需 taper 後才停單方。"
    ),
    "α1-blocker × α1-blocker": (
        "直立性低血壓、暈厥（AUA／EAU 不建議併用），停一品。"
    ),
    "DHP CCB × DHP CCB": (
        "反射性心搏過速、水腫；同為 DHP 無加成降壓，停一品。"
    ),
    "5-HT3 × 5-HT3": (
        "QTc 延長疊加且無加成止吐效益，停一品。"
    ),
    "D2 antagonist × D2 antagonist": (
        "EPS／tardive dyskinesia／NMS 與 QTc 疊加，保留單一足夠。"
    ),
    # §3.4 mechanism groups (L3)
    "alpha1_blocker": (
        "同 α1 阻斷疊加（BPH + HTN），直立性低血壓、暈厥；保留單一或改 class。"
    ),
    "serotonergic": (
        "多重促血清素機轉疊加，血清素症候群風險；避免同時併用或 cross-taper。"
    ),
    "qtc_prolonging": (
        "多重 QTc 延長藥疊加，建議 ECG 監測、校正 K／Mg，減少同時使用品項。"
    ),
    "anticholinergic_burden": (
        "抗膽鹼負荷累加（Beers 2023）；評估認知／譫妄／尿滯留風險，精簡處方。"
    ),
    "cns_depressant": (
        "BZD + Opioid + ... 疊加致呼吸抑制（FDA Boxed Warning），應減量或停一。"
    ),
    "d2_antagonist_antiemetic": (
        "雙 D2 止吐 EPS／NMS／QTc 疊加且無加成，保留單一 agent。"
    ),
    "promotility": (
        "雙 promotility 腹瀉／QTc 疊加，評估單一保留。"
    ),
    # §3.4 endpoint groups (L4)
    "raas_blockade": (
        "多重 RAAS 阻斷（ACEI/ARB/ARNI/DRI/MRA）高鉀／AKI；KDIGO 2024 不建議。"
    ),
    "bleeding_risk": (
        "多重出血風險疊加，必要時考慮 PPI 胃保護並審視是否可停 NSAID／SSRI。"
    ),
    "hyperkalemia": (
        "多來源升 K（RAAS/MRA/TMP-SMX/CNI/Heparin/K）需 Q6–12h 監測鉀、調整劑量。"
    ),
    "nephrotoxic_triple_whammy": (
        "NSAID + RAAS + 利尿劑 三重腎毒，建議避免併用或暫停 NSAID／調整 RAAS 與利尿劑。"
    ),
    "qtc_stacking": (
        "QT 間期疊加；同 qtc_prolonging 建議。"
    ),
}

_GENERIC_REC_FALLBACK = (
    "建議審視是否有加成療效與客觀適應症；若無，保留單一藥品並記錄原因。"
)


# ---------------------------------------------------------------------------
# Dataclasses (public contract — see integration-plan §2.2)
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# DuplicateDetector
# ---------------------------------------------------------------------------
class DuplicateDetector:
    """Pure-function detector — reads seed tables, emits alerts, writes nothing.

    Usage:
        detector = DuplicateDetector(session)
        alerts = await detector.analyze(meds, context="inpatient")
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self._overrides_loaded = False
        self._upgrade_rules: List[_UpgradeRule] = []
        self._whitelist_rules: List[_WhitelistRule] = []

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------
    async def analyze(
        self,
        medications: List[Any],
        *,
        context: Context = "inpatient",
        reference_time: Optional[datetime] = None,
    ) -> List[DuplicateAlert]:
        """Analyse a medication list and return duplicate alerts.

        Args:
            medications: list of ORM Medication objects OR dicts with keys
                matching the fixture schema (medication_id, generic_name,
                atc_code, route, is_prn, last_admin_at).
            context: clinical setting, enables context-specific rules
                (ICU hot-spots are Phase 2; L3/L4 are Phase 2).
            reference_time: optional "as of" timestamp used for overlap /
                activity windows; defaults to now(UTC).

        Returns:
            List of DuplicateAlert sorted by descending severity.
        """
        if not medications or len(medications) < 2:
            return []

        ref_time = reference_time or datetime.now(timezone.utc)

        # 1. Normalise inputs and filter out items that are plainly inactive
        #    (last_admin_at older than _ACTIVE_WINDOW_HOURS from ref_time).
        normalised: List[dict] = []
        for m in medications:
            try:
                nm = _normalize_med(m)
            except Exception:  # pragma: no cover - defensive
                logger.debug("duplicate_detector: skip unparseable med %r", m)
                continue
            if _is_inactive(nm, ref_time):
                continue
            normalised.append(nm)

        if len(normalised) < 2:
            return []

        await self._load_overrides()

        # 2. Detection layers (L1/L2 wired; L3/L4 stubbed for Phase 2)
        alerts: List[DuplicateAlert] = []
        alerts.extend(self._detect_l1(normalised))
        alerts.extend(self._detect_l2(normalised))
        alerts.extend(await self._detect_l3(normalised))
        alerts.extend(await self._detect_l4(normalised))

        # 2b. Synthesise alerts for upgrade-rule matches that do not share an
        # L4 prefix (e.g. Diazepam N05BA01 + Clonazepam N03AE01 — both long-
        # acting BZDs but different L4). Without this pass those cross-class
        # pairs slip past L1/L2 entirely; a proper L3 mechanism-group detector
        # will supersede this in Phase 2.
        alerts.extend(self._detect_upgrade_rule_pairs(normalised, alerts))

        # 3. Rule engine passes
        alerts = self._apply_overrides(alerts)      # upgrade + whitelist removal
        alerts = self._apply_downgrades(alerts, ref_time)
        alerts = self._dedupe(alerts)

        alerts.sort(key=lambda a: _LEVEL_RANK.get(a.level, 0), reverse=True)
        return alerts

    # ------------------------------------------------------------------
    # L1 — same ATC L5 (full 7-char code)
    # ------------------------------------------------------------------
    def _detect_l1(self, meds: List[dict]) -> List[DuplicateAlert]:
        groups: Dict[str, List[dict]] = {}
        for m in meds:
            atc = m.get("atc_code")
            if not _is_valid_atc(atc, min_len=7):
                continue
            groups.setdefault(atc, []).append(m)

        alerts: List[DuplicateAlert] = []
        for atc, members in groups.items():
            if len(members) < 2:
                continue
            mech = self._mechanism_label_from_members(members, atc_prefix=atc, layer="L1")
            alerts.append(
                self._build_alert(
                    members=members,
                    level="critical",
                    layer="L1",
                    mechanism=mech,
                    recommendation=_RECOMMENDATIONS.get(mech, _GENERIC_REC_FALLBACK),
                    evidence_url=None,
                )
            )
        return alerts

    # ------------------------------------------------------------------
    # L2 — same ATC L4 prefix (5 chars) but L5 differs
    # ------------------------------------------------------------------
    def _detect_l2(self, meds: List[dict]) -> List[DuplicateAlert]:
        groups: Dict[str, List[dict]] = {}
        for m in meds:
            atc = m.get("atc_code")
            if not _is_valid_atc(atc, min_len=5):
                continue
            groups.setdefault(atc[:5], []).append(m)

        alerts: List[DuplicateAlert] = []
        for prefix, members in groups.items():
            if len(members) < 2:
                continue
            # Exclude groups where all members share the identical L5 — those
            # are already covered by L1. Require at least two distinct L5s.
            l5s = {m.get("atc_code") for m in members if m.get("atc_code")}
            if len(l5s) < 2:
                continue
            mech = self._mechanism_label_for_l4(prefix)
            alerts.append(
                self._build_alert(
                    members=members,
                    level="high",
                    layer="L2",
                    mechanism=mech,
                    recommendation=_RECOMMENDATIONS.get(mech, _GENERIC_REC_FALLBACK),
                    evidence_url=None,
                )
            )
        return alerts

    # ------------------------------------------------------------------
    # L3 / L4 — Phase 2 (stubbed but async-signature preserved)
    # ------------------------------------------------------------------
    async def _detect_l3(self, meds: List[dict]) -> List[DuplicateAlert]:
        """Mechanism-group (L3) detection — Phase 2."""
        return []

    async def _detect_l4(self, meds: List[dict]) -> List[DuplicateAlert]:
        """Endpoint-group (L4) detection — Phase 2."""
        return []

    # ------------------------------------------------------------------
    # Upgrade-rule cross-class pair matching (narrow shim until L3 lands)
    # ------------------------------------------------------------------
    def _detect_upgrade_rule_pairs(
        self,
        meds: List[dict],
        existing_alerts: List[DuplicateAlert],
    ) -> List[DuplicateAlert]:
        """Emit alerts for §3.1 upgrade-rule pairs not caught by L1/L2.

        The L1 / L2 detectors group on ATC L5 / L4; some §3.1 upgrade rules
        intentionally span classes (e.g. long-acting BZDs N05BA × N03AE, or
        ACEI × ARB across C09AA / C09CA). For those pairs neither L1 nor L2
        fires, leaving _apply_overrides no alert to upgrade. This helper does
        a pair-wise scan of the upgrade rule table and synthesises alerts
        only for pairs no existing alert already covers.

        Returns only the newly-created alerts (caller extends the main list).

        Phase 2 note: a proper L3 mechanism-group detector (seed tables
        drug_mechanism_groups / _members) will subsume this shim.
        """
        if not self._upgrade_rules:
            return []

        # Track (medication_id_A, medication_id_B) pairs already present in
        # any existing alert's member set so we do not double-emit.
        covered_pairs: set = set()
        for alert in existing_alerts:
            ids = sorted(m.medication_id for m in alert.members if m.medication_id)
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    covered_pairs.add((ids[i], ids[j]))

        new_alerts: List[DuplicateAlert] = []
        emitted_pairs: set = set()
        for i in range(len(meds)):
            for j in range(i + 1, len(meds)):
                a, b = meds[i], meds[j]
                atc_a, atc_b = a.get("atc_code"), b.get("atc_code")
                if not atc_a or not atc_b:
                    continue
                # Skip pairs already captured by L1 (same L5) / L2 (same L4);
                # _apply_overrides will handle those via severity upgrade.
                if atc_a == atc_b or atc_a[:5] == atc_b[:5]:
                    continue

                # Look for a matching upgrade rule
                matched = None
                for rule in self._upgrade_rules:
                    if _pair_matches(atc_a, atc_b, rule.pattern_1, rule.pattern_2):
                        matched = rule
                        break
                if matched is None:
                    continue

                pair_key = tuple(
                    sorted(
                        (
                            str(a.get("medication_id") or ""),
                            str(b.get("medication_id") or ""),
                        )
                    )
                )
                if pair_key in covered_pairs or pair_key in emitted_pairs:
                    continue
                emitted_pairs.add(pair_key)

                # Derive a reasonable mechanism label from member names.
                names = sorted(
                    {
                        _strip_salt_suffix((x.get("generic_name") or "").strip())
                        for x in (a, b)
                        if x.get("generic_name")
                    }
                )
                mechanism = (
                    " × ".join(names) if names else f"ATC {atc_a} × {atc_b}"
                )
                new_alerts.append(
                    self._build_alert(
                        members=[a, b],
                        # Tag as L2: curated §3.1 upgrade rules express an
                        # explicit (ATC pair → mechanism) equivalence, so the
                        # match carries at least L2 specificity (same
                        # mechanism class), even when the two ATCs don't share
                        # an L4 prefix (e.g. N05BA × N03AE long-acting BZDs).
                        # _apply_overrides will lift level to the rule's
                        # declared severity (typically Critical).
                        level="high",
                        layer="L2",
                        mechanism=mechanism,
                        recommendation=_RECOMMENDATIONS.get(
                            mechanism, _GENERIC_REC_FALLBACK
                        ),
                        evidence_url=matched.evidence_url,
                    )
                )
        return new_alerts

    # ------------------------------------------------------------------
    # Override / downgrade / dedupe passes
    # ------------------------------------------------------------------
    def _apply_overrides(self, alerts: List[DuplicateAlert]) -> List[DuplicateAlert]:
        """Apply §3.1 upgrade rules and §3.3 whitelist rules.

        - Any alert whose member pair matches a whitelist rule is removed.
        - Any alert whose member pair matches an upgrade rule is lifted to
          the declared severity (only if higher than current level).
        """
        if not self._upgrade_rules and not self._whitelist_rules:
            return alerts

        kept: List[DuplicateAlert] = []
        for alert in alerts:
            atcs = [m.atc_code for m in alert.members if m.atc_code]
            if not atcs:
                kept.append(alert)
                continue

            # Whitelist → drop
            if self._any_pair_matches(atcs, self._whitelist_rules):
                logger.debug(
                    "duplicate_detector: whitelist suppresses alert %s",
                    alert.fingerprint,
                )
                continue

            # Upgrade → lift level if higher
            upgraded = self._find_upgrade(atcs)
            if upgraded is not None:
                new_level, reason, ev = upgraded
                if _LEVEL_RANK.get(new_level, 0) > _LEVEL_RANK.get(alert.level, 0):
                    alert.level = new_level  # type: ignore[assignment]
                    # Keep the original mechanism text but attach evidence
                    if ev and not alert.evidence_url:
                        alert.evidence_url = ev
                    # Reset auto_downgraded if we just upgraded
                    alert.auto_downgraded = False
                    alert.downgrade_reason = None
            kept.append(alert)
        return kept

    def _apply_downgrades(
        self, alerts: List[DuplicateAlert], ref_time: datetime
    ) -> List[DuplicateAlert]:
        """Auto-downgrade per §2.3 / §6.3:

        * Same L5 + different route                     Critical → Moderate
        * Same L5 + different salt (suffix diff)         Critical → High
        * Overlap ≤ 48h (last_admin_at delta)            Critical → Moderate
        * PRN + scheduled (non long-acting BZD/opioid)   level - 1
        """
        for alert in alerts:
            if len(alert.members) < 2:
                continue

            # Route split
            routes = {
                (m.route or "").strip().lower()
                for m in alert.members
                if (m.route or "").strip()
            }
            # Same-L5 alerts have unique L5 per member; build set of L5 codes
            l5_set = {m.atc_code for m in alert.members if m.atc_code}
            same_l5 = len(l5_set) == 1 and next(iter(l5_set)) is not None

            # PRN / scheduled mix
            prns = [m.is_prn for m in alert.members]
            has_prn = any(prns)
            has_scheduled = any(not p for p in prns)

            # -------- Same-L5 path ----------
            if same_l5:
                # Salt-form split first: same L5, different ingredient suffix
                # (heuristic string compare on generic_name). This takes
                # priority over route-switch when both apply — a salt change
                # is a more substantive chemical / pharmacokinetic distinction
                # than a route change alone (e.g. Esomeprazole magnesium PO →
                # Esomeprazole sodium IV should surface as High, not Moderate).
                if _salt_differs(alert.members) and alert.level == "critical":
                    self._mark_downgrade(alert, "high", _REASON_DIFF_SALT)
                    continue

                # Route-switch downgrade: Critical → Moderate
                if len(routes) > 1 and alert.level == "critical":
                    self._mark_downgrade(alert, "moderate", _REASON_DIFF_ROUTE)
                    continue

                # Transitional overlap (guide §2.3 / §6.3):
                # Two same-L5 / same-route / same-salt administrations whose
                # last_admin_at values span ≥ _TRANSITION_MIN_SPREAD_HOURS and
                # ≤ _OVERLAP_WINDOW_HOURS are treated as a switching window
                # (one dose late on day N, one early on day N+1) → Moderate.
                #
                # A spread < _TRANSITION_MIN_SPREAD_HOURS is considered
                # concurrent dosing — i.e. a duplicate order / reconciliation
                # error — and stays Critical.
                #
                # An explicit switch signal (end_date / status=discontinued,
                # Phase 3) also qualifies regardless of spread.
                if (
                    _overlap_within(alert.members, _OVERLAP_WINDOW_HOURS)
                    and alert.level == "critical"
                ):
                    spread_transitional = _spread_at_least(
                        alert.members, _TRANSITION_MIN_SPREAD_HOURS
                    )
                    has_switch_signal = (
                        spread_transitional
                        or _any_member_discontinued(alert.members, ref_time)
                    )
                    if has_switch_signal:
                        self._mark_downgrade(
                            alert, "moderate", _REASON_OVERLAP_TRANSITION
                        )
                        continue
                    # else: admins are too tight together to be a transition —
                    # this looks like a duplicate order error; keep Critical.

            # -------- PRN + scheduled (any layer) -------
            # Guide §2.3 / §6.3: "一方為 PRN + 另一方為排程（且非同為長效
            # opioid/BZD）" — High → Low (two steps), Critical → Moderate.
            if has_prn and has_scheduled:
                # Exclude if any member is long-acting opioid / BZD
                member_atcs = {m.atc_code for m in alert.members if m.atc_code}
                long_acting_present = bool(
                    member_atcs & _LONG_ACTING_OPIOID_BZD_ATC
                )
                if not long_acting_present:
                    target = _PRN_DOWNGRADE_MAP.get(alert.level)
                    if target is not None:
                        self._mark_downgrade(alert, target, _REASON_PRN_SCHEDULED)

        return alerts

    def _dedupe(self, alerts: List[DuplicateAlert]) -> List[DuplicateAlert]:
        """Keep only the highest-severity alert per unique fingerprint."""
        best: Dict[str, DuplicateAlert] = {}
        for a in alerts:
            prev = best.get(a.fingerprint)
            if prev is None or _LEVEL_RANK.get(a.level, 0) > _LEVEL_RANK.get(prev.level, 0):
                best[a.fingerprint] = a
        return list(best.values())

    # ------------------------------------------------------------------
    # Override loading (lazy; DB first, CSV fallback)
    # ------------------------------------------------------------------
    async def _load_overrides(self) -> None:
        if self._overrides_loaded:
            return
        self._overrides_loaded = True  # set early to avoid repeated retries on failure
        try:
            await self._load_overrides_from_db()
            if self._upgrade_rules or self._whitelist_rules:
                return
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("duplicate_detector: override DB load failed: %s", exc)

        # Fallback: load CSV directly (handy for tests / missing migration)
        try:
            self._load_overrides_from_csv()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("duplicate_detector: override CSV load failed: %s", exc)

    async def _load_overrides_from_db(self) -> None:
        row_iter: Iterable[Tuple[str, str, str, Optional[str], Optional[str], Optional[str]]]
        try:
            result = await self.session.execute(
                text(
                    "SELECT rule_type, atc_code_1, atc_code_2, severity_override, "
                    "reason, evidence_url FROM duplicate_rule_overrides"
                )
            )
        except Exception as exc:
            # Table may not yet exist — caller will fall back to CSV
            raise exc
        row_iter = result.all()

        for rule_type, a1, a2, sev, reason, ev in row_iter:
            self._ingest_override_row(rule_type, a1, a2, sev, reason, ev)

    def _load_overrides_from_csv(self) -> None:
        csv_path = (
            Path(__file__).resolve().parent.parent
            / "fhir"
            / "code_maps"
            / "duplicate_rule_overrides.csv"
        )
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
            self._upgrade_rules.append(
                _UpgradeRule(
                    pattern_1=atc1,
                    pattern_2=atc2,
                    severity=(sev or "critical").lower(),
                    reason=reason or "",
                    evidence_url=evidence_url,
                )
            )
        elif rt == "whitelist":
            self._whitelist_rules.append(
                _WhitelistRule(
                    pattern_1=atc1, pattern_2=atc2, reason=reason or ""
                )
            )

    # ------------------------------------------------------------------
    # Override helpers
    # ------------------------------------------------------------------
    def _any_pair_matches(
        self, atcs: List[str], rules: List[Any]
    ) -> bool:
        """Return True if any unordered ATC pair matches any rule pattern-pair."""
        for i in range(len(atcs)):
            for j in range(i + 1, len(atcs)):
                a, b = atcs[i], atcs[j]
                for rule in rules:
                    if _pair_matches(a, b, rule.pattern_1, rule.pattern_2):
                        return True
        return False

    def _find_upgrade(
        self, atcs: List[str]
    ) -> Optional[Tuple[str, str, Optional[str]]]:
        """Find first upgrade rule whose pattern matches any unordered ATC pair."""
        for i in range(len(atcs)):
            for j in range(i + 1, len(atcs)):
                a, b = atcs[i], atcs[j]
                for rule in self._upgrade_rules:
                    if _pair_matches(a, b, rule.pattern_1, rule.pattern_2):
                        return rule.severity, rule.reason, rule.evidence_url
        return None

    # ------------------------------------------------------------------
    # Level / mechanism helpers
    # ------------------------------------------------------------------
    def _mechanism_label_from_members(
        self, members: List[dict], *, atc_prefix: str, layer: str
    ) -> str:
        names = {(m.get("generic_name") or "?").strip() for m in members}
        names = {_strip_salt_suffix(n) for n in names if n}
        if len(names) == 1:
            single = next(iter(names))
            return f"{single} × {single} (identical ATC {atc_prefix})"
        joined = " + ".join(sorted(names))
        return f"ATC {atc_prefix} duplication ({joined})"

    def _mechanism_label_for_l4(self, prefix: str) -> str:
        """Return a human mechanism label for a 5-char ATC L4 group.

        L2 detector path — no DB lookup yet (Phase 2 can join ATC dictionary).
        Uses well-known L4 codes from guide §3.1 as convenience labels.
        """
        label = _ATC_L4_LABELS.get(prefix)
        if label:
            return label
        return f"ATC {prefix} duplication"

    def _build_alert(
        self,
        *,
        members: List[dict],
        level: str,
        layer: str,
        mechanism: str,
        recommendation: str,
        evidence_url: Optional[str],
    ) -> DuplicateAlert:
        dup_members = [_to_duplicate_member(m) for m in members]
        return DuplicateAlert(
            fingerprint=_make_fingerprint(dup_members),
            level=level,  # type: ignore[arg-type]
            layer=layer,  # type: ignore[arg-type]
            mechanism=mechanism,
            members=dup_members,
            recommendation=recommendation,
            evidence_url=evidence_url,
            auto_downgraded=False,
            downgrade_reason=None,
        )

    def _mark_downgrade(
        self, alert: DuplicateAlert, new_level: str, reason: str
    ) -> None:
        if _LEVEL_RANK.get(new_level, 0) >= _LEVEL_RANK.get(alert.level, 0):
            return  # never upgrade via the downgrade path
        alert.level = new_level  # type: ignore[assignment]
        alert.auto_downgraded = True
        alert.downgrade_reason = reason


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------
# Well-known L4 prefixes → human mechanism label used by L2 detector.
# These align with §3.1 of the guide; unknown prefixes fall through to a
# generic "ATC XYZAB duplication" label so the detector still works on
# previously-unseen drug classes.
_ATC_L4_LABELS: Dict[str, str] = {
    "A02BC": "PPI × PPI",
    "A04AA": "5-HT3 × 5-HT3",
    "M01AE": "NSAID × NSAID",
    "M01AB": "NSAID × NSAID",
    "M01AC": "NSAID × NSAID",
    "M01AH": "NSAID × NSAID",
    "N06AB": "SSRI × SSRI",
    "C07AB": "β-blocker × β-blocker",
    "C08CA": "DHP CCB × DHP CCB",
    "C10AA": "Statin × Statin",
    "N05BA": "Long-acting BZD × Long-acting BZD",
    "N02AA": "Oral opioid × Oral opioid",
    "N02AB": "Opioid × Opioid",
    "B01AF": "Oral anticoagulant × Oral anticoagulant",
    "B01AA": "Oral anticoagulant × Oral anticoagulant",
    "C09AA": "ACEI × ACEI",
    "C09CA": "ARB × ARB",
    "C03DA": "MRA × MRA",
    "C03CA": "Loop diuretic × Loop diuretic",
    "J01DD": "Cephalosporin × Cephalosporin",
    "J01DB": "Cephalosporin × Cephalosporin",
    "J01FA": "Macrolide × Macrolide",
    "J01MA": "Fluoroquinolone × Fluoroquinolone",
    "A10BA": "Metformin × Metformin",
    "R06AA": "H1 antihistamine × H1 antihistamine",
}


def _normalize_med(m: Any) -> dict:
    """Normalise an ORM Medication or fixture dict into a uniform dict.

    Supported source shapes:
      * ORM ``Medication`` — uses .id / .generic_name / .atc_code / .route /
        .prn; last_admin_at falls back to .end_date or .updated_at.
      * dict — either ORM-style keys or fixture-style keys (medication_id,
        generic_name, atc_code, route, is_prn, last_admin_at).
    """
    if m is None:
        raise ValueError("medication is None")

    if isinstance(m, dict):
        med_id = m.get("medication_id") or m.get("id")
        generic = m.get("generic_name") or m.get("genericName") or m.get("name") or ""
        atc = m.get("atc_code") or m.get("atcCode")
        route = m.get("route")
        is_prn = bool(m.get("is_prn", m.get("prn", False)))
        last_admin = m.get("last_admin_at") or m.get("lastAdminAt")
    else:
        med_id = getattr(m, "id", None)
        generic = (
            getattr(m, "generic_name", None)
            or getattr(m, "name", None)
            or ""
        )
        atc = getattr(m, "atc_code", None)
        route = getattr(m, "route", None)
        is_prn = bool(getattr(m, "prn", False))
        # ORM Medication has no explicit last_admin_at; use updated_at as
        # coarse proxy when available (HIS feeds drive updated_at).
        last_admin = (
            getattr(m, "last_admin_at", None)
            or getattr(m, "updated_at", None)
        )

    return {
        "medication_id": str(med_id) if med_id is not None else "",
        "generic_name": (generic or "").strip(),
        "atc_code": (atc or "").strip() or None if atc else None,
        "route": (route or "").strip() or None if route else None,
        "is_prn": is_prn,
        "last_admin_at": _coerce_datetime(last_admin),
    }


def _coerce_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            v = value.replace("Z", "+00:00")
            dt = datetime.fromisoformat(v)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _is_inactive(m: dict, ref_time: datetime) -> bool:
    """Treat a medication as inactive when its last_admin_at is > 48h old."""
    last = m.get("last_admin_at")
    if last is None:
        # No admin timestamp — keep the med; we cannot prove it is inactive.
        return False
    try:
        delta = ref_time - last
    except TypeError:
        return False
    return delta > timedelta(hours=_ACTIVE_WINDOW_HOURS)


def _is_valid_atc(atc: Optional[str], *, min_len: int) -> bool:
    if not atc:
        return False
    s = atc.strip()
    return len(s) >= min_len


def _to_duplicate_member(m: dict) -> DuplicateMember:
    return DuplicateMember(
        medication_id=m["medication_id"],
        generic_name=m["generic_name"],
        atc_code=m.get("atc_code"),
        route=m.get("route"),
        is_prn=bool(m.get("is_prn")),
        last_admin_at=m.get("last_admin_at"),
    )


def _make_fingerprint(members: List[DuplicateMember]) -> str:
    """SHA-256(sorted medication_ids)[:16] — deterministic per member set."""
    ids = sorted((m.medication_id or "") for m in members)
    joined = "|".join(ids)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def _atc_match(atc: str, pattern: str) -> bool:
    """ATC wildcard matcher.

    - ``pattern`` ending in ``*`` → prefix match (e.g. ``A02BC*``).
    - otherwise exact-string match.
    """
    if not atc or not pattern:
        return False
    if pattern.endswith("*"):
        return atc.startswith(pattern[:-1])
    return atc == pattern


def _pair_matches(a: str, b: str, pat1: str, pat2: str) -> bool:
    """Unordered pair match against (pat1, pat2)."""
    return (
        (_atc_match(a, pat1) and _atc_match(b, pat2))
        or (_atc_match(a, pat2) and _atc_match(b, pat1))
    )


def _strip_salt_suffix(name: str) -> str:
    """Best-effort ingredient salt stripping for display.

    Handles common salts: sodium, potassium, magnesium, calcium, hydrochloride,
    sulfate, tartrate, maleate, mesylate, phosphate, succinate, fumarate.
    """
    if not name:
        return name
    lowered = name.lower()
    for suffix in _SALT_SUFFIXES:
        if lowered.endswith(" " + suffix):
            return name[: -(len(suffix) + 1)].strip()
    return name.strip()


def _salt_differs(members: List[DuplicateMember]) -> bool:
    """Detect salt-form switch heuristically: same stripped ingredient,
    different raw generic_name tail."""
    raws = {(m.generic_name or "").strip().lower() for m in members}
    stripped = {_strip_salt_suffix((m.generic_name or "").strip()).lower() for m in members}
    return len(raws) > 1 and len(stripped) == 1


def _overlap_within(members: List[DuplicateMember], hours: int) -> bool:
    """True if the spread of last_admin_at values across members ≤ `hours`."""
    times = [m.last_admin_at for m in members if m.last_admin_at]
    if len(times) < 2:
        return False
    try:
        spread = max(times) - min(times)
    except TypeError:
        return False
    return spread <= timedelta(hours=hours)


def _spread_at_least(members: List[DuplicateMember], hours: int) -> bool:
    """True if the spread of last_admin_at values across members ≥ `hours`."""
    times = [m.last_admin_at for m in members if m.last_admin_at]
    if len(times) < 2:
        return False
    try:
        spread = max(times) - min(times)
    except TypeError:
        return False
    return spread >= timedelta(hours=hours)


def _any_member_discontinued(
    members: List[DuplicateMember], ref_time: datetime
) -> bool:
    """True if any member has an explicit discontinuation signal.

    Today DuplicateMember only carries a coarse ``last_admin_at`` proxy and does
    not surface ``status`` / ``end_date`` from the source Medication row; we
    deliberately return False rather than inferring "stale last_admin_at ≈
    stopped", because Phase 3 will plumb the real administrations table and we
    don't want to silently downgrade duplicates based on a proxy that may be
    weeks out of date for chronic meds.

    TODO(Phase 3): extend DuplicateMember + _normalize_med to carry
    ``end_date`` and ``status`` (e.g. "active" / "discontinued" / "held"), then
    return True when any member is explicitly discontinued before ref_time.
    """
    _ = (members, ref_time)  # reserved for Phase 3
    return False


# Known salt suffixes used by _strip_salt_suffix (kept module-level for
# cheap look-ups inside hot loops).
_SALT_SUFFIXES: Tuple[str, ...] = (
    "sodium",
    "potassium",
    "magnesium",
    "calcium",
    "hydrochloride",
    "hcl",
    "sulfate",
    "sulphate",
    "tartrate",
    "maleate",
    "mesylate",
    "besylate",
    "tosylate",
    "phosphate",
    "succinate",
    "fumarate",
    "citrate",
    "acetate",
    "bitartrate",
    "hydrobromide",
)
