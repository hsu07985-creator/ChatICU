"""Unit tests for app.services.duplicate_cache (Wave 4a).

Covers:
  * compute_medications_hash — deterministic, order-insensitive
  * hash differs when any (id, atc, status, updated_at) field differs
  * get_cached_duplicates — hit / miss semantics (hash + context)
  * refresh_patient_cache — writes a row that a subsequent get_* can read back
  * alerts_to_jsonb / jsonb_to_alerts — lossless roundtrip
  * invalidate_patient_cache — removes the row
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

import pytest
import pytest_asyncio

from app.models.medication import Medication
from app.models.patient import Patient
from app.services.duplicate_cache import (
    alerts_to_jsonb,
    compute_medications_hash,
    get_cached_duplicates,
    invalidate_patient_cache,
    jsonb_to_alerts,
    refresh_patient_cache,
)
from app.services.duplicate_detector import DuplicateAlert, DuplicateMember


# ── Helpers ──────────────────────────────────────────────────────────
_BASE_TIME = datetime(2026, 4, 22, 8, 0, tzinfo=timezone.utc)


def _mk_med(
    mid: str,
    *,
    atc: str = "A02BC01",
    status: str = "active",
    updated_at: datetime = _BASE_TIME,
    generic: str = "Omeprazole",
) -> Medication:
    """Build an (unpersisted) Medication ORM instance for hashing tests."""
    return Medication(
        id=mid,
        patient_id="pat_hash",
        name=generic,
        generic_name=generic,
        status=status,
        atc_code=atc,
        updated_at=updated_at,
    )


def _mk_alert(
    *,
    fp: str = "fp_test_001",
    level: str = "critical",
    mechanism: str = "PPI × PPI",
    member_ids: List[str] = None,
) -> DuplicateAlert:
    members = [
        DuplicateMember(
            medication_id=mid,
            generic_name=f"Drug-{mid}",
            atc_code="A02BC01",
            route="PO",
            is_prn=False,
            last_admin_at=_BASE_TIME,
        )
        for mid in (member_ids or ["med_1", "med_2"])
    ]
    return DuplicateAlert(
        fingerprint=fp,
        level=level,  # type: ignore[arg-type]
        layer="L1",
        mechanism=mechanism,
        members=members,
        recommendation="Stop one PPI.",
        evidence_url="https://example.com/guide",
        auto_downgraded=False,
        downgrade_reason=None,
    )


# ── Shared DB fixtures (in-memory SQLite, provided by conftest.py) ────
@pytest_asyncio.fixture
async def seeded_patient(db_session):
    """Insert a minimal patient row so cache FK constraints are satisfied."""
    patient = Patient(
        id="pat_cache_001",
        name="Cache Test Patient",
        bed_number="Z-9",
        medical_record_number="99999",
        age=70,
        gender="男",
        diagnosis="test",
    )
    db_session.add(patient)
    await db_session.commit()
    return patient


# ── 1. compute_medications_hash ──────────────────────────────────────
class TestComputeHash:
    def test_deterministic_same_input(self):
        meds = [_mk_med("m1"), _mk_med("m2", atc="A02BC05")]
        assert compute_medications_hash(meds) == compute_medications_hash(meds)

    def test_order_insensitive(self):
        a = [_mk_med("m1"), _mk_med("m2", atc="A02BC05")]
        b = [_mk_med("m2", atc="A02BC05"), _mk_med("m1")]
        assert compute_medications_hash(a) == compute_medications_hash(b)

    def test_empty_list_stable(self):
        assert compute_medications_hash([]) == compute_medications_hash([])
        assert compute_medications_hash(None) == compute_medications_hash([])  # type: ignore[arg-type]

    def test_updated_at_changes_hash(self):
        base = [_mk_med("m1")]
        bumped = [_mk_med("m1", updated_at=_BASE_TIME + timedelta(hours=1))]
        assert compute_medications_hash(base) != compute_medications_hash(bumped)

    def test_atc_code_changes_hash(self):
        base = [_mk_med("m1", atc="A02BC01")]
        other = [_mk_med("m1", atc="A02BC02")]
        assert compute_medications_hash(base) != compute_medications_hash(other)

    def test_status_changes_hash(self):
        base = [_mk_med("m1", status="active")]
        stopped = [_mk_med("m1", status="discontinued")]
        assert compute_medications_hash(base) != compute_medications_hash(stopped)

    def test_id_changes_hash(self):
        base = [_mk_med("m1")]
        other = [_mk_med("m2")]
        assert compute_medications_hash(base) != compute_medications_hash(other)


# ── 2. JSONB roundtrip ───────────────────────────────────────────────
class TestJsonbRoundtrip:
    def test_single_alert_roundtrip(self):
        alert = _mk_alert()
        dumped = alerts_to_jsonb([alert])
        assert isinstance(dumped, list)
        assert isinstance(dumped[0], dict)

        restored = jsonb_to_alerts(dumped)
        assert len(restored) == 1
        r = restored[0]
        assert r.fingerprint == alert.fingerprint
        assert r.level == alert.level
        assert r.layer == alert.layer
        assert r.mechanism == alert.mechanism
        assert r.recommendation == alert.recommendation
        assert r.evidence_url == alert.evidence_url
        assert r.auto_downgraded == alert.auto_downgraded
        assert r.downgrade_reason == alert.downgrade_reason

        assert len(r.members) == len(alert.members)
        for rm, om in zip(r.members, alert.members):
            assert rm.medication_id == om.medication_id
            assert rm.generic_name == om.generic_name
            assert rm.atc_code == om.atc_code
            assert rm.route == om.route
            assert rm.is_prn == om.is_prn
            assert rm.last_admin_at == om.last_admin_at

    def test_multi_alert_preserves_order_and_count(self):
        alerts = [
            _mk_alert(fp="fp_a", level="critical"),
            _mk_alert(fp="fp_b", level="high", member_ids=["m3", "m4"]),
            _mk_alert(fp="fp_c", level="moderate", member_ids=["m5", "m6"]),
        ]
        restored = jsonb_to_alerts(alerts_to_jsonb(alerts))
        assert [a.fingerprint for a in restored] == ["fp_a", "fp_b", "fp_c"]
        assert [a.level for a in restored] == ["critical", "high", "moderate"]

    def test_malformed_rows_skipped(self):
        # Completely non-dict rows get quietly dropped; real dicts survive.
        mixed = [None, "garbage", 42, {"fingerprint": "ok", "members": []}]
        restored = jsonb_to_alerts(mixed)  # type: ignore[arg-type]
        assert len(restored) == 1
        assert restored[0].fingerprint == "ok"


# ── 3. Cache hit / miss / refresh / invalidate ──────────────────────
class TestCacheIntegration:
    @pytest.mark.asyncio
    async def test_miss_when_no_row(self, db_session, seeded_patient):
        meds = [_mk_med("m1")]
        out = await get_cached_duplicates(
            db_session, seeded_patient.id, meds, "inpatient"
        )
        assert out is None

    @pytest.mark.asyncio
    async def test_refresh_then_hit(self, db_session, seeded_patient):
        # Use an empty med list so the detector returns [] (no seed data needed).
        alerts, counts = await refresh_patient_cache(
            db_session, seeded_patient.id, [], "inpatient"
        )
        assert alerts == []
        assert counts == {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}

        hit = await get_cached_duplicates(
            db_session, seeded_patient.id, [], "inpatient"
        )
        assert hit is not None
        hit_alerts, hit_counts = hit
        assert hit_alerts == []
        assert hit_counts["critical"] == 0

    @pytest.mark.asyncio
    async def test_hash_mismatch_misses(self, db_session, seeded_patient):
        # Seed cache with one meds-set.
        meds_a = [_mk_med("m1")]
        await refresh_patient_cache(db_session, seeded_patient.id, meds_a, "inpatient")

        # Different meds-set (new med appears) → hash changes → miss.
        meds_b = meds_a + [_mk_med("m2", atc="A02BC05")]
        out = await get_cached_duplicates(
            db_session, seeded_patient.id, meds_b, "inpatient"
        )
        assert out is None

    @pytest.mark.asyncio
    async def test_context_mismatch_misses(self, db_session, seeded_patient):
        meds = [_mk_med("m1")]
        await refresh_patient_cache(db_session, seeded_patient.id, meds, "inpatient")

        # Hash identical, context differs → must miss (discharge rules differ).
        out = await get_cached_duplicates(
            db_session, seeded_patient.id, meds, "discharge"
        )
        assert out is None

    @pytest.mark.asyncio
    async def test_invalidate_removes_row(self, db_session, seeded_patient):
        await refresh_patient_cache(db_session, seeded_patient.id, [], "inpatient")
        # Sanity — cache hits.
        assert (
            await get_cached_duplicates(db_session, seeded_patient.id, [], "inpatient")
        ) is not None

        await invalidate_patient_cache(db_session, seeded_patient.id)

        assert (
            await get_cached_duplicates(db_session, seeded_patient.id, [], "inpatient")
        ) is None

    @pytest.mark.asyncio
    async def test_refresh_upserts_same_row(self, db_session, seeded_patient):
        """Calling refresh twice must UPDATE, not INSERT a duplicate PK."""
        await refresh_patient_cache(db_session, seeded_patient.id, [], "inpatient")
        # Second refresh should not raise (PK conflict) and must still be readable.
        await refresh_patient_cache(db_session, seeded_patient.id, [], "inpatient")
        hit = await get_cached_duplicates(
            db_session, seeded_patient.id, [], "inpatient"
        )
        assert hit is not None
