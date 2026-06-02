"""Duplicate medication detection service (L1/L2 + auto-downgrade + overrides).

Central Single Source of Truth for duplicate-medication analysis.
Consumed by the REST API, AI clinical snapshot builder, and the pre-computed
cache layer — all call DuplicateDetector(session).analyze(meds).

Wave 1 scope:
  * L1 — same ATC L5 (7 chars) grouping              → critical
  * L2 — same ATC L4 prefix (5 chars)                → high
  * auto-downgrade rules (route / salt / overlap / PRN-vs-scheduled)
  * overrides (§3.1 upgrade  + §3.3 whitelist), wildcard-aware
  * fingerprint dedupe — same member set keeps highest level

Wave 2:
  * L3 mechanism-group joins (drug_mechanism_groups / _members)
  * L4 endpoint-group joins  (drug_endpoint_groups  / _members)
  * Problem-list based adequacy downgrade

Input flexibility: analyze() accepts either ORM Medication objects or dicts
(matching the shape in backend/tests/fixtures/duplicate_cases.json). Both are
normalised into a uniform internal dict via _normalize_med().

This package was split out of a single ``duplicate_detector.py`` module. The
full prior public surface is re-exported here so
``from app.services.duplicate_detector import ...`` continues to work
unchanged for all consumers.
"""
from __future__ import annotations

# --- Public DTOs / type aliases --------------------------------------------
from .models import (  # noqa: F401
    Context,
    DuplicateAlert,
    DuplicateMember,
    Layer,
    Level,
    _UpgradeRule,
    _WhitelistRule,
)

# --- Curated clinical knowledge tables -------------------------------------
from .knowledge import (  # noqa: F401
    _ACTIVE_WINDOW_HOURS,
    _ATC_L4_LABELS,
    _CNS_BZD_ATC_PREFIXES,
    _CNS_OPIOID_ATC_PREFIXES,
    _CNS_SUBCLASS_RULES,
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
    _SALT_SUFFIXES,
    _SEROTONERGIC_CRITICAL_ATCS,
    _SUBTYPE_COVERAGE_GROUPS,
    _TRANSITION_MIN_SPREAD_HOURS,
)

# --- Pure matching / normalisation helpers ---------------------------------
from .matching import (  # noqa: F401
    _any_member_discontinued,
    _atc_match,
    _coerce_datetime,
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

# --- L3 stacking-escalation callables --------------------------------------
from .stacking import (  # noqa: F401
    _L3_STACKING_RULES,
    _any_starts_with,
    _cns_subclass,
    _l3_stacking_anticholinergic,
    _l3_stacking_cns,
    _l3_stacking_level,
    _l3_stacking_qtc,
    _l3_stacking_serotonergic,
)

# --- Seed-data repository ---------------------------------------------------
from .loaders import RuleRepository  # noqa: F401

# --- Public orchestrator ----------------------------------------------------
from .detector import DuplicateDetector  # noqa: F401

__all__ = [
    "DuplicateDetector",
    "DuplicateAlert",
    "DuplicateMember",
    "RuleRepository",
    "Context",
    "Layer",
    "Level",
]
