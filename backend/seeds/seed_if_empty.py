"""
Seed helper for local/dev environments.

Runs the full datamock seeding only when the database has no users yet.
This keeps `docker compose up` idempotent while ensuring predictable test
accounts and demo data exist for UI and E2E.

Usage (recommended):
  SEED_PASSWORD_STRATEGY=username python -m seeds.seed_if_empty
"""

import asyncio

from sqlalchemy import func, select

from app.database import async_session
from app.models.user import User
from seeds import seed_data


async def _has_any_users() -> int:
    async with async_session() as session:
        result = await session.execute(select(func.count()).select_from(User))
        return int(result.scalar() or 0)


async def main() -> None:
    count = await _has_any_users()
    if count > 0:
        print(f"Seed skipped: users already exist (count={count}).")
        return

    print("Seeding database from datamock (first run)...")
    await seed_data.main()


if __name__ == "__main__":
    asyncio.run(main())

