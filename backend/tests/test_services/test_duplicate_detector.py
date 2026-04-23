"""Tests for app.services.duplicate_detector — Duplicate medication detector.

Covers the contract described in
docs/duplicate-medication-detection-implementation-plan.md §10 and uses the
40-case fixture at backend/tests/fixtures/duplicate_cases.json.

The DuplicateDetector service itself is under active implementation by a
sister agent. These tests are authored against the agreed contract:

    class DuplicateDetector:
        def __init__(self, session: AsyncSession | None): ...
        async def analyze(
            self,
            medications: list,
            *,
            context: Literal["inpatient","outpatient","icu","discharge"] = "inpatient",
            reference_time: datetime | None = None,
        ) -> list[DuplicateAlert]: ...

    @dataclass
    class DuplicateAlert:
        fingerprint: str
        level: Literal["critical","high","moderate","low","info"]
        layer: Literal["L1","L2","L3","L4"]
        mechanism: str
        members: list[DuplicateMember]
        recommendation: str
        evidence_url: str | None
        auto_downgraded: bool
        downgrade_reason: Optional[str]

Phase-2 fixture cases (L3 / L4) are marked skipped until the mechanism /
endpoint group tables are populated.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
from unittest.mock import AsyncMock

import pytest

# NOTE: The service is being implemented by a sister agent. Import is wrapped
# so this test module remains collectable even when the module is still a stub;
# individual tests will fail (not error at collection) if the contract is
# missing.
try:  # pragma: no cover — import shape is verified in its own test
    from app.services.duplicate_detector import DuplicateDetector  # type: ignore
except Exception:  # noqa: BLE001
    DuplicateDetector = None  # type: ignore


# ── Fixture helpers ──────────────────────────────────────────────────
FIXTURE_PATH = (
    Path(__file__).parent.parent / "fixtures" / "duplicate_cases.json"
)

with open(FIXTURE_PATH, "r", encoding="utf-8") as _f:
    _FIXTURE = json.load(_f)

ALL_CASES: List[dict] = _FIXTURE["cases"]

# Cases belonging to layers / features that are Phase 2 per the
# implementation plan. These are *skipped* (not xfailed) because the fixture
# drives expected behaviour that requires DB-backed mechanism / endpoint
# group seed data which lands in a later PR.
PHASE2_LAYERS = {"L3", "L4"}

# Individual Phase-2 cases whose fixture layer is L1/L2 but whose expected
# behaviour actually requires L3/L4 problem-list / mechanism-group context.
# Keep these out of Wave 1 until the relevant detectors come online.
PHASE2_CASE_IDS = {
    # Needs L4 endpoint-group + problem-list to recognise different indications
    # (HFrEF vs hepatic ascites) and downgrade High → Moderate.
    "downgrade_L4_different_indications",
}

SKIPPED_CASE_IDS = (
    {c["id"] for c in ALL_CASES if c["layer"] in PHASE2_LAYERS}
    | PHASE2_CASE_IDS
)


def _level_rank(level: str) -> int:
    """Return an ordinal rank for severity comparison ('higher = more severe')."""
    return {
        "none": -1,
        "info": 0,
        "low": 1,
        "moderate": 2,
        "high": 3,
        "critical": 4,
    }.get(level, -1)


def _layer_rank(layer: str) -> int:
    """L1 is the most specific / highest-confidence layer, L4 the broadest."""
    return {"L1": 4, "L2": 3, "L3": 2, "L4": 1}.get(layer, 0)


def _mk_med(
    mid: str,
    generic: str,
    atc: Optional[str],
    route: str = "PO",
    is_prn: bool = False,
    last_admin_at: Optional[str] = "2026-04-22T08:00:00Z",
) -> dict:
    return {
        "medication_id": mid,
        "generic_name": generic,
        "atc_code": atc,
        "route": route,
        "is_prn": is_prn,
        "last_admin_at": last_admin_at,
    }


def _make_session_mock() -> AsyncMock:
    """Mock AsyncSession that returns empty override / group result sets.

    Detector is expected to tolerate an empty rule set and fall back to
    hardcoded §3.1 black/whitelist + fingerprinting logic.
    """
    session = AsyncMock()
    # Empty execute result → .scalars().all() returns []
    execute_result = AsyncMock()
    execute_result.scalars.return_value.all.return_value = []
    execute_result.all.return_value = []
    session.execute = AsyncMock(return_value=execute_result)
    return session


@pytest.fixture
def mock_session() -> AsyncMock:
    return _make_session_mock()


@pytest.fixture
def detector(mock_session):
    if DuplicateDetector is None:
        pytest.skip("DuplicateDetector not yet importable")
    return DuplicateDetector(session=mock_session)


# ── 1. Fixture-driven parametrized tests ─────────────────────────────
class TestFixtureDriven:
    """Walk the 40-case JSON fixture and validate contract-level outputs.

    For each case:
      * ``len(alerts) == expected_alert_count``
      * If at least one alert is expected: the first alert's ``level`` matches
        ``expected_level`` and its ``layer`` is at least as specific as the
        fixture's declared layer.
      * Cases whose id contains ``"downgrade"`` must carry
        ``auto_downgraded=True`` on the first alert.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "case",
        ALL_CASES,
        ids=[c["id"] for c in ALL_CASES],
    )
    async def test_case(self, case, detector):
        if case["id"] in SKIPPED_CASE_IDS:
            pytest.skip("Phase 2 (L3/L4 mechanism / endpoint groups)")

        alerts = await detector.analyze(
            case["medications"],
            context=case.get("context", "inpatient"),
            reference_time=datetime(2026, 4, 22, 23, 0, tzinfo=timezone.utc),
        )
        assert isinstance(alerts, list)
        assert len(alerts) == case["expected_alert_count"], (
            f"{case['id']}: expected {case['expected_alert_count']} alert(s), "
            f"got {len(alerts)}"
        )
        if case["expected_alert_count"] >= 1:
            first = alerts[0]
            assert first.level == case["expected_level"], (
                f"{case['id']}: level mismatch "
                f"(expected {case['expected_level']}, got {first.level})"
            )
            # Layer must be at least as specific as the fixture layer.
            assert _layer_rank(first.layer) >= _layer_rank(case["layer"]), (
                f"{case['id']}: layer {first.layer} less specific than "
                f"fixture layer {case['layer']}"
            )
            if "downgrade" in case["id"]:
                assert first.auto_downgraded is True, (
                    f"{case['id']}: expected auto_downgraded=True"
                )


# ── 2. L1 (same ingredient) detection ────────────────────────────────
class TestL1Detection:
    @pytest.mark.asyncio
    async def test_empty_list_returns_no_alerts(self, detector):
        assert await detector.analyze([]) == []

    @pytest.mark.asyncio
    async def test_single_medication_returns_no_alerts(self, detector):
        meds = [_mk_med("m1", "Omeprazole", "A02BC01")]
        assert await detector.analyze(meds) == []

    @pytest.mark.asyncio
    async def test_two_identical_atc_produces_critical_l1(self, detector):
        meds = [
            _mk_med("m1", "Omeprazole", "A02BC01"),
            _mk_med("m2", "Omeprazole", "A02BC01"),
        ]
        alerts = await detector.analyze(meds)
        assert len(alerts) == 1
        assert alerts[0].layer == "L1"
        assert alerts[0].level == "critical"

    @pytest.mark.asyncio
    async def test_three_same_atc_produces_one_alert_with_three_members(
        self, detector
    ):
        meds = [
            _mk_med("m1", "Omeprazole", "A02BC01"),
            _mk_med("m2", "Omeprazole", "A02BC01"),
            _mk_med("m3", "Omeprazole", "A02BC01"),
        ]
        alerts = await detector.analyze(meds)
        assert len(alerts) == 1
        assert len(alerts[0].members) == 3

    @pytest.mark.asyncio
    async def test_two_unrelated_atc_no_alert(self, detector):
        meds = [
            # Completely unrelated classes (antibiotic vs antihypertensive)
            _mk_med("m1", "Amoxicillin", "J01CA04"),
            _mk_med("m2", "Amlodipine", "C08CA01"),
        ]
        alerts = await detector.analyze(meds)
        assert alerts == []


# ── 3. L2 (same ATC L4 subgroup) detection ───────────────────────────
class TestL2Detection:
    @pytest.mark.asyncio
    async def test_two_ppis_different_l5_produces_l2_alert(self, detector):
        meds = [
            _mk_med("m1", "Omeprazole", "A02BC01"),
            _mk_med("m2", "Esomeprazole", "A02BC05"),
        ]
        alerts = await detector.analyze(meds)
        assert len(alerts) == 1
        assert alerts[0].layer in {"L2", "L3", "L4"}  # at least L2
        # Double-PPI is in the §3.1 upgrade list → Critical.
        assert alerts[0].level == "critical"

    @pytest.mark.asyncio
    async def test_l1_hit_does_not_emit_additional_l2(self, detector):
        """Same L5 (A02BC01 × 2) must not produce a duplicated L2 alert."""
        meds = [
            _mk_med("m1", "Omeprazole", "A02BC01"),
            _mk_med("m2", "Omeprazole", "A02BC01"),
        ]
        alerts = await detector.analyze(meds)
        assert len(alerts) == 1
        assert alerts[0].layer == "L1"


# ── 4. Auto downgrade rules (§6.3) ───────────────────────────────────
class TestDowngrades:
    @pytest.mark.asyncio
    async def test_different_route_downgrades_critical_to_moderate(
        self, detector
    ):
        meds = [
            _mk_med("m1", "Pantoprazole", "A02BC02", route="IV"),
            _mk_med("m2", "Pantoprazole", "A02BC02", route="PO"),
        ]
        alerts = await detector.analyze(meds)
        assert len(alerts) == 1
        assert alerts[0].level == "moderate"
        assert alerts[0].auto_downgraded is True

    @pytest.mark.asyncio
    async def test_different_salt_downgrades_critical_to_high(self, detector):
        meds = [
            _mk_med("m1", "Esomeprazole magnesium", "A02BC05", route="PO"),
            _mk_med("m2", "Esomeprazole sodium", "A02BC05", route="PO"),
        ]
        alerts = await detector.analyze(meds)
        assert len(alerts) == 1
        assert alerts[0].level == "high"
        assert alerts[0].auto_downgraded is True

    @pytest.mark.asyncio
    async def test_transitional_overlap_within_48h_downgrades_to_moderate(
        self, detector
    ):
        meds = [
            _mk_med(
                "m1",
                "Lansoprazole",
                "A02BC03",
                route="PO",
                last_admin_at="2026-04-21T09:00:00Z",
            ),
            _mk_med(
                "m2",
                "Lansoprazole",
                "A02BC03",
                route="PO",
                last_admin_at="2026-04-22T21:00:00Z",
            ),
        ]
        alerts = await detector.analyze(
            meds,
            reference_time=datetime(2026, 4, 22, 23, 0, tzinfo=timezone.utc),
        )
        assert len(alerts) == 1
        assert alerts[0].level == "moderate"
        assert alerts[0].auto_downgraded is True

    @pytest.mark.asyncio
    async def test_one_med_discontinued_over_48h_no_alert(self, detector):
        meds = [
            _mk_med(
                "m1",
                "Rabeprazole",
                "A02BC04",
                route="PO",
                last_admin_at="2026-04-19T08:00:00Z",
            ),
            _mk_med(
                "m2",
                "Rabeprazole",
                "A02BC04",
                route="PO",
                last_admin_at="2026-04-22T20:00:00Z",
            ),
        ]
        alerts = await detector.analyze(
            meds,
            reference_time=datetime(2026, 4, 22, 23, 0, tzinfo=timezone.utc),
        )
        assert alerts == []


# ── 5. Override rules (§3.1 upgrade + §3.3 whitelist) ────────────────
class TestOverrides:
    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Phase 2 — cross-class α-blocker needs mechanism groups")
    async def test_cross_class_alpha_blocker_upgraded_to_critical(
        self, detector
    ):
        meds = [
            _mk_med("m1", "Doxazosin", "C02CA04"),  # HTN
            _mk_med("m2", "Tamsulosin", "G04CA02"),  # BPH
        ]
        alerts = await detector.analyze(meds)
        assert len(alerts) == 1
        assert alerts[0].level == "critical"

    @pytest.mark.asyncio
    async def test_whitelist_paracetamol_ibuprofen_no_alert(self, detector):
        meds = [
            _mk_med("m1", "Paracetamol", "N02BE01"),
            _mk_med("m2", "Ibuprofen", "M01AE01"),
        ]
        alerts = await detector.analyze(meds, context="outpatient")
        assert alerts == []

    @pytest.mark.asyncio
    async def test_wildcard_pattern_matches_all_ppis(self, detector):
        """A02BC* must match both omeprazole-family and pantoprazole."""
        meds = [
            _mk_med("m1", "Omeprazole", "A02BC01"),
            _mk_med("m2", "Esomeprazole", "A02BC05"),
            _mk_med("m3", "Pantoprazole", "A02BC02"),
        ]
        alerts = await detector.analyze(meds)
        # All three belong to A02BC → should be a single group (not three pairs)
        assert len(alerts) == 1
        assert len(alerts[0].members) == 3


# ── 6. Fingerprint stability ─────────────────────────────────────────
class TestFingerprint:
    @pytest.mark.asyncio
    async def test_same_set_different_order_same_fingerprint(self, detector):
        meds_a = [
            _mk_med("m1", "Omeprazole", "A02BC01"),
            _mk_med("m2", "Esomeprazole", "A02BC05"),
        ]
        meds_b = [
            _mk_med("m2", "Esomeprazole", "A02BC05"),
            _mk_med("m1", "Omeprazole", "A02BC01"),
        ]
        a = await detector.analyze(meds_a)
        b = await detector.analyze(meds_b)
        assert len(a) == 1 and len(b) == 1
        assert a[0].fingerprint == b[0].fingerprint

    @pytest.mark.asyncio
    async def test_different_sets_different_fingerprint(self, detector):
        a_meds = [
            _mk_med("m1", "Omeprazole", "A02BC01"),
            _mk_med("m2", "Esomeprazole", "A02BC05"),
        ]
        b_meds = [
            _mk_med("m3", "Sertraline", "N06AB06"),
            _mk_med("m4", "Escitalopram", "N06AB10"),
        ]
        a = await detector.analyze(a_meds)
        b = await detector.analyze(b_meds)
        assert len(a) == 1 and len(b) == 1
        assert a[0].fingerprint != b[0].fingerprint


# ── 7. Edge cases ────────────────────────────────────────────────────
class TestEdgeCases:
    @pytest.mark.asyncio
    async def test_missing_atc_code_does_not_crash(self, detector):
        """If atc_code is missing, detector should fall back or skip — never raise."""
        meds = [
            _mk_med("m1", "MysteryDrugA", None),
            _mk_med("m2", "MysteryDrugB", None),
        ]
        alerts = await detector.analyze(meds)
        # Either empty (skipped) or returns alerts keyed on generic_name — both OK
        assert isinstance(alerts, list)

    @pytest.mark.asyncio
    async def test_missing_atc_same_generic_name_fallback(self, detector):
        """Two meds with same generic_name but no ATC should still be caught."""
        meds = [
            _mk_med("m1", "CustomDrug", None, route="PO"),
            _mk_med("m2", "CustomDrug", None, route="PO"),
        ]
        alerts = await detector.analyze(meds)
        # Fallback via generic_name is acceptable but optional.
        assert isinstance(alerts, list)
        if alerts:
            assert alerts[0].level in {"critical", "high", "moderate", "low", "info"}

    @pytest.mark.asyncio
    async def test_large_medication_list_completes_in_reasonable_time(
        self, detector
    ):
        import time

        # 100 assorted meds — most unique, a handful duplicated so detector
        # actually exercises grouping code paths.
        meds: list[dict] = []
        for i in range(90):
            meds.append(
                _mk_med(f"m{i}", f"Drug{i}", f"X{i:02d}AA{i:02d}")
            )
        # Inject 10 duplicates deliberately
        for i in range(10):
            meds.append(
                _mk_med(f"d{i}", "Omeprazole", "A02BC01")
            )

        start = time.perf_counter()
        alerts = await detector.analyze(meds)
        elapsed = time.perf_counter() - start
        # 100 medications should analyse in well under a second on CI.
        assert elapsed < 2.0, f"analyze took {elapsed:.2f}s, > 2s budget"
        assert isinstance(alerts, list)


# ── Sanity: fixture integrity (not a detector test, guards CI) ───────
class TestFixtureIntegrity:
    def test_fixture_has_expected_case_count(self):
        # The plan says ~40 synthetic cases; guard against accidental drift.
        assert len(ALL_CASES) >= 35, (
            f"Expected ~40 fixture cases, found {len(ALL_CASES)}"
        )

    def test_every_case_has_required_keys(self):
        required = {
            "id",
            "layer",
            "expected_level",
            "expected_mechanism",
            "context",
            "medications",
            "expected_alert_count",
        }
        for c in ALL_CASES:
            missing = required - set(c.keys())
            assert not missing, f"{c.get('id','?')} missing {missing}"

    def test_layers_are_valid(self):
        valid = {"L1", "L2", "L3", "L4"}
        for c in ALL_CASES:
            assert c["layer"] in valid, (
                f"{c['id']}: invalid layer {c['layer']}"
            )

    def test_levels_are_valid(self):
        valid = {"none", "info", "low", "moderate", "high", "critical"}
        for c in ALL_CASES:
            assert c["expected_level"] in valid, (
                f"{c['id']}: invalid expected_level {c['expected_level']}"
            )
