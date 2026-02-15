"""Backend test fixtures — async SQLite in-memory DB + httpx AsyncClient."""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app
from app.models import *  # noqa: F401, F403  — register all models
from app.models.user import User
from app.utils.security import hash_password

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


# ── JSONB → JSON for SQLite ──────────────────────────────────────────
# Replace JSONB columns with JSON before table creation so SQLite can handle them.
def _remap_jsonb_to_json():
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()


@pytest_asyncio.fixture
async def db_engine():
    _remap_jsonb_to_json()
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def seeded_db(db_session):
    """Seed a test user and patient for API tests."""
    from app.models.patient import Patient

    user = User(
        id="usr_test",
        name="Test Doctor",
        username="testdoc",
        password_hash=hash_password("testpass"),
        email="test@hospital.com",
        role="admin",
        unit="ICU",
        active=True,
    )
    patient = Patient(
        id="pat_001",
        name="張三",
        bed_number="I-1",
        medical_record_number="123456",
        age=65,
        gender="男",
        diagnosis="重度肺炎併呼吸衰竭",
        intubated=False,
        critical_status="嚴重",
        ventilator_days=6,
    )
    db_session.add(user)
    db_session.add(patient)
    await db_session.commit()
    yield db_session


@pytest_asyncio.fixture
async def client(seeded_db, db_engine):
    """Async test client with DB and auth overrides."""
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    # Mock auth to skip Redis + JWT
    async def override_get_current_user():
        return User(
            id="usr_test",
            name="Test Doctor",
            username="testdoc",
            password_hash="",
            email="test@hospital.com",
            role="admin",
            unit="ICU",
            active=True,
        )

    from app.middleware.auth import get_current_user
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
