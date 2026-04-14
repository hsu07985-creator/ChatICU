from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.sync_status import SyncStatus


@pytest.mark.asyncio
async def test_sync_status_returns_available_false_when_missing(mock_auth_client):
    response = await mock_auth_client.get("/sync/status")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["available"] is False
    assert body["data"]["version"] is None


@pytest.mark.asyncio
async def test_sync_status_returns_latest_db_metadata(mock_auth_client, db_engine):
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        session.add(
            SyncStatus(
                key="his_snapshots",
                source="his_snapshots",
                version="2026-04-14T00:00:00+00:00",
                last_synced_at=datetime(2026, 4, 14, tzinfo=timezone.utc),
                details={"patient_mrn": "16312169"},
            )
        )
        await session.commit()

    response = await mock_auth_client.get("/sync/status")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["available"] is True
    assert body["data"]["source"] == "his_snapshots"
    assert body["data"]["version"] == "2026-04-14T00:00:00+00:00"
    assert body["data"]["details"]["patient_mrn"] == "16312169"
