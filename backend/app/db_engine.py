"""Shared async-engine factory — the single place that knows about the
Supabase 6543 transaction-mode pooler.

Deliberately imports nothing from app.config so that standalone scripts
(which load DATABASE_URL from .env.his-sync etc. themselves) can use it
without pulling in pydantic-settings validation.

PgBouncer-style transaction pooling routes successive transactions to
different server backends, but prepared statements are per-connection —
leaving asyncpg's cache enabled produces DuplicatePreparedStatementError
(or silently dropped writes) under load. Harmless on direct 5432 connections.
Every create_async_engine call in this repo must go through here.
"""
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

POOLER_CONNECT_ARGS = {
    "prepared_statement_cache_size": 0,
    "statement_cache_size": 0,
}


def create_pooled_engine(url: str, **overrides) -> AsyncEngine:
    """Build an async engine with pooler-safe connect_args applied.

    ``connect_args`` in overrides is merged on top of (not replacing) the
    pooler defaults, so callers can add e.g. command_timeout.
    """
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    connect_args = dict(POOLER_CONNECT_ARGS) if url.startswith("postgresql") else {}
    connect_args.update(overrides.pop("connect_args", {}))
    return create_async_engine(url, connect_args=connect_args, **overrides)
