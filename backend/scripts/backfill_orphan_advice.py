#!/usr/bin/env python3
"""Backfill ``PharmacyAdvice`` rows for bulletin-board messages whose VPN
tags were applied before migration 067 + the messages-router sync hook
were deployed.

Definition of "orphan" mirrors ``GET /pharmacy/advice-records/orphan-tag-stats``:

    a ``PatientMessage`` with at least one VPN-format tag (1-A … 4-W or
    legacy numeric 1-1 … 4-3) AND both ``advice_record_id IS NULL`` AND no
    ``PharmacyAdvice.source_message_id`` pointing back at it.

Only messages authored by a pharmacist or admin are backfilled — the
sync hook applies the same rule at write-time so running the script
won't retroactively create advice rows under a non-pharmacist author.

Idempotent: re-running on an already-backfilled DB is a no-op. Also safe
to run concurrently with live traffic because the sync helper deduplicates
by ``(source_message_id, advice_code)``.

Run:
    cd backend
    python3 -m scripts.backfill_orphan_advice              # apply
    python3 -m scripts.backfill_orphan_advice --dry-run    # preview only
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from typing import List, Tuple

from sqlalchemy import select

from app.database import async_session
from app.models.message import PatientMessage
from app.models.pharmacy_advice import PharmacyAdvice
from app.models.user import User
from app.routers.messages import _parse_vpn_tag, _sync_advices_from_message


async def _find_orphan_candidates(db) -> List[PatientMessage]:
    """Return messages with VPN tags + no linked advice in either direction."""
    # Messages with tags + no widget-path linkage.
    rows = await db.execute(
        select(PatientMessage).where(
            PatientMessage.tags.isnot(None),
            PatientMessage.advice_record_id.is_(None),
        )
    )
    candidates = rows.scalars().all()
    if not candidates:
        return []

    # Drop any that already have bulletin-sync advice rows.
    ids = [m.id for m in candidates]
    synced_rows = await db.execute(
        select(PharmacyAdvice.source_message_id)
        .where(PharmacyAdvice.source_message_id.in_(ids))
        .distinct()
    )
    synced = {mid for (mid,) in synced_rows.all() if mid}

    result = []
    for msg in candidates:
        if msg.id in synced:
            continue
        has_vpn = any(_parse_vpn_tag(t) for t in (msg.tags or []))
        if has_vpn:
            result.append(msg)
    return result


async def _run(dry_run: bool) -> Tuple[int, int, int]:
    """Returns (n_orphans_seen, n_messages_backfilled, n_advices_created)."""
    async with async_session() as db:
        orphans = await _find_orphan_candidates(db)
        if not orphans:
            return 0, 0, 0

        author_ids = {m.author_id for m in orphans}
        author_rows = await db.execute(
            select(User).where(User.id.in_(author_ids))
        )
        authors = {u.id: u for u in author_rows.scalars().all()}

        n_msgs_done = 0
        n_advices_total = 0

        for msg in orphans:
            author = authors.get(msg.author_id)
            if author is None or author.role not in ("pharmacist", "admin"):
                continue

            if dry_run:
                vpn_codes = sorted({
                    parsed[0]
                    for t in (msg.tags or [])
                    if (parsed := _parse_vpn_tag(t)) is not None
                })
                print(f"  would backfill {msg.id}  author={author.name} role={author.role}  codes={vpn_codes}")
                n_msgs_done += 1
                n_advices_total += len(vpn_codes)
                continue

            created, _deleted = await _sync_advices_from_message(msg, author, db)
            if created:
                n_msgs_done += 1
                n_advices_total += len(created)

        if not dry_run:
            await db.commit()

        return len(orphans), n_msgs_done, n_advices_total


def _parse_args():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dry-run", action="store_true", help="Preview without writing")
    return p.parse_args()


def main():
    args = _parse_args()
    n_orphans, n_msgs_done, n_advices = asyncio.run(_run(dry_run=args.dry_run))
    verb = "would backfill" if args.dry_run else "backfilled"
    print(f"orphans_seen={n_orphans}  messages_{verb}={n_msgs_done}  advices_created={n_advices}")
    if n_orphans and n_msgs_done == 0 and not args.dry_run:
        print("NOTE: orphans exist but none were backfilled — their authors aren't pharmacist/admin.")
        sys.exit(0)


if __name__ == "__main__":
    main()
