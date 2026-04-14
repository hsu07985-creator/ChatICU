from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.sync_status import SyncStatus
from app.models.user import User
from app.utils.response import success_response

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/status")
async def get_sync_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    del user
    result = await db.execute(
        select(SyncStatus).where(SyncStatus.key == "his_snapshots")
    )
    status = result.scalar_one_or_none()

    if status is None:
        return success_response(
            data={
                "available": False,
                "source": "his_snapshots",
                "version": None,
                "lastSyncedAt": None,
                "details": None,
            }
        )

    return success_response(
        data={
            "available": True,
            "source": status.source,
            "version": status.version,
            "lastSyncedAt": status.last_synced_at.isoformat() if status.last_synced_at else None,
            "details": status.details,
        }
    )
