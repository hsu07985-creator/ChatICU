"""Tests for the Wave 4b post-sync hook in ``scripts/sync_his_snapshots.py``.

Contract under test (per docs/duplicate-medication-integration-plan.md §6):

    async def post_sync_refresh_duplicates(
        session: AsyncSession,
        affected_patient_ids: set[str] | list[str],
    ) -> dict:
        # Failure-isolated: per-patient try/except; failures are logged
        # and counted but never raised to the caller.
        # Returns stats: {attempted, succeeded, failed, skipped_no_meds}

Key invariants verified here:
- ``refresh_patient_cache`` is invoked once per patient who has active meds.
- A patient with no active meds is counted as ``skipped_no_meds`` and does
  NOT trigger ``refresh_patient_cache``.
- A mid-loop failure for one patient does not abort the loop — subsequent
  patients are still processed, and stats reflect the partial success.
- The coroutine never raises; callers (HIS sync) rely on that contract.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure backend/ is importable so ``import scripts.sync_his_snapshots`` works
# when pytest is invoked from anywhere under the repo.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from scripts.sync_his_snapshots import post_sync_refresh_duplicates  # noqa: E402


# ── Test helpers ─────────────────────────────────────────────────────
def _make_session_mock(meds_by_patient: dict) -> MagicMock:
    """Build an AsyncSession stub whose ``execute(...)`` returns the meds
    keyed on ``patient_id`` in the query bind params.

    We inspect the SQLAlchemy ``select(Medication).where(...)`` statement by
    calling ``.compile()`` on it and reading ``params['patient_id_1']`` —
    that is how SQLAlchemy names the first bound literal for
    ``Medication.patient_id == pid``.
    """
    session = MagicMock()

    async def _execute(stmt, *args, **kwargs):
        compiled = stmt.compile()
        pid = compiled.params.get("patient_id_1")
        meds = meds_by_patient.get(pid, [])

        result = MagicMock()
        scalars = MagicMock()
        scalars.all.return_value = meds
        result.scalars.return_value = scalars
        return result

    session.execute = AsyncMock(side_effect=_execute)
    return session


def _fake_med(mid: str, patient_id: str) -> SimpleNamespace:
    """Tiny stand-in for an ORM ``Medication`` — the hook just passes these
    through to ``refresh_patient_cache`` without touching fields."""
    return SimpleNamespace(
        id=mid,
        patient_id=patient_id,
        status="active",
        generic_name=f"drug_{mid}",
    )


# ── Tests ─────────────────────────────────────────────────────────────
class TestPostSyncRefreshDuplicates:
    @pytest.mark.asyncio
    async def test_calls_refresh_for_each_patient(self):
        """Each patient with active meds should get exactly one cache
        refresh call, and stats should reflect full success."""
        meds = {
            "pat_A": [_fake_med("m1", "pat_A"), _fake_med("m2", "pat_A")],
            "pat_B": [_fake_med("m3", "pat_B")],
        }
        session = _make_session_mock(meds)

        refresh = AsyncMock(return_value=None)
        with patch(
            "app.services.duplicate_cache.refresh_patient_cache",
            refresh,
            create=True,
        ):
            stats = await post_sync_refresh_duplicates(
                session, ["pat_A", "pat_B"]
            )

        assert refresh.await_count == 2
        called_pids = {call.args[1] for call in refresh.await_args_list}
        assert called_pids == {"pat_A", "pat_B"}
        # Every call should pass context="inpatient" per plan §6.1
        for call in refresh.await_args_list:
            assert call.kwargs.get("context") == "inpatient"

        assert stats == {
            "attempted": 2,
            "succeeded": 2,
            "failed": 0,
            "skipped_no_meds": 0,
        }

    @pytest.mark.asyncio
    async def test_one_patient_failure_does_not_stop_others(self):
        """If refresh_patient_cache raises for pat_A, pat_B and pat_C must
        still run to completion and stats must account for the split."""
        meds = {
            "pat_A": [_fake_med("m1", "pat_A")],
            "pat_B": [_fake_med("m2", "pat_B")],
            "pat_C": [_fake_med("m3", "pat_C")],
        }
        session = _make_session_mock(meds)

        async def _refresh(session_arg, pid, meds_list, context="inpatient"):
            if pid == "pat_A":
                raise RuntimeError("boom — cache write failed")
            return None

        refresh = AsyncMock(side_effect=_refresh)
        with patch(
            "app.services.duplicate_cache.refresh_patient_cache",
            refresh,
            create=True,
        ):
            stats = await post_sync_refresh_duplicates(
                session, ["pat_A", "pat_B", "pat_C"]
            )

        assert refresh.await_count == 3
        assert stats == {
            "attempted": 3,
            "succeeded": 2,
            "failed": 1,
            "skipped_no_meds": 0,
        }

    @pytest.mark.asyncio
    async def test_patient_with_no_meds_is_skipped(self):
        """A patient whose active-meds query returns an empty list is
        counted as skipped and must not trigger refresh."""
        meds = {
            "pat_A": [_fake_med("m1", "pat_A")],
            "pat_EMPTY": [],  # active-meds query returns nothing
        }
        session = _make_session_mock(meds)

        refresh = AsyncMock(return_value=None)
        with patch(
            "app.services.duplicate_cache.refresh_patient_cache",
            refresh,
            create=True,
        ):
            stats = await post_sync_refresh_duplicates(
                session, ["pat_A", "pat_EMPTY"]
            )

        assert refresh.await_count == 1
        assert refresh.await_args_list[0].args[1] == "pat_A"

        assert stats == {
            "attempted": 2,
            "succeeded": 1,
            "failed": 0,
            "skipped_no_meds": 1,
        }

    @pytest.mark.asyncio
    async def test_empty_input_returns_zero_stats(self):
        """No patients → no DB queries, no refresh calls, zeroed stats."""
        session = _make_session_mock({})

        refresh = AsyncMock(return_value=None)
        with patch(
            "app.services.duplicate_cache.refresh_patient_cache",
            refresh,
            create=True,
        ):
            stats = await post_sync_refresh_duplicates(session, set())

        assert refresh.await_count == 0
        assert session.execute.await_count == 0
        assert stats == {
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped_no_meds": 0,
        }

    @pytest.mark.asyncio
    async def test_db_query_failure_is_isolated(self):
        """If the ``SELECT Medication`` itself raises (e.g. connection
        error mid-loop), that counts as ``failed`` and the loop moves on."""
        session = MagicMock()

        call_pids: list = []

        async def _execute(stmt, *args, **kwargs):
            compiled = stmt.compile()
            pid = compiled.params.get("patient_id_1")
            call_pids.append(pid)
            if pid == "pat_BAD":
                raise RuntimeError("DB gone away")
            result = MagicMock()
            scalars = MagicMock()
            scalars.all.return_value = [_fake_med("m1", pid)]
            result.scalars.return_value = scalars
            return result

        session.execute = AsyncMock(side_effect=_execute)

        refresh = AsyncMock(return_value=None)
        with patch(
            "app.services.duplicate_cache.refresh_patient_cache",
            refresh,
            create=True,
        ):
            stats = await post_sync_refresh_duplicates(
                session, ["pat_BAD", "pat_OK"]
            )

        # Both patients were attempted; DB failure counts as failed.
        assert call_pids == ["pat_BAD", "pat_OK"]
        # Only pat_OK should have triggered a refresh.
        assert refresh.await_count == 1
        assert refresh.await_args_list[0].args[1] == "pat_OK"
        assert stats == {
            "attempted": 2,
            "succeeded": 1,
            "failed": 1,
            "skipped_no_meds": 0,
        }
