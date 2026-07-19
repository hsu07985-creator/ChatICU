"""record_sync_heartbeat (C2, architecture-audit-2026-07-19).

Contract: every sync run writes details.last_run so /sync/status can tell
「有跑但沒變」from「排程根本沒跑」; version / last_synced_at are untouched
when the row already exists (no fake frontend delta refresh).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.fhir.snapshot_sync import GLOBAL_SYNC_STATUS_KEY, record_sync_heartbeat
from app.models.sync_status import SyncStatus

COUNTS = {"forced": 0, "new": 0, "changed": 0, "unchanged": 12, "timestamp-only": 0, "synced": 0}


async def _get_row(db_session):
    result = await db_session.execute(
        select(SyncStatus).where(SyncStatus.key == GLOBAL_SYNC_STATUS_KEY)
    )
    return result.scalar_one_or_none()


@pytest.mark.asyncio
async def test_heartbeat_creates_placeholder_row_on_fresh_db(db_session) -> None:
    await record_sync_heartbeat(db_session, COUNTS, errors=0)
    await db_session.commit()

    row = await _get_row(db_session)
    assert row is not None
    assert row.version == "heartbeat-only"
    assert row.details["last_run"]["counts"]["unchanged"] == 12
    assert row.details["last_run"]["errors"] == 0


@pytest.mark.asyncio
async def test_heartbeat_preserves_version_and_merges_details(db_session) -> None:
    db_session.add(
        SyncStatus(
            key=GLOBAL_SYNC_STATUS_KEY,
            source="his_snapshots",
            version="2026-07-19T06:00:00+00:00",
            last_synced_at=__import__("datetime").datetime(
                2026, 7, 19, 6, 0, tzinfo=__import__("datetime").timezone.utc
            ),
            details={"recent_deltas": [{"patient_id": "pat_001"}]},
        )
    )
    await db_session.commit()

    await record_sync_heartbeat(db_session, COUNTS, errors=1)
    await db_session.commit()
    db_session.expire_all()

    row = await _get_row(db_session)
    assert row.version == "2026-07-19T06:00:00+00:00"  # untouched
    assert row.details["recent_deltas"] == [{"patient_id": "pat_001"}]  # preserved
    assert row.details["last_run"]["errors"] == 1
