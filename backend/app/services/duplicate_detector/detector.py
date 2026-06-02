"""DuplicateDetector orchestration — the public detector + analyze().

Wires the L1/L2/L3/L4 detection layers, override/downgrade/dedupe passes
and delegates all seed-data loading to :class:`RuleRepository`. Pure: reads
seed tables, emits alerts, writes nothing.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from .knowledge import (
    _ATC_L4_LABELS,
    _GENERIC_REC_FALLBACK,
    _LEVEL_RANK,
    _LONG_ACTING_OPIOID_BZD_ATC,
    _OVERLAP_WINDOW_HOURS,
    _PRN_DOWNGRADE_MAP,
    _REASON_DIFF_ROUTE,
    _REASON_DIFF_SALT,
    _REASON_OVERLAP_TRANSITION,
    _REASON_PRN_SCHEDULED,
    _RECOMMENDATIONS,
    _TRANSITION_MIN_SPREAD_HOURS,
)
from .loaders import RuleRepository
from .matching import (
    _any_member_discontinued,
    _is_inactive,
    _is_valid_atc,
    _make_fingerprint,
    _normalize_med,
    _overlap_within,
    _pair_matches,
    _salt_differs,
    _spread_at_least,
    _strip_salt_suffix,
    _to_duplicate_member,
)
from .models import Context, DuplicateAlert
from .stacking import _cns_subclass, _l3_stacking_level

logger = logging.getLogger(__name__)


class DuplicateDetector:
    """Pure-function detector — reads seed tables, emits alerts, writes nothing.

    Usage:
        detector = DuplicateDetector(session)
        alerts = await detector.analyze(meds, context="inpatient")
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self._repo = RuleRepository(session)

    # ------------------------------------------------------------------
    # Backwards-compatible internal-state accessors
    # ------------------------------------------------------------------
    # Detection helpers (and any legacy callers / tests) reference the rule
    # tables through these attribute names; back them with the repository so
    # behaviour is unchanged after the split.
    @property
    def _upgrade_rules(self) -> list:
        return self._repo.upgrade_rules

    @property
    def _whitelist_rules(self) -> list:
        return self._repo.whitelist_rules

    @property
    def _mechanism_groups(self) -> Dict[str, Dict[str, Any]]:
        return self._repo.mechanism_groups

    @property
    def _endpoint_groups(self) -> Dict[str, Dict[str, Any]]:
        return self._repo.endpoint_groups

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

        await self._repo.load_overrides()

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
        await self._repo.load_mechanism_groups()
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
        await self._repo.load_endpoint_groups()
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

            # Whitelist → drop only if EVERY pair in the alert is whitelisted
            # (P0-2). Single-pair match is unsafe for multi-member L4 alerts.
            if self._all_pairs_whitelisted(atcs, self._whitelist_rules):
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
                    # P1-D3: when an upgrade rule fires, the alert mechanism
                    # is whatever was synthesized earlier (e.g. "Diazepam ×
                    # Clonazepam") which doesn't match _RECOMMENDATIONS keys.
                    # The rule's reason carries a canonical mechanism / group
                    # key in many cases — try to map it; otherwise fall back
                    # to ATC-prefix lookup against _ATC_PREFIX_LABELS so we
                    # surface specific guidance instead of the generic text.
                    if alert.recommendation == _GENERIC_REC_FALLBACK or not alert.recommendation:
                        better = _RECOMMENDATIONS.get(reason or "")
                        if better is None:
                            # Try ATC-prefix label (e.g. "N05BA" → "Long-acting BZD × Long-acting BZD")
                            for atc in atcs:
                                prefix = (atc or "")[:5]
                                label = _ATC_L4_LABELS.get(prefix)
                                if label and label in _RECOMMENDATIONS:
                                    better = _RECOMMENDATIONS[label]
                                    break
                        if better:
                            alert.recommendation = better
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

    def _all_pairs_whitelisted(
        self, atcs: List[str], rules: List[Any]
    ) -> bool:
        """Return True only when EVERY unordered ATC pair in ``atcs`` is
        whitelisted by some rule.

        P0-2: previously ``_any_pair_matches`` was used for whitelist
        suppression in ``_apply_overrides``; for a multi-member L4 alert,
        a single whitelisted pair (e.g. an IV-solution self-pair, or
        Furo+Spironolactone) would suppress the entire alert — including
        unrelated bleeding-risk / RAAS-blockade members in the same group.
        Critical safety risk: a CSV addition could silently kill a real
        alert. The conservative rule "drop only if ALL pairs whitelisted"
        is equivalent for 2-member alerts (the most common case) and
        protects multi-member alerts.
        """
        if len(atcs) < 2:
            return False
        for i in range(len(atcs)):
            for j in range(i + 1, len(atcs)):
                a, b = atcs[i], atcs[j]
                if not any(
                    _pair_matches(a, b, rule.pattern_1, rule.pattern_2)
                    for rule in rules
                ):
                    return False
        return True

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
