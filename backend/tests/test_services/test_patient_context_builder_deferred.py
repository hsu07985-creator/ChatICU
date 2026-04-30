"""B15 fast-test hardening — patient_context_builder critical/deferred split.

Locks 4 invariants of the B15-A1 + A1.1 dormant flag-gated path so a
future refactor can't silently regress the chat first-turn snapshot
contract:

  1. Flag OFF → legacy `build_clinical_snapshot` produces the full
     snapshot with vent / reports / scores embedded inline.
  2. Flag ON  → `build_critical_snapshot` excludes the deferred
     sections (vent / reports / scores) regardless of fetcher output.
  3. Deferred ready → ephemeral injection into user_message; the
     `system_prompt` returned to the LLM is byte-stable across the
     deferred-pending → deferred-ready transition (OpenAI prompt-cache
     prefix invariant).
  4. Duplicate warnings stay in the critical snapshot — never punted
     to the background deferred fill (medication-safety contract).

No DB, no LLM, no FastAPI client — fetchers are monkeypatched to return
canned ORM-shaped stand-ins in milliseconds.

Companion: `tests/test_api/test_chat_snapshot_deferred.py` covers the
`ai_chat` helper invariants in isolation; this file extends coverage to
the end-to-end snapshot text shape the helpers feed on.
"""
from __future__ import annotations

import hashlib

import pytest

from app.config import settings
from app.routers.ai_chat import (
    _build_system_prompt,
    _maybe_inject_deferred_into_user_message,
)
from app.services import patient_context_builder as pcb


# ---------------------------------------------------------------------------
# Lightweight ORM stand-ins
# ---------------------------------------------------------------------------


class _FakePatient:
    def __init__(self, **kw):
        defaults = dict(
            id="pat_x", name="許先生", age=65, gender="M", bed_number="I-1",
            diagnosis="ICH", intubated=False, has_dnr=False,
            allergies=None, alerts=None,
            icu_admission_date=None, ventilator_days=None, unit=None,
        )
        defaults.update(kw)
        for k, v in defaults.items():
            setattr(self, k, v)


class _FakeMed:
    def __init__(self, mid, **kw):
        defaults = dict(
            id=mid, name=None, generic_name=None, dose=None, unit=None,
            frequency=None, route=None, status="active",
            san_category=None, is_external=False, source_type=None,
        )
        defaults.update(kw)
        for k, v in defaults.items():
            setattr(self, k, v)


class _FakeVital:
    def __init__(self, **kw):
        defaults = dict(
            timestamp=None, respiratory_rate=14, heart_rate=88, temperature=37.0,
            systolic_bp=120, diastolic_bp=70, mean_bp=85, spo2=98, cvp=None,
        )
        defaults.update(kw)
        for k, v in defaults.items():
            setattr(self, k, v)


class _FakeVent:
    def __init__(self, **kw):
        defaults = dict(mode="SIMV", fio2=40, peep=5, tidal_volume=None,
                        pip=None, compliance=None)
        defaults.update(kw)
        for k, v in defaults.items():
            setattr(self, k, v)


class _FakeReport:
    def __init__(self, **kw):
        defaults = dict(exam_date=None, exam_name="CT Brain",
                        report_type="imaging",
                        impression="post-op changes", body_text=None)
        defaults.update(kw)
        for k, v in defaults.items():
            setattr(self, k, v)


class _FakeScore:
    def __init__(self, score_type, value):
        self.score_type = score_type
        self.value = value
        self.timestamp = None


class _StubDb:
    """Minimal AsyncSession stand-in: only `await db.connection()` is used
    by build_clinical_snapshot / build_deferred_snapshot warm-up; all
    actual fetcher calls are monkeypatched."""

    async def connection(self):
        return None


class _StubSessionCtx:
    """Async context manager that build_critical_snapshot's _fresh() helper
    enters; the session it yields is never queried because the fetchers
    are patched to ignore their session argument."""

    async def __aenter__(self):
        return _StubDb()

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_fetchers(monkeypatch, **stubs):
    """Stub every async DB fetcher used by build_clinical_snapshot,
    build_critical_snapshot, and build_deferred_snapshot. Unspecified
    return values default to None / [] so unrelated sections render empty.
    """
    async def _patient(_db, _pid):              return stubs.get("patient")
    async def _lab(_db, _pid):                  return stubs.get("lab")
    async def _lab_before(_db, _pid, _ts):      return stubs.get("lab_before_24h")
    async def _meds(_db, _pid):                 return stubs.get("meds", [])
    async def _vital(_db, _pid):                return stubs.get("vitals")
    async def _vent(_db, _pid):                 return stubs.get("vent")
    async def _reports(_db, _pid, limit=3):     return stubs.get("reports", [])
    async def _scores(_db, _pid):               return stubs.get("scores", [])
    async def _dup(_db, _meds, context):        return stubs.get("duplicate_warnings", [])

    monkeypatch.setattr(pcb, "_get_patient", _patient)
    monkeypatch.setattr(pcb, "_get_latest_lab", _lab)
    monkeypatch.setattr(pcb, "_get_lab_before_24h", _lab_before)
    monkeypatch.setattr(pcb, "_get_active_medications", _meds)
    monkeypatch.setattr(pcb, "_get_latest_vital", _vital)
    monkeypatch.setattr(pcb, "_get_latest_vent", _vent)
    monkeypatch.setattr(pcb, "_get_recent_reports", _reports)
    monkeypatch.setattr(pcb, "_get_latest_scores", _scores)
    monkeypatch.setattr(pcb, "_safe_duplicate_warnings", _dup)
    # build_critical_snapshot opens fresh sessions per fetcher (B15-B);
    # patch the factory so no real connection is opened.
    monkeypatch.setattr("app.database.async_session", lambda: _StubSessionCtx())


# ---------------------------------------------------------------------------
# Section markers — change-detector for header text
# ---------------------------------------------------------------------------

_VENT_HEADER = "【呼吸器】"
_REPORTS_HEADER = "【影像/報告 最近3筆】"
_SCORES_HEADER = "【臨床評分】"
_DUP_HEADER = "[重複用藥警示（自動偵測）]"


# ---------------------------------------------------------------------------
# Invariant 1 — flag OFF: legacy snapshot embeds vent / reports / scores
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_legacy_snapshot_embeds_deferred_sections_when_flag_off(monkeypatch):
    """SNAPSHOT_DEFERRED_ENABLED=False → handler routes to
    build_clinical_snapshot. That function MUST embed vent / reports /
    scores inline (legacy single-shot behavior); if a refactor accidentally
    splits it, flag-OFF prod loses sections silently.
    """
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", False)

    _patch_fetchers(
        monkeypatch,
        patient=_FakePatient(id="pat_t1", intubated=True),
        vent=_FakeVent(mode="SIMV", fio2=40, peep=5),
        reports=[_FakeReport(exam_name="CT Brain", impression="post-op")],
        scores=[_FakeScore("rass", -1), _FakeScore("pain", 2)],
    )

    text = await pcb.build_clinical_snapshot("pat_t1", _StubDb())

    assert _VENT_HEADER in text, "legacy snapshot must include vent section"
    assert _REPORTS_HEADER in text, "legacy snapshot must include reports section"
    assert _SCORES_HEADER in text, "legacy snapshot must include scores section"
    assert "RASS" in text and "Pain" in text


# ---------------------------------------------------------------------------
# Invariant 2 — flag ON: critical snapshot excludes deferred sections
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_critical_snapshot_excludes_deferred_sections(monkeypatch):
    """build_critical_snapshot MUST exclude vent / reports / scores headers
    even when fetchers would return data. Those go to build_deferred_snapshot
    in a background task; injecting them into critical mutates the byte-stable
    system_prompt prefix and busts OpenAI prompt cache (canary measured
    cache_hit_ratio_p50 70% → 0%).
    """
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)

    _patch_fetchers(
        monkeypatch,
        patient=_FakePatient(id="pat_t2", intubated=True),
        # Provide deferred-section data; if a refactor wires these into
        # build_critical_snapshot's fetcher list, this test fires.
        vent=_FakeVent(mode="SIMV"),
        reports=[_FakeReport()],
        scores=[_FakeScore("rass", -1)],
    )

    text, _key_vals, deferred_meta = await pcb.build_critical_snapshot(
        "pat_t2", _StubDb()
    )

    assert _VENT_HEADER not in text
    assert _REPORTS_HEADER not in text
    assert _SCORES_HEADER not in text
    # And the metadata the handler uses to schedule deferred fill must mark
    # intubation so the bg task knows to fetch vent.
    assert deferred_meta == {"intubated": True}


# ---------------------------------------------------------------------------
# Invariant 3 — deferred ready: ephemeral injection, system_prompt unchanged
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deferred_ready_does_not_mutate_system_prompt(monkeypatch):
    """End-to-end A1.1 invariant: when deferred fill completes the
    system_prompt fed to the LLM is byte-identical to the deferred-pending
    state. Deferred bytes go into ephemeral user_message only — never the
    system prompt, never persisted history.
    """
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)

    _patch_fetchers(
        monkeypatch,
        patient=_FakePatient(id="pat_t3", intubated=True),
        vent=_FakeVent(mode="SIMV", fio2=40, peep=5),
        reports=[_FakeReport(exam_name="CT Brain", impression="post-op changes")],
        scores=[_FakeScore("rass", -1), _FakeScore("pain", 2)],
    )

    critical, _key_vals, _meta = await pcb.build_critical_snapshot(
        "pat_t3", _StubDb()
    )
    deferred = await pcb.build_deferred_snapshot(
        "pat_t3", _StubDb(), intubated=True
    )

    sp_pending = _build_system_prompt(critical)
    sp_ready = _build_system_prompt(critical)
    h_pending = hashlib.sha256(sp_pending.encode()).hexdigest()
    h_ready = hashlib.sha256(sp_ready.encode()).hexdigest()
    assert h_pending == h_ready, "system_prompt must be byte-stable across turns"

    # Sanity: deferred fill produced non-empty text (vent + reports + scores)
    assert deferred.strip(), "deferred snapshot fixture should be non-empty"
    assert _VENT_HEADER in deferred
    assert _REPORTS_HEADER in deferred
    assert _SCORES_HEADER in deferred

    # Deferred bytes never appear in system_prompt
    assert deferred not in sp_ready
    assert _REPORTS_HEADER not in sp_ready

    # When status flips to ready, deferred lands in user_message only
    meta_ready = {
        "deferred_status": "ready",
        "clinical_snapshot_deferred": deferred,
    }
    msg = _maybe_inject_deferred_into_user_message("K 多少?", meta_ready)
    assert deferred in msg
    assert "[使用者提問]" in msg
    assert msg.rstrip().endswith("K 多少?")


# ---------------------------------------------------------------------------
# Invariant 4 — duplicate warnings stay in critical, never deferred
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_duplicate_warnings_stay_in_critical_not_deferred(monkeypatch):
    """Wave-3 medication-safety contract: duplicate warnings must be
    visible to the LLM on the first-turn snapshot. They must NOT be
    moved into build_deferred_snapshot, otherwise the LLM might recommend
    a duplicate-incompatible plan before the background fill catches up.
    """
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)

    fake_warnings = [
        {
            "level": "high",
            "layer": "L2",
            "mechanism": "duplicate PPI",
            "members": ["Omeprazole", "Esomeprazole"],
            "recommendation": "選一個即可",
            "auto_downgraded": False,
        }
    ]
    _patch_fetchers(
        monkeypatch,
        patient=_FakePatient(id="pat_t4", unit="ICU"),
        meds=[
            _FakeMed("m1", generic_name="Omeprazole"),
            _FakeMed("m2", generic_name="Esomeprazole"),
        ],
        # Populate deferred fetchers too — invariant must hold even when
        # those return data (rules out "deferred is empty so test passes").
        reports=[_FakeReport()],
        scores=[_FakeScore("rass", -1)],
        duplicate_warnings=fake_warnings,
    )

    critical, _key_vals, _meta = await pcb.build_critical_snapshot(
        "pat_t4", _StubDb()
    )
    deferred = await pcb.build_deferred_snapshot(
        "pat_t4", _StubDb(), intubated=False
    )

    # Critical must surface the duplicate warning
    assert _DUP_HEADER in critical, "duplicate warnings missing from critical"
    assert "Omeprazole" in critical and "Esomeprazole" in critical

    # Deferred must NOT contain duplicate-warning bytes — neither header
    # nor member names should leak via the deferred path.
    assert _DUP_HEADER not in deferred
    assert "Omeprazole" not in deferred
    assert "Esomeprazole" not in deferred
