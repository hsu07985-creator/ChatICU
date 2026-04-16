"""Manual HIS sync trigger — see docs/his-sync-end-to-end-tutorial.md.

This endpoint spawns the same wrapper script that launchd runs, so the button
in the UI produces byte-identical behaviour to a scheduled tick (same env
loading, same state file, same process isolation). It is intentionally gated
by a header token AND by the presence of the `patient/` folder on disk, so
that deploying this router to Railway (where the folder does not exist) is a
no-op rather than a footgun.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from app.config import settings
from app.utils.response import success_response

router = APIRouter(prefix="/admin", tags=["admin-his-sync"])
logger = logging.getLogger(__name__)

# backend/app/routers/admin_his_sync.py → backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_WRAPPER_SCRIPT = _BACKEND_ROOT / "scripts" / "run_his_snapshot_sync.sh"
_PATIENT_BASE = _BACKEND_ROOT.parent / "patient"

# Single-flight lock: rejects the second click while the first is still running.
_sync_lock = asyncio.Lock()

# Parse the "--- Summary ---" block emitted by sync_his_snapshots.py
_SUMMARY_LINE_RE = re.compile(
    r"forced=(\d+),\s*new=(\d+),\s*changed=(\d+),\s*"
    r"timestamp-only=(\d+),\s*unchanged=(\d+),\s*synced=(\d+)"
)
_ERRORS_LINE_RE = re.compile(r"errors=(\d+)")
# Max runtime for one manual sync — 14 patients × ~30s + headroom.
_SYNC_TIMEOUT_SECONDS = 15 * 60


def _parse_summary(stdout: str) -> dict:
    """Pull the counters out of the script's stdout summary block."""
    counts = {
        "forced": 0,
        "new": 0,
        "changed": 0,
        "timestamp_only": 0,
        "unchanged": 0,
        "synced": 0,
        "errors": 0,
    }
    if match := _SUMMARY_LINE_RE.search(stdout):
        (
            counts["forced"],
            counts["new"],
            counts["changed"],
            counts["timestamp_only"],
            counts["unchanged"],
            counts["synced"],
        ) = (int(v) for v in match.groups())
    if match := _ERRORS_LINE_RE.search(stdout):
        counts["errors"] = int(match.group(1))
    return counts


def _check_enabled() -> None:
    if not settings.ADMIN_SYNC_TOKEN:
        raise HTTPException(
            status_code=503,
            detail=(
                "Manual HIS sync is disabled on this host. "
                "Set ADMIN_SYNC_TOKEN in backend/.env to enable."
            ),
        )
    if not _PATIENT_BASE.is_dir():
        raise HTTPException(
            status_code=503,
            detail=(
                f"patient/ folder not found at {_PATIENT_BASE}. "
                "Manual sync requires HIS export data on local disk."
            ),
        )
    if not _WRAPPER_SCRIPT.is_file():
        raise HTTPException(
            status_code=503,
            detail=f"Wrapper script missing: {_WRAPPER_SCRIPT}",
        )


def _check_token(x_admin_token: Optional[str]) -> None:
    if not x_admin_token or x_admin_token != settings.ADMIN_SYNC_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")


@router.post("/his-sync")
async def trigger_his_sync(
    force: bool = Query(
        False,
        description="true → ignore hash gate, resync everything; "
        "false → only sync new/changed patients (classify_action default).",
    ),
    patient: Optional[str] = Query(
        None,
        description="Optional MRN to sync a single patient (e.g. 16312169).",
        pattern=r"^\d{1,16}$",
    ),
    x_admin_token: Optional[str] = Header(
        None,
        alias="X-Admin-Token",
        description="Shared secret from backend/.env ADMIN_SYNC_TOKEN.",
    ),
):
    """Trigger one run of the HIS snapshot sync (same as a launchd tick).

    Returns the parsed summary block plus raw stdout tail for debugging.
    Rejects concurrent requests with 409 while a previous run is in flight.
    """
    _check_enabled()
    _check_token(x_admin_token)

    if _sync_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="Another HIS sync is already running — please wait.",
        )

    async with _sync_lock:
        args: list[str] = [str(_WRAPPER_SCRIPT)]
        if force:
            args.append("--force")
        if patient:
            args.extend(["-p", patient])

        logger.info("Manual HIS sync triggered: force=%s patient=%s", force, patient)

        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(_BACKEND_ROOT),
        )

        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=_SYNC_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            logger.error("Manual HIS sync timed out after %ds", _SYNC_TIMEOUT_SECONDS)
            raise HTTPException(
                status_code=504,
                detail=f"HIS sync exceeded {_SYNC_TIMEOUT_SECONDS}s and was killed.",
            )

        stdout = stdout_b.decode("utf-8", errors="replace")
        stderr = stderr_b.decode("utf-8", errors="replace")
        counts = _parse_summary(stdout)
        success = proc.returncode == 0 and counts["errors"] == 0

        logger.info(
            "Manual HIS sync finished: rc=%s counts=%s", proc.returncode, counts
        )

        return success_response(
            data={
                "mode": "force" if force else "detect",
                "patient": patient,
                "success": success,
                "return_code": proc.returncode,
                "counts": counts,
                # Tail the logs so the UI can show what happened without
                # blowing up the response envelope on very large runs.
                "stdout_tail": stdout[-4000:],
                "stderr_tail": stderr[-2000:],
            }
        )
