"""L3 mechanism-group stacking escalation rules (§3.4).

Some mechanism groups carry a "the more members stack, the higher the
severity" semantics (guide §3.4 narrative text). We encode those escalation
rules here as callables so _detect_l3 stays declarative.

Signature: (group_entry, hit_meds) -> level
  - group_entry: the entry dict from DuplicateDetector._mechanism_groups
    (contains "severity" baseline from CSV/DB).
  - hit_meds: list of normalised medication dicts that matched the group.

Groups absent from _L3_STACKING_RULES use `group_entry["severity"]` as-is.

Specific rules (per task spec):
  - qtc_prolonging         default high     ≥3 total            → critical
  - cns_depressant         default high     ≥3 scheduled AND
                                            opioid+BZD present  → critical
                           (PRN drugs are not counted for the threshold —
                            they do not produce continuous stacking exposure)
  - anticholinergic_burden default moderate ≥3 total            → high
  - serotonergic           default high     ≥3 total OR contains
                                            Linezolid/MAOI/
                                            Methylene blue      → critical
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .knowledge import (
    _CNS_BZD_ATC_PREFIXES,
    _CNS_OPIOID_ATC_PREFIXES,
    _CNS_SUBCLASS_RULES,
    _LEVEL_RANK,
    _SEROTONERGIC_CRITICAL_ATCS,
)


def _any_starts_with(atcs: Iterable[str], prefixes: Tuple[str, ...]) -> bool:
    return any(
        atc and any(atc.startswith(p) for p in prefixes) for atc in atcs
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
