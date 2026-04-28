from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine_kwargs = {
    "echo": settings.DEBUG,
    "pool_pre_ping": True,
}

# asyncpg connect_args. Empty for SQLite; populated for PostgreSQL so that
# Supabase pooler (port 6543, transaction mode) works correctly. See
# docs/system-audit-2026-04-28.md §1.1.
connect_args: dict = {}

if settings.DATABASE_URL.startswith("postgresql"):
    # Disable asyncpg's prepared statement cache. PgBouncer-style transaction
    # pooling (Supabase 6543) routes successive transactions to different
    # server backends, but prepared statements are per-connection — keeping
    # the cache enabled produces DuplicatePreparedStatementError under load.
    # Harmless on direct connections (5432).
    connect_args = {
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
    }
    # Pool sizing: Supabase pooler enforces a per-client connection cap that
    # varies by plan and is shared across Railway replicas. The previous
    # pool_size=20+10 (= 30 conns/replica) could exhaust the cap with two
    # replicas. Slow endpoints (AI chat, external RAG) hold a session for
    # the full request, so watch Railway logs for QueuePool timeouts after
    # this change — see audit doc §1.0.
    engine_kwargs.update({
        "pool_size": 5,
        "max_overflow": 5,
    })

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
