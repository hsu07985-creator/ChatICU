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
from typing import Any, Callable, Dict, Iterable, List, Literal, Optional, Set, Tuple

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
        "同 α1 阻斷疊加（BPH + HTN），直立性低血壓、暈厥與跌倒風險；"
        "評估是否有加成療效，保留單一或改 class。"
    ),
    "serotonergic": (
        "多重促血清素機轉疊加，血清素症候群風險"
        "（高體溫、自主神經異常、肌陣攣、clonus）；立即評估停一藥或 cross-taper。"
    ),
    "qtc_prolonging": (
        "多重 QTc 延長藥疊加、Torsades de Pointes 風險；"
        "查 QTc baseline、校正 K／Mg，減少同時使用品項並 ECG 監測。"
    ),
    "anticholinergic_burden": (
        "抗膽鹼負荷累加（Beers 2023）；譫妄、認知惡化、尿滯留、便秘；"
        "老年族群尤應減量或停用。"
    ),
    "cns_depressant": (
        "BZD + Opioid + Z-drug + Gabapentinoid + 一代抗組織胺 疊加致呼吸抑制、"
        "鎮靜過深、跌倒（FDA Boxed Warning），應減量或停一。"
    ),
    "d2_antagonist_antiemetic": (
        "雙 D2 止吐 EPS／tardive dyskinesia／NMS 與 QTc 延長疊加且無加成，"
        "保留單一 agent。"
    ),
    "promotility": (
        "雙 promotility 疊加（膽鹼／D2／motilin）腹瀉、QTc 延長與心搏過緩，"
        "評估單一保留。"
    ),
    # §3.4 endpoint groups (L4)
    "raas_blockade": (
        "高血鉀、AKI、低血壓疊加（ONTARGET 2008、VA-NEPHRON-D 2013）；"
        "KDIGO 2024 任何組合皆不建議。"
    ),
    "bleeding_risk": (
        "GI 出血風險倍增；評估抗潰瘍保護或減藥。"
    ),
    "hyperkalemia": (
        "監測 K、停一藥或減劑；老年／CKD 尤其注意。"
    ),
    "nephrotoxic_triple_whammy": (
        "急性腎損傷高風險（NSAID + RAAS + 利尿劑）；立即評估停 NSAID 或利尿劑。"
    ),
    "qtc_stacking": (
        "QT 間期疊加；同 qtc_prolonging 建議（ECG 監測、校正 K/Mg）。"
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
        # L3 mechanism groups (lazy-loaded). Shape:
        # {group_key: {"zh": str, "en": str, "severity": str, "members": set[str]}}
        self._mechanism_groups_loaded = False
        self._mechanism_groups: Dict[str, Dict[str, Any]] = {}
        # L4 endpoint groups (lazy-loaded). Shape:
        # {group_key: {"zh": str, "en": str, "severity": str,
        #              "members_by_atc": dict[str, {ingredient, subtype}],
        #              "requires_subtypes": Optional[set[str]]}}
        self._endpoint_groups_loaded = False
        self._endpoint_groups: Dict[str, Dict[str, Any]] = {}

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

        # 2. Detection layers (L1/L2/L3/L4 all wired)
        alerts: List[DuplicateAlert] = []
        alerts.extend(self._detect_l1(normalised))
        alerts.extend(self._detect_l2(normalised))
        alerts.extend(await self._detect_l3(normalised, alerts))

        # 2b. Synthesise alerts for upgrade-rule matches that do not share an
        # L4 prefix (e.g. Diazepam N05BA01 + Clonazepam N03AE01 — both long-
        # acting BZDs but different L4, or ACEI×ARB spanning C09AA / C09CA).
        # Run BEFORE L4 so the upgrade-rule alert's fingerprint is visible to
        # _detect_l4's existing_alerts guard — prevents L4 raas_blockade from
        # emitting a lower-specificity duplicate for the same member set.
        alerts.extend(self._detect_upgrade_rule_pairs(normalised, alerts))

        alerts.extend(
            await self._detect_l4(
                normalised, context=context, existing_alerts=alerts
            )
        )

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
    # L3 — cross-class mechanism groups (§3.4)
    # ------------------------------------------------------------------
    async def _detect_l3(
        self,
        meds: List[dict],
        existing_alerts: Optional[List[DuplicateAlert]] = None,
    ) -> List[DuplicateAlert]:
        """Mechanism-group (L3) detection — §3.4 same-mechanism cross-class.

        For each mechanism group (alpha1_blocker, serotonergic, qtc_prolonging,
        anticholinergic_burden, cns_depressant, d2_antagonist_antiemetic,
        promotility) we find the medications whose ATC code is a declared
        member; if ≥ 2 members overlap we emit one L3 alert. Severity follows
        `_L3_STACKING_RULES` when present (stacking escalation, e.g. QTc triple
        → Critical) else the group's CSV-declared severity.

        Alerts whose (member fingerprint) already exists in ``existing_alerts``
        (usually L1/L2 hits for the same set) are suppressed — dedupe() keeps
        the highest-severity per fingerprint anyway but suppressing here keeps
        the alert list tighter.
        """
        await self._load_mechanism_groups()
        if not self._mechanism_groups:
            return []

        existing_fps: Set[str] = {
            a.fingerprint for a in (existing_alerts or [])
        }

        alerts: List[DuplicateAlert] = []
        for group_key, group in self._mechanism_groups.items():
            members_set: Set[str] = group.get("members") or set()
            if not members_set:
                continue
            hit_meds: List[dict] = [
                m for m in meds
                if m.get("atc_code") and m.get("atc_code") in members_set
            ]
            if len(hit_meds) < 2:
                continue

            # cns_depressant spans multiple sub-classes (BZD / opioid / Z-drug
            # / Gabapentinoid / H1 / phenothiazine). A same-sub-class hit
            # (e.g. Diazepam + Clonazepam — both BZD; or Fentanyl patch +
            # Morphine PRN — both opioids) is not "cross-mechanism CNS
            # stacking": it is either a same-class duplication already
            # covered by L2 / the §3.1 upgrade-rule pair pass, or a legitimate
            # long-acting + breakthrough pattern (§3.3 whitelist semantics).
            # Emitting an L3 cns_depressant alert here would shadow the more
            # specific L2 layer on dedupe and would mis-flag the breakthrough
            # pattern, so require ≥2 distinct sub-classes.
            if group_key == "cns_depressant":
                subclasses = {
                    _cns_subclass(m.get("atc_code")) for m in hit_meds
                }
                subclasses.discard(None)
                if len(subclasses) < 2:
                    continue

            level = _l3_stacking_level(group_key, group, hit_meds)
            mech_zh = group.get("zh") or group_key
            mech_en = group.get("en") or ""
            mechanism = (
                f"{mech_zh}（{mech_en}）" if mech_en else str(mech_zh)
            )
            alert = self._build_alert(
                members=hit_meds,
                level=level,
                layer="L3",
                mechanism=mechanism,
                recommendation=_RECOMMENDATIONS.get(
                    group_key, _GENERIC_REC_FALLBACK
                ),
                evidence_url=f"guide://§3.4/{group_key}",
            )
            if alert.fingerprint in existing_fps:
                # Same member set already flagged by L1/L2 — let that alert
                # carry through dedupe instead of emitting a duplicate row.
                continue
            alerts.append(alert)
        return alerts

    # ------------------------------------------------------------------
    # L4 — same therapeutic endpoint, cross-mechanism (§3.4)
    # ------------------------------------------------------------------
    async def _detect_l4(
        self,
        meds: List[dict],
        *,
        context: Optional[str] = None,
        existing_alerts: Optional[List[DuplicateAlert]] = None,
    ) -> List[DuplicateAlert]:
        """Endpoint-group (L4) detection — §3.4 same therapeutic endpoint.

        Two group shapes are supported:
          * **flat** (A 類) — any ≥ 2 member ATCs trigger (raas_blockade,
            bleeding_risk, hyperkalemia, qtc_stacking).
          * **subtype-coverage** (B 類) — requires ≥ 1 member from every
            declared subtype. `nephrotoxic_triple_whammy` needs nsaid + raas +
            diuretic simultaneously; any subtype missing silently skips the
            group.

        Severity follows ``_l4_level`` (see docstring there):
          * ``raas_blockade``               → critical
          * ``bleeding_risk``               → high (≥ 4 members → critical;
                                              ICU + ≥ 2 B01AB* → critical red-
                                              flag per §4.1)
          * ``hyperkalemia``                → high
          * ``nephrotoxic_triple_whammy``   → high (all 3 subtypes present
                                              is already severe — §3.4)
          * ``qtc_stacking``                → high (usually superseded by L3
                                              qtc_prolonging; dedupe via
                                              existing_alerts fingerprints)

        Bridging downgrade (guide §2.3) — narrow rule, not re-using the L1
        same-L5 path: a 2-member bleeding_risk hit comprising only B01AB*
        (heparin / LMWH) members with different routes and overlap ≤ 48h in
        non-ICU context is re-marked as moderate + ``transitional_overlap_le_48h``.
        """
        await self._load_endpoint_groups()
        if not self._endpoint_groups:
            return []

        existing_by_fp: Dict[str, DuplicateAlert] = {
            a.fingerprint: a for a in (existing_alerts or [])
        }

        # Build each group's raw hit structure; also collect superset/subset
        # member-id sets so a strictly-smaller group (e.g. raas_blockade ⊂
        # hyperkalemia) can be suppressed when a larger group covers all its
        # members and carries equal-or-higher severity expectation.
        group_results: List[Tuple[str, Dict[str, Any], List[dict]]] = []
        for group_key, group in self._endpoint_groups.items():
            members_by_atc: Dict[str, Dict[str, Optional[str]]] = group.get(
                "members_by_atc"
            ) or {}
            if not members_by_atc:
                continue

            hits: List[dict] = [
                m for m in meds
                if (m.get("atc_code") or "") in members_by_atc
            ]
            if len(hits) < 2:
                continue

            # B 類: subtype-coverage requirement
            required: Optional[Set[str]] = group.get("requires_subtypes")
            if required:
                subtypes_found: Set[str] = set()
                for m in hits:
                    atc = m.get("atc_code") or ""
                    meta = members_by_atc.get(atc)
                    if meta and meta.get("subtype"):
                        subtypes_found.add(meta["subtype"])
                if not required.issubset(subtypes_found):
                    continue

            # Deduplicate members by medication_id inside one group
            seen_ids: Set[str] = set()
            unique_hits: List[dict] = []
            for h in hits:
                mid = str(h.get("medication_id") or "")
                if mid and mid in seen_ids:
                    continue
                if mid:
                    seen_ids.add(mid)
                unique_hits.append(h)
            group_results.append((group_key, group, unique_hits))

        # Subset suppression — if group B's members ⊊ group A's members, drop B
        # (the superset alert carries all the clinical signal). Keeps the
        # alert list focused on the most complete endpoint-group match per
        # medication set; avoids flooding when a patient on ACEI + MRA + TMP
        # would otherwise trigger both raas_blockade (2 of 3) and hyperkalemia
        # (all 3) — only the hyperkalemia alert is surfaced.
        kept_results: List[Tuple[str, Dict[str, Any], List[dict]]] = []
        for i, (gk_i, g_i, hits_i) in enumerate(group_results):
            ids_i = frozenset(
                str(h.get("medication_id") or "") for h in hits_i
            )
            covered = False
            for j, (gk_j, g_j, hits_j) in enumerate(group_results):
                if i == j:
                    continue
                ids_j = frozenset(
                    str(h.get("medication_id") or "") for h in hits_j
                )
                # Strictly smaller set ⊂ bigger set ⇒ suppress the smaller
                if ids_i < ids_j:
                    covered = True
                    break
            if not covered:
                kept_results.append((gk_i, g_i, hits_i))

        alerts: List[DuplicateAlert] = []
        for group_key, group, unique_hits in kept_results:
            level = self._l4_level(group_key, group, unique_hits, context)
            mechanism = self._l4_mechanism_label(group_key, group, unique_hits)

            alert = self._build_alert(
                members=unique_hits,
                level=level,
                layer="L4",
                mechanism=mechanism,
                recommendation=_RECOMMENDATIONS.get(
                    group_key, _GENERIC_REC_FALLBACK
                ),
                evidence_url=f"guide://§3.4/{group_key}",
            )

            # Narrow bridging downgrade (§2.3) — only bleeding_risk heparin↔LMWH
            self._maybe_l4_bridging_downgrade(alert, group_key, context)

            # Fingerprint collision with an earlier-layer alert (L1/L2/L3):
            # instead of emitting a duplicate row, fold L4's signal into the
            # existing alert so dedupe() keeps the higher-specificity layer
            # label but gains the L4-derived severity / bridging metadata.
            existing = existing_by_fp.get(alert.fingerprint)
            if existing is not None:
                self._fold_l4_into_existing(existing, alert)
                continue

            alerts.append(alert)
        return alerts

    def _fold_l4_into_existing(
        self,
        existing: DuplicateAlert,
        l4_alert: DuplicateAlert,
    ) -> None:
        """Merge an L4-derived signal into an earlier-layer alert in place.

        * Severity: if L4's level is higher (ICU red flag upgrade) or if L4
          carries a bridging downgrade, reflect it on the existing alert.
        * Bridging downgrade wins over the default escalation for heparin/LMWH
          cases — forcibly set to moderate per guide §2.3.
        * Mechanism text is preserved (existing L1/L2/L3 label is more
          specific); only evidence URL is backfilled if missing.
        """
        if l4_alert.auto_downgraded and l4_alert.downgrade_reason:
            # Bridging signal — force downgrade, even over critical upgrades.
            existing.level = l4_alert.level  # type: ignore[assignment]
            existing.auto_downgraded = True
            existing.downgrade_reason = l4_alert.downgrade_reason
        elif existing.auto_downgraded and existing.downgrade_reason == (
            _REASON_OVERLAP_TRANSITION
        ):
            # A prior L4 group already applied a bridging downgrade — don't
            # re-upgrade it via a later group's default severity. The bridging
            # signal is clinically specific and should stick.
            pass
        elif _LEVEL_RANK.get(l4_alert.level, 0) > _LEVEL_RANK.get(
            existing.level, 0
        ):
            existing.level = l4_alert.level  # type: ignore[assignment]
            # Reset downgrade flags if we just lifted severity upward.
            existing.auto_downgraded = False
            existing.downgrade_reason = None

        if l4_alert.evidence_url and not existing.evidence_url:
            existing.evidence_url = l4_alert.evidence_url

    def _l4_level(
        self,
        group_key: str,
        group: Dict[str, Any],
        hits: List[dict],
        context: Optional[str],
    ) -> str:
        """Pick initial severity per §3.4 defaults + stacking escalation.

        See _detect_l4 for the full escalation table.
        """
        if group_key == "raas_blockade":
            return "critical"

        if group_key == "bleeding_risk":
            n_heparin_lmwh = sum(
                1 for m in hits if (m.get("atc_code") or "").startswith("B01AB")
            )
            if (context or "").lower() == "icu" and n_heparin_lmwh >= 2:
                # §4.1 ICU red flag: therapeutic Heparin + prophylactic LMWH
                return "critical"
            if len(hits) >= 4:
                return "critical"
            return "high"

        if group_key == "hyperkalemia":
            return "high"

        if group_key == "nephrotoxic_triple_whammy":
            return "high"

        if group_key == "qtc_stacking":
            return "high"

        # Fall back to the declared severity (CSV / DB) or high.
        declared = (group.get("severity") or "high").lower()
        return declared if declared in _LEVEL_RANK else "high"

    def _maybe_l4_bridging_downgrade(
        self,
        alert: DuplicateAlert,
        group_key: str,
        context: Optional[str],
    ) -> None:
        """Downgrade heparin↔LMWH bridging (bleeding_risk) to moderate.

        Pattern: exactly 2 B01AB* members with different routes whose
        ``last_admin_at`` values fall within _OVERLAP_WINDOW_HOURS, non-ICU.
        Heparin IV → Enoxaparin SC (or vice versa) is standard bridging
        practice — keep the alert visible but not Critical/High.
        """
        if group_key != "bleeding_risk":
            return
        if (context or "").lower() == "icu":
            return
        if len(alert.members) != 2:
            return
        n_heparin = sum(
            1 for m in alert.members
            if (m.atc_code or "").startswith("B01AB")
        )
        if n_heparin != 2:
            return
        routes = {
            (m.route or "").strip().lower()
            for m in alert.members
            if (m.route or "").strip()
        }
        if len(routes) < 2:
            return
        if not _overlap_within(alert.members, _OVERLAP_WINDOW_HOURS):
            return
        # Force to moderate (always a downgrade from default high/critical).
        alert.level = "moderate"  # type: ignore[assignment]
        alert.auto_downgraded = True
        alert.downgrade_reason = _REASON_OVERLAP_TRANSITION

    def _l4_mechanism_label(
        self,
        group_key: str,
        group: Dict[str, Any],
        hits: List[dict],
    ) -> str:
        zh = group.get("zh") or ""
        en = group.get("en") or ""
        n = len(hits)
        base = zh or en or group_key
        if en and zh:
            return f"{zh}（{en}）×{n}"
        return f"{base} ×{n}"

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

            # -------- PRN + scheduled (L1/L2 only) -------
            # Guide §2.3 / §6.3: "一方為 PRN + 另一方為排程（且非同為長效
            # opioid/BZD）" — High → Low (two steps), Critical → Moderate.
            #
            # Restricted to L1/L2 alerts: for L3 mechanism-group / L4
            # endpoint-group alerts the PRN member still contributes to the
            # multi-drug stacking risk (QTc 疊加, 抗膽鹼負荷, promotility etc.
            # are cumulative even for intermittent exposure), so the §6.3
            # attenuation does not apply. See fixtures L3_qtc_haloperidol_
            # ondansetron / L3_promotility_triple / L3_cns_depressant_triple
            # — all have PRN members but are expected to stay at their L3
            # stacking severity.
            if has_prn and has_scheduled and alert.layer in ("L1", "L2"):
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

    # ------------------------------------------------------------------
    # L3 mechanism-group loading (lazy; DB first, CSV fallback)
    # ------------------------------------------------------------------
    async def _load_mechanism_groups(self) -> None:
        if self._mechanism_groups_loaded:
            return
        self._mechanism_groups_loaded = True  # set early to avoid retry storms
        try:
            await self._load_mechanism_groups_from_db()
            if self._mechanism_groups:
                return
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "duplicate_detector: mechanism group DB load failed: %s", exc
            )

        try:
            self._load_mechanism_groups_from_csv()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "duplicate_detector: mechanism group CSV load failed: %s", exc
            )

    async def _load_mechanism_groups_from_db(self) -> None:
        # Pull the full group × member table in one round trip.
        try:
            result = await self.session.execute(
                text(
                    "SELECT g.group_key, g.group_name_zh, g.group_name_en, "
                    "g.severity, m.atc_code "
                    "FROM drug_mechanism_groups g "
                    "JOIN drug_mechanism_group_members m "
                    "  ON m.group_id = g.id"
                )
            )
        except Exception as exc:
            # Tables may not exist yet (local dev / fresh DB) — caller will
            # fall back to CSV.
            raise exc
        rows = result.all()
        for group_key, zh, en, severity, atc in rows:
            if not group_key or not atc:
                continue
            entry = self._mechanism_groups.setdefault(
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
        code_maps = (
            Path(__file__).resolve().parent.parent / "fhir" / "code_maps"
        )
        groups_csv = code_maps / "drug_mechanism_groups.csv"
        members_csv = code_maps / "drug_mechanism_group_members.csv"

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
            non_comment = (
                line for line in fh
                if line.lstrip() and not line.lstrip().startswith("#")
            )
            reader = csv.DictReader(non_comment)
            for row in reader:
                key = (row.get("group_key") or "").strip()
                if not key:
                    continue
                self._mechanism_groups[key] = {
                    "zh": (row.get("group_name_zh") or key).strip(),
                    "en": (row.get("group_name_en") or "").strip(),
                    "severity": (
                        (row.get("severity") or "high").strip().lower()
                    ),
                    "members": set(),
                }

        # Members
        with members_csv.open("r", encoding="utf-8") as fh:
            non_comment = (
                line for line in fh
                if line.lstrip() and not line.lstrip().startswith("#")
            )
            reader = csv.DictReader(non_comment)
            for row in reader:
                key = (row.get("group_key") or "").strip()
                atc = (row.get("atc_code") or "").strip()
                if not key or not atc:
                    continue
                entry = self._mechanism_groups.get(key)
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
    # L4 endpoint-group loading (lazy; DB first, CSV fallback)
    # ------------------------------------------------------------------
    async def _load_endpoint_groups(self) -> None:
        if self._endpoint_groups_loaded:
            return
        self._endpoint_groups_loaded = True
        try:
            await self._load_endpoint_groups_from_db()
            if self._endpoint_groups:
                self._apply_subtype_coverage_requirements()
                return
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "duplicate_detector: endpoint group DB load failed: %s", exc
            )

        try:
            self._load_endpoint_groups_from_csv()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "duplicate_detector: endpoint group CSV load failed: %s", exc
            )

        # Tag subtype-coverage groups after load (idempotent).
        self._apply_subtype_coverage_requirements()

    async def _load_endpoint_groups_from_db(self) -> None:
        try:
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
        except Exception as exc:
            # Tables may not exist yet — caller will fall back to CSV.
            raise exc
        rows = result.all()
        for group_key, zh, en, severity, atc, ingredient, subtype in rows:
            if not group_key or not atc:
                continue
            entry = self._endpoint_groups.setdefault(
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
        code_maps = (
            Path(__file__).resolve().parent.parent / "fhir" / "code_maps"
        )
        groups_csv = code_maps / "drug_endpoint_groups.csv"
        members_csv = code_maps / "drug_endpoint_group_members.csv"

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
            non_comment = (
                line for line in fh
                if line.lstrip() and not line.lstrip().startswith("#")
            )
            reader = csv.DictReader(non_comment)
            for row in reader:
                key = (row.get("group_key") or "").strip()
                if not key:
                    continue
                self._endpoint_groups[key] = {
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
            non_comment = (
                line for line in fh
                if line.lstrip() and not line.lstrip().startswith("#")
            )
            reader = csv.DictReader(non_comment)
            for row in reader:
                key = (row.get("group_key") or "").strip()
                atc = (row.get("atc_code") or "").strip()
                if not key or not atc:
                    continue
                entry = self._endpoint_groups.get(key)
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
            entry = self._endpoint_groups.get(group_key)
            if entry is None:
                continue
            entry["requires_subtypes"] = set(required)

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


# ---------------------------------------------------------------------------
# L4 subtype-coverage requirements (§3.4 — B 類 groups)
# ---------------------------------------------------------------------------
# Some endpoint groups only trigger when the hit ATC set spans multiple
# clinically distinct subtypes. Keyed by group_key → required subtype set.
# Each member's ``member_subtype`` in drug_endpoint_group_members.csv must
# match one of the required subtypes.
#
# Example: nephrotoxic_triple_whammy fires only when NSAID + RAAS + Diuretic
# coexist — two NSAIDs alone (or NSAID + RAAS without a diuretic) do not
# qualify, because the mechanism requires the synergistic three-hit on renal
# perfusion (afferent + efferent + volume).
_SUBTYPE_COVERAGE_GROUPS: Dict[str, Set[str]] = {
    "nephrotoxic_triple_whammy": {"nsaid", "raas", "diuretic"},
}


# ---------------------------------------------------------------------------
# L3 stacking-escalation rules (§3.4)
# ---------------------------------------------------------------------------
# Some mechanism groups carry a "the more members stack, the higher the
# severity" semantics (guide §3.4 narrative text). We encode those escalation
# rules here as callables so _detect_l3 stays declarative.
#
# Signature: (group_entry, hit_meds) -> level
#   - group_entry: the entry dict from DuplicateDetector._mechanism_groups
#     (contains "severity" baseline from CSV/DB).
#   - hit_meds: list of normalised medication dicts that matched the group.
#
# Groups absent from _L3_STACKING_RULES use `group_entry["severity"]` as-is.
#
# Specific rules (per task spec):
#   - qtc_prolonging         default high     ≥3 total            → critical
#   - cns_depressant         default high     ≥3 scheduled AND
#                                             opioid+BZD present  → critical
#                            (PRN drugs are not counted for the threshold —
#                             they do not produce continuous stacking exposure)
#   - anticholinergic_burden default moderate ≥3 total            → high
#   - serotonergic           default high     ≥3 total OR contains
#                                             Linezolid/MAOI/
#                                             Methylene blue      → critical
# -----------------------------------------------------------------------

# Serotonergic "critical escalator" ingredients — if any of these ATC codes are
# present alongside another serotonergic drug, severity jumps to critical
# (MAOI-like activity → serotonin crisis risk).
_SEROTONERGIC_CRITICAL_ATCS: Set[str] = {
    "J01XX08",  # Linezolid
    "V03AB17",  # Methylene blue
    # Classic MAOIs (N06AF / N06AG) — not currently in CSV but listed per §3.4
    "N06AF03",  # Phenelzine
    "N06AF04",  # Tranylcypromine
    "N06AG02",  # Moclobemide
}

# ATC-code helpers used by cns_depressant stacking rule.
_CNS_OPIOID_ATC_PREFIXES: Tuple[str, ...] = ("N02A", "N07BC")
_CNS_BZD_ATC_PREFIXES: Tuple[str, ...] = ("N05BA", "N05CD", "N03AE")


def _any_starts_with(atcs: Iterable[str], prefixes: Tuple[str, ...]) -> bool:
    return any(
        atc and any(atc.startswith(p) for p in prefixes) for atc in atcs
    )


# CNS-depressant sub-class partitioning — used by _detect_l3's guard to
# suppress same-sub-class cns_depressant hits (those are L2 / upgrade-pair
# territory, not cross-mechanism stacking). Buckets follow §3.4 narrative:
#   opioid     — N02A* (analgesic opioids), N07BC* (substitution opioids like Methadone)
#   bzd        — N05BA* (anxiolytic BZDs), N05CD* (hypnotic BZDs), N03AE* (Clonazepam-class AED)
#   zdrug      — N05CF* (Zolpidem / Zopiclone)
#   gabapentinoid — N03AX12 / N03AX16 (Gabapentin / Pregabalin)
#   h1         — R06AA*, R06AB*, R06AX* (first-gen H1 antihistamines)
#   sedating_h1_psy — N05BB* (Hydroxyzine) / N05AA* (sedating phenothiazines like Chlorpromazine)
_CNS_SUBCLASS_RULES: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("opioid", ("N02A", "N07BC")),
    ("bzd", ("N05BA", "N05CD", "N03AE")),
    ("zdrug", ("N05CF",)),
    ("gabapentinoid", ("N03AX12", "N03AX16")),
    ("h1", ("R06AA", "R06AB", "R06AX")),
    ("sedating_h1_psy", ("N05BB", "N05AA")),
)


def _cns_subclass(atc: Optional[str]) -> Optional[str]:
    """Return a sub-class bucket for ``atc`` within the cns_depressant group.

    Returns None when the ATC does not match any known CNS sub-class — callers
    should treat that as "unclassified" and not contribute to the sub-class
    count.
    """
    if not atc:
        return None
    for name, prefixes in _CNS_SUBCLASS_RULES:
        if any(atc.startswith(p) for p in prefixes):
            return name
    return None


def _l3_stacking_qtc(group: Dict[str, Any], hits: List[dict]) -> str:
    if len(hits) >= 3:
        return "critical"
    return "high"


def _l3_stacking_cns(group: Dict[str, Any], hits: List[dict]) -> str:
    # Only scheduled (non-PRN) orders contribute continuous CNS exposure;
    # PRN breakthrough doses do not automatically imply stacked sedation.
    scheduled = [m for m in hits if not m.get("is_prn")]
    if len(scheduled) >= 3:
        atcs = [m.get("atc_code") or "" for m in scheduled]
        has_opioid = _any_starts_with(atcs, _CNS_OPIOID_ATC_PREFIXES)
        has_bzd = _any_starts_with(atcs, _CNS_BZD_ATC_PREFIXES)
        if has_opioid and has_bzd:
            return "critical"
    return "high"


def _l3_stacking_anticholinergic(
    group: Dict[str, Any], hits: List[dict]
) -> str:
    if len(hits) >= 3:
        return "high"
    return "moderate"


def _l3_stacking_serotonergic(
    group: Dict[str, Any], hits: List[dict]
) -> str:
    atcs = {m.get("atc_code") or "" for m in hits}
    if atcs & _SEROTONERGIC_CRITICAL_ATCS:
        return "critical"
    if len(hits) >= 3:
        return "critical"
    return "high"


_L3_STACKING_RULES: Dict[str, Callable[[Dict[str, Any], List[dict]], str]] = {
    "qtc_prolonging": _l3_stacking_qtc,
    "cns_depressant": _l3_stacking_cns,
    "anticholinergic_burden": _l3_stacking_anticholinergic,
    "serotonergic": _l3_stacking_serotonergic,
}


def _l3_stacking_level(
    group_key: str, group: Dict[str, Any], hits: List[dict]
) -> str:
    rule = _L3_STACKING_RULES.get(group_key)
    if rule is not None:
        return rule(group, hits)
    # Default: use the group's declared baseline severity (CSV / DB).
    sev = (group.get("severity") or "high").lower()
    return sev if sev in _LEVEL_RANK else "high"


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
