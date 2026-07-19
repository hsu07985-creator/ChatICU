#!/usr/bin/env python3
"""Smoke test for DuplicateDetector — bypasses HTTP auth and calls the
service directly against the local DB.

Run:
    cd backend
    python3 -m scripts.smoke_test_duplicates [patient_id] [context]

Defaults: patient_id=pat_87771189, context=icu
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Any, Dict, List

from sqlalchemy import select

from app.database import async_session
from app.models.medication import Medication
from app.services.duplicate_detector import DuplicateDetector


async def main(patient_id: str, context: str) -> None:
    async with async_session() as session:
        result = await session.execute(
            select(Medication).where(
                (Medication.patient_id == patient_id) & (Medication.status == "active")
            )
        )
        meds = list(result.scalars().all())
        print(f"patient_id={patient_id} context={context} active_meds={len(meds)}")

        detector = DuplicateDetector(session)
        alerts = await detector.analyze(meds, context=context)  # type: ignore[arg-type]

        counts: Dict[str, int] = {
            "critical": 0,
            "high": 0,
            "moderate": 0,
            "low": 0,
            "info": 0,
        }
        serialised: List[Dict[str, Any]] = []
        for a in alerts:
            counts[a.level] = counts.get(a.level, 0) + 1
            serialised.append(a.to_dict())

        envelope = {
            "success": True,
            "data": {
                "alerts": serialised,
                "counts": counts,
            },
        }
        print(json.dumps(envelope, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else "pat_87771189"
    ctx = sys.argv[2] if len(sys.argv) > 2 else "icu"
    asyncio.run(main(pid, ctx))
