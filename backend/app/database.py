from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings
from app.db_engine import create_pooled_engine

engine_kwargs = {
    "echo": settings.DEBUG,
    "pool_pre_ping": True,
}

if settings.DATABASE_URL.startswith("postgresql"):
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

# Pooler connect_args (prepared-statement cache off) live in app.db_engine —
# the shared factory every script/seed must also use.
engine = create_pooled_engine(settings.DATABASE_URL, **engine_kwargs)

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
