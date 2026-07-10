"""
patient_context_builder — Build structured Clinical Snapshot for ICU LLM context.

Produces a ~700-token plain-text snapshot of a patient's current status,
including lab trends, vitals, medications, ventilator settings, and reports.
Also builds delta blocks for subsequent chat turns.

This package was split out of the original single-module
``patient_context_builder.py`` along its banner seams:

  * ``_shared``     — TAIPEI_TZ / _now_taipei / logger / trend threshold
  * ``repository``  — async ``_get_*`` DB queries + ``_merge_lab_rows``
  * ``lab_values``  — ``_get_lab_val`` / ``_vasopressor_ne_dose`` + alias map
  * ``safety``      — allergy↔med conflicts + duplicate-warning logic/sections
  * ``formatters``  — pure ``_fmt_*`` section renderers
  * ``builders``    — public snapshot builders + ``build_delta``

Every symbol that the original flat module exported is re-exported here so
existing imports (``from app.services.patient_context_builder import ...``) and
test monkeypatching (``monkeypatch.setattr(pcb, "_get_latest_vent", ...)``)
keep working unchanged.
"""

# ── Shared primitives ─────────────────────────────────────────────────────────
from ._shared import (
    TAIPEI_TZ,
    _TREND_THRESHOLD,
    _now_taipei,
    logger,
)

# ── Repository (async DB queries) ──────────────────────────────────────────────
# Imported before .builders so the builders can resolve these names off the
# package namespace at call time (and so tests can monkeypatch them here).
from .repository import (
    _LAB_CATEGORY_ATTRS,
    _LAB_MERGE_LIMIT,
    _merge_lab_rows,
    _get_patient,
    _get_latest_lab,
    _get_lab_before_24h,
    _get_active_medications,
    _get_latest_vital,
    _get_latest_vent,
    _get_recent_reports,
    _get_latest_scores,
    _get_latest_column_timestamp,
    _get_auxiliary_freshness_timestamps,
)

# ── Value extractors ───────────────────────────────────────────────────────────
from .lab_values import (
    _LAB_KEY_ALIASES,
    _get_lab_val,
    _get_lab_item_as_of,
    _vasopressor_ne_dose,
)

# ── Safety (allergy / duplicate) ───────────────────────────────────────────────
# Re-export the duplicate-detector entrypoints so callers/tests can patch them
# at ``pcb.format_duplicate_metadata`` / ``pcb.format_duplicate_text`` (the
# original flat module exposed them as module-globals). safety.py resolves them
# back off this package namespace at call time.
from app.utils.duplicate_check import format_duplicate_metadata, format_duplicate_text
from .safety import (
    _NO_ALLERGY_MARKERS,
    _ALLERGY_GROUP_KEYWORDS,
    _SAFETY_CATEGORY_ORDER,
    _split_allergy_text,
    _normalise_allergy_term,
    _extract_allergy_terms,
    _normalise_med_text,
    _allergy_matches_med,
    _find_allergy_med_conflicts,
    _warning_safety_category,
    _fmt_warning_brief,
    _fmt_medication_safety_section,
    _infer_duplicate_context,
    _safe_duplicate_warnings,
    _fmt_duplicate_section,
)

# ── Pure formatters ────────────────────────────────────────────────────────────
from .formatters import (
    _RENAL_RELEVANT_KEYWORDS,
    _LAB_STALE_THRESHOLD,
    _format_trend,
    _stale_marker,
    _normalize_snapshot_dt,
    _fmt_snapshot_dt,
    _max_datetime,
    _fmt_status_item,
    _fmt_data_freshness_section,
    _positive_float,
    _fmt_num,
    _estimate_crcl,
    _renal_relevant_med_names,
    _fmt_renal_dosing_section,
    _fmt_patient_section,
    _fmt_vital_section,
    _fmt_vent_section,
    _fmt_lab_section,
    _fmt_med_section,
    _fmt_reports_section,
    _fmt_scores_section,
)

# ── Public builders ────────────────────────────────────────────────────────────
# Imported last: builders.py references fetchers/helpers via the package module
# (``import app.services.patient_context_builder as _pkg``) at call time, which
# requires the names above to already be bound on this module.
from .builders import (
    _assemble_snapshot,
    build_clinical_snapshot,
    build_critical_snapshot,
    build_deferred_snapshot,
    extract_snapshot_key_values,
    build_delta,
    build_med_change_delta,
)

__all__ = [
    # public API
    "build_clinical_snapshot",
    "build_critical_snapshot",
    "build_deferred_snapshot",
    "build_delta",
    "build_med_change_delta",
    "extract_snapshot_key_values",
    # shared
    "TAIPEI_TZ",
    "_now_taipei",
    # frequently imported internals (consumers + tests)
    "_get_latest_lab",
    "_get_active_medications",
    "_get_lab_val",
    "_get_lab_item_as_of",
    "_merge_lab_rows",
    "_stale_marker",
    "_vasopressor_ne_dose",
    "_fmt_data_freshness_section",
    "_fmt_lab_section",
    "_fmt_medication_safety_section",
    "_fmt_patient_section",
    "_fmt_renal_dosing_section",
]
