"""Public snapshot builders and the per-turn delta.

Assembles the section strings (from formatters / safety) on top of the async
fetchers (from repository) into the final Clinical Snapshot text. Two entry
points — build_clinical_snapshot (legacy single-shot) and build_critical_snapshot
(+ build_deferred_snapshot) — share the same section sequence via
_assemble_snapshot to guarantee byte-identical output.

NOTE on monkeypatching: the fast-test suite patches fetchers on the *package*
namespace (``monkeypatch.setattr(pcb, "_get_latest_vent", ...)`` where
``pcb`` is ``app.services.patient_context_builder``). To honour that, the
builders resolve fetchers/duplicate-helper through the package module object at
call time (``_pkg._get_latest_vent``) rather than binding them at import time.
Do not switch these back to direct local references — it would silently break
the deferred-split invariant tests and, more importantly, the patch points the
B15 latency work relies on.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lab_data import LabData
from app.models.medication import Medication

import app.services.patient_context_builder as _pkg

from ._shared import _TREND_THRESHOLD, _now_taipei
from .formatters import (
    _fmt_data_freshness_section,
    _fmt_lab_section,
    _fmt_med_section,
    _fmt_patient_section,
    _fmt_renal_dosing_section,
    _fmt_reports_section,
    _fmt_scores_section,
    _fmt_vent_section,
    _fmt_vital_section,
)
from .safety import (
    _fmt_duplicate_section,
    _fmt_medication_safety_section,
    _infer_duplicate_context,
)
from .lab_values import _get_lab_val, _vasopressor_ne_dose


def _assemble_snapshot(
    *,
    now_str: str,
    freshness_section: str,
    patient,
    vitals,
    latest_lab,
    prev_lab,
    meds: List[Medication],
    duplicate_warnings: List[Dict[str, Any]],
    vent=None,
    reports: Optional[list] = None,
    scores: Optional[list] = None,
    include_deferred_sections: bool,
) -> str:
    """Build the snapshot section sequence shared by the clinical/critical paths.

    The two public builders historically duplicated this exact ordering of
    sections; centralising it keeps their text byte-identical for the overlapping
    sections (header → freshness → patient → vital → [vent] → lab → renal → med →
    safety → [duplicate] → [reports] → [scores]).

    ``include_deferred_sections`` controls whether vent / reports / scores are
    embedded inline (legacy build_clinical_snapshot) or omitted (B15
    build_critical_snapshot, which defers them to build_deferred_snapshot).
    """
    sections = [
        "=== ICU 病患目前資料 ===",
        f"時間戳記：{now_str}（台北時間）",
        "",
        freshness_section,
        "",
        _fmt_patient_section(patient),
        "",
        _fmt_vital_section(vitals),
        "",
    ]

    if include_deferred_sections:
        vent_section = _fmt_vent_section(vent)
        if vent_section:
            sections += [vent_section, ""]

    sections += [
        _fmt_lab_section(latest_lab, prev_lab),
        "",
        _fmt_renal_dosing_section(patient, latest_lab, meds, vitals),
        "",
        _fmt_med_section(meds),
        "",
        _fmt_medication_safety_section(patient, meds, duplicate_warnings),
    ]

    duplicate_section = _fmt_duplicate_section(duplicate_warnings)
    if duplicate_section:
        sections += ["", duplicate_section]

    if include_deferred_sections:
        reports_section = _fmt_reports_section(reports or [])
        if reports_section:
            sections += ["", reports_section]

        scores_section = _fmt_scores_section(scores or [])
        if scores_section:
            sections += ["", scores_section]

    sections.append("\n=== 資料結束 ===")
    return "\n".join(sections)


# ── Public API ────────────────────────────────────────────────────────────────

async def build_clinical_snapshot(patient_id: str, db: AsyncSession) -> str:
    """
    Query all relevant patient data in parallel and return a Clinical Snapshot string.
    This is used as the first-turn system prompt context (~700 tokens).
    """
    # AsyncSession lazily acquires its underlying connection on the first
    # query. Without warm-up the asyncio.gather below races on connection
    # provisioning and crashes with "This session is provisioning a new
    # connection; concurrent operations are not permitted". Production has
    # been working only because the /ai/chat/stream router happens to call
    # _get_or_create_session() before this function — that prior SELECT
    # acquires the connection implicitly. Don't rely on caller order; warm
    # up explicitly. See docs/b15-snapshot-latency-plan-2026-04-30.md §1
    # and the audit in scripts/b15_snapshot_audit.py for the fragile-contract
    # discovery.
    await db.connection()

    patient, latest_lab, meds, vitals, vent, reports, scores = await asyncio.gather(
        _pkg._get_patient(db, patient_id),
        _pkg._get_latest_lab(db, patient_id),
        _pkg._get_active_medications(db, patient_id),
        _pkg._get_latest_vital(db, patient_id),
        _pkg._get_latest_vent(db, patient_id),
        _pkg._get_recent_reports(db, patient_id, limit=3),
        _pkg._get_latest_scores(db, patient_id),
    )

    if not patient:
        return f"[無法取得患者資料 patient_id={patient_id}]"

    # Get previous lab for trends (24h before latest)
    prev_lab = None
    if latest_lab and latest_lab.timestamp:
        prev_lab = await _pkg._get_lab_before_24h(db, patient_id, latest_lab.timestamp)

    extra_timestamps = await _pkg._get_auxiliary_freshness_timestamps(db, patient_id)
    duplicate_warnings = await _pkg._safe_duplicate_warnings(
        db, meds, context=_infer_duplicate_context(patient)
    )
    now_str = _now_taipei().strftime("%Y-%m-%d %H:%M")

    freshness_section = _fmt_data_freshness_section(
        patient, latest_lab, meds, vitals, vent, reports, scores, extra_timestamps
    )

    return _assemble_snapshot(
        now_str=now_str,
        freshness_section=freshness_section,
        patient=patient,
        vitals=vitals,
        latest_lab=latest_lab,
        prev_lab=prev_lab,
        meds=meds,
        duplicate_warnings=duplicate_warnings,
        vent=vent,
        reports=reports,
        scores=scores,
        include_deferred_sections=True,
    )


async def build_critical_snapshot(
    patient_id: str, db: AsyncSession
) -> tuple[str, Dict[str, Any], Dict[str, Any]]:
    """B15-A1 critical-only path. Returns first-turn snapshot text + delta
    key values + metadata for the deferred follow-up.

    Includes (must be ready before LLM streams):
      patient, latest_lab + 24h-prior lab (for trend), active_medications,
      latest_vital, duplicate_warnings.

    Excludes — fetched separately by build_deferred_snapshot in a background
    task after the first response yields:
      latest_vent, recent_reports, latest_scores.

    Per docs/b15-snapshot-latency-plan-2026-04-30.md §3.1+§4.1:
    - duplicate stays in critical (medication safety)
    - lab_before_24h stays in critical (small ~600ms, trend matters clinically)
    - vent: even when not intubated _fmt_vent_section returns empty, so deferring
      it never visibly hurts; when intubated the deferred fill catches up by
      turn 2

    Returns:
      (snapshot_text, key_values_for_delta, deferred_meta_dict)
    """
    # B15-B (multi-connection true parallel): each fetcher uses its own
    # AsyncSession so asyncio.gather actually runs them concurrently. With
    # the original shared-session approach the connection serialized 6
    # SELECTs and we measured ~30-40% parallel efficiency (build_ms ~5s
    # vs sum 17s). Spawning fresh sessions lets the Supabase pooler
    # fan out to multiple backend connections, max parallel limited by
    # the slowest fetcher (~vital ~2.4s) instead of the sum.
    #
    # W3-T1 (pool relief): first wave keeps 4 fresh connections so the
    # critical-path SELECTs run truly in parallel (~2.4s wall vs ~5s
    # serial). Second wave (lab_before_24h + duplicate_warnings) is
    # serialized onto the request's `db` connection — both are fast
    # (~600ms / in-process) and serializing them drops the per-request
    # connection ceiling from 6 → 4. With Supabase pool 5 + overflow 5,
    # safe concurrent first-turn chats rise from ~2 to ~3 per replica.
    from app.database import async_session as _async_session

    async def _fresh(fn, *args):
        async with _async_session() as s:
            return await fn(s, *args)

    patient, latest_lab, meds, vitals = await asyncio.gather(
        _fresh(_pkg._get_patient, patient_id),
        _fresh(_pkg._get_latest_lab, patient_id),
        _fresh(_pkg._get_active_medications, patient_id),
        _fresh(_pkg._get_latest_vital, patient_id),
    )

    if not patient:
        return f"[無法取得患者資料 patient_id={patient_id}]", {}, {}

    # Post-gather: serialize on the request's db connection (no extra pool
    # slot). lab_before_24h needs latest_lab.timestamp, so it would have to
    # wait anyway; running duplicate_warnings right after costs the same
    # wall time as the previous parallel pair (both are sub-second) but
    # uses 0 extra connections.
    await db.connection()  # warm up before reuse
    if latest_lab and latest_lab.timestamp:
        prev_lab = await _pkg._get_lab_before_24h(db, patient_id, latest_lab.timestamp)
    else:
        prev_lab = None
    extra_timestamps = await _pkg._get_auxiliary_freshness_timestamps(db, patient_id)
    duplicate_warnings = await _pkg._safe_duplicate_warnings(
        db, meds, _infer_duplicate_context(patient)
    )

    now_str = _now_taipei().strftime("%Y-%m-%d %H:%M")

    freshness_section = _fmt_data_freshness_section(
        patient,
        latest_lab,
        meds,
        vitals,
        None,
        [],
        [],
        extra_timestamps,
        deferred_sections={
            *({"ventilator_settings"} if getattr(patient, "intubated", False) else set()),
            "diagnostic_reports",
            "clinical_scores",
        },
    )

    snapshot_text = _assemble_snapshot(
        now_str=now_str,
        freshness_section=freshness_section,
        patient=patient,
        vitals=vitals,
        latest_lab=latest_lab,
        prev_lab=prev_lab,
        meds=meds,
        duplicate_warnings=duplicate_warnings,
        include_deferred_sections=False,
    )

    key_values = extract_snapshot_key_values(latest_lab, meds)
    deferred_meta = {"intubated": bool(patient.intubated)}
    return snapshot_text, key_values, deferred_meta


async def build_deferred_snapshot(
    patient_id: str, db: AsyncSession, *, intubated: bool
) -> str:
    """B15-A1 deferred-only path. Fetched in background after first-turn
    LLM stream completes; result is appended to the critical snapshot for
    subsequent turns (separated by blank line).

    Includes:
      latest_vent (only when intubated; otherwise the section text is empty
        anyway so we save an RTT),
      recent_reports,
      latest_scores.

    Returns the formatted deferred section text. Empty string if all three
    sections are empty (nothing to append).
    """
    await db.connection()

    if intubated:
        vent, reports, scores = await asyncio.gather(
            _pkg._get_latest_vent(db, patient_id),
            _pkg._get_recent_reports(db, patient_id, limit=3),
            _pkg._get_latest_scores(db, patient_id),
        )
    else:
        reports, scores = await asyncio.gather(
            _pkg._get_recent_reports(db, patient_id, limit=3),
            _pkg._get_latest_scores(db, patient_id),
        )
        vent = None

    parts = []
    vent_section = _fmt_vent_section(vent) if vent else ""
    if vent_section:
        parts.append(vent_section)
    reports_section = _fmt_reports_section(reports)
    if reports_section:
        parts.append(reports_section)
    scores_section = _fmt_scores_section(scores)
    if scores_section:
        parts.append(scores_section)

    return "\n\n".join(parts)


def extract_snapshot_key_values(
    lab: Optional[LabData],
    meds: List[Medication],
) -> Dict[str, Any]:
    """
    Extract the key numeric values used for delta comparison.
    Stored in ai_sessions.snapshot_metadata JSONB.
    """
    return {
        "cr": _get_lab_val(lab, "biochemistry", "creatinine"),
        "wbc": _get_lab_val(lab, "hematology", "wbc"),
        "crp": _get_lab_val(lab, "inflammatory", "crp"),
        "lactate": _get_lab_val(lab, "blood_gas", "lactate"),
        "plt": _get_lab_val(lab, "hematology", "platelet"),
        "vasopressor_ne_dose": _vasopressor_ne_dose(meds),
    }


async def build_delta(
    patient_id: str,
    db: AsyncSession,
    snapshot_key_values: Dict[str, Any],
    snapshot_taken_at: Optional[str] = None,
) -> Optional[str]:
    """
    Compare current key values against stored snapshot values.
    Returns a delta string if significant changes detected; None otherwise.
    Only fires if snapshot is > 30 minutes old.
    """
    if snapshot_taken_at:
        try:
            taken_at = datetime.fromisoformat(snapshot_taken_at.replace("Z", "+00:00"))
            age_minutes = (datetime.now(timezone.utc) - taken_at).total_seconds() / 60
            if age_minutes < 30:
                return None
        except Exception:
            pass

    # Keep this sequential on the request AsyncSession. This path runs only for
    # stale sessions (>30 min), and concurrent operations on one AsyncSession
    # can raise InvalidRequestError before SSE starts.
    lab = await _pkg._get_latest_lab(db, patient_id)
    meds = await _pkg._get_active_medications(db, patient_id)

    current = extract_snapshot_key_values(lab, meds)
    changes = []

    field_labels = {
        "cr": ("Cr", ""),
        "wbc": ("WBC", ""),
        "crp": ("CRP", ""),
        "lactate": ("Lac", ""),
        "plt": ("PLT", ""),
        "vasopressor_ne_dose": ("NE", "mcg/kg/min"),
    }

    for key, (label, unit) in field_labels.items():
        old_val = snapshot_key_values.get(key)
        new_val = current.get(key)
        if new_val is None or old_val is None:
            continue
        try:
            old_f, new_f = float(old_val), float(new_val)
        except (TypeError, ValueError):
            continue
        if old_f == 0:
            continue
        pct = (new_f - old_f) / abs(old_f)
        if abs(pct) >= _TREND_THRESHOLD:
            arrow = "↑" if pct > 0 else "↓"
            unit_str = f" {unit}" if unit else ""
            changes.append(f"{label} {new_f}{arrow}（前次{old_f}）{unit_str}")

    if not changes:
        return None

    now_str = _now_taipei().strftime("%H:%M")
    delta_lines = [f"[資料更新 {now_str}（台北）]"]
    delta_lines.append(" | ".join(changes))
    delta_lines.append("---")
    return "\n".join(delta_lines)
