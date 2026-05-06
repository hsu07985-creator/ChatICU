"""Backend test fixtures — async SQLite in-memory DB + httpx AsyncClient."""

from __future__ import annotations

import re

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.middleware.auth as auth_middleware
import app.routers.auth as auth_router
from app.database import Base, get_db
from app.main import app
from app.models import *  # noqa: F401, F403  — register all models
from app.models.user import User
# Workaround: bcrypt 4.x removed __about__ and changed hashpw to reject >72 bytes,
# breaking passlib's wrap-bug detection on Python 3.14. Patch before passlib loads.
import bcrypt as _bcrypt
_orig_hashpw = _bcrypt.hashpw
def _safe_hashpw(password, salt):
    if isinstance(password, (bytes, bytearray)) and len(password) > 72:
        password = password[:72]
    return _orig_hashpw(password, salt)
_bcrypt.hashpw = _safe_hashpw

from app.utils.security import hash_password

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


# ── JSONB → JSON for SQLite ──────────────────────────────────────────
# Replace JSONB columns with JSON before table creation so SQLite can handle them.
def _remap_jsonb_to_json():
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()


def _sqlite_regexp(pattern, value):
    """SQLite REGEXP UDF: case-insensitive, with Postgres \\m/\\M translated to \\b.

    Production runs on Postgres where ``Column.regexp_match(p, flags='i')``
    compiles to ``column ~* p`` and the boundary anchors ``\\m`` / ``\\M`` are
    POSIX regex. SQLite's REGEXP is whatever Python ``re`` understands, which
    uses ``\\b`` for the same semantics. We translate at match time so the
    application code can keep one canonical pattern shape.

    Defensive: returns False on any error so a malformed pattern never crashes
    the test suite — it just yields zero matches (same observable behavior as a
    pattern that matches nothing in production).
    """
    try:
        if value is None or pattern is None:
            return False
        py_pattern = str(pattern).replace(r"\m", r"\b").replace(r"\M", r"\b")
        return re.search(py_pattern, str(value), re.IGNORECASE) is not None
    except Exception:
        return False


def _register_sqlite_regexp(dbapi_connection, _connection_record):
    """Attach REGEXP UDF on aiosqlite's worker thread.

    aiosqlite owns a worker thread that holds the sqlite3.Connection; calling
    ``create_function`` from outside that thread raises a ProgrammingError
    ("SQLite objects created in a thread can only be used in that same thread").
    The right entry-point is ``aiosqlite.core.Connection.create_function``,
    which is async and dispatches to the worker. Inside SQLAlchemy's connect
    event we're running in a greenlet that can ``await_only`` on coroutines.
    """
    from sqlalchemy.util import await_only  # local import to avoid global cost

    aio_conn = getattr(dbapi_connection, "_connection", None)
    if aio_conn is None:
        return
    create_function = getattr(aio_conn, "create_function", None)
    if create_function is None:
        return
    try:
        # ``create_function`` returns a coroutine in aiosqlite. await it so the
        # underlying sqlite3 worker registers REGEXP for this connection only.
        await_only(create_function("REGEXP", 2, _sqlite_regexp))
    except Exception:
        # Fallback: schedule via the aiosqlite event-loop machinery directly.
        try:
            await_only(aio_conn._execute(
                aio_conn._conn.create_function, "REGEXP", 2, _sqlite_regexp,
            ))
        except Exception:
            pass


@pytest_asyncio.fixture
async def db_engine():
    _remap_jsonb_to_json()
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)

    # Register REGEXP on every new SQLite connection so Column.regexp_match()
    # works in tests (production uses Postgres ~* directly).
    @event.listens_for(engine.sync_engine, "connect")
    def _on_connect(dbapi_connection, connection_record):
        _register_sqlite_regexp(dbapi_connection, connection_record)

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
    """Legacy seed fixture for existing API tests (mock auth client)."""
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
        name="許先生",
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
async def auth_seeded_db(db_session):
    """Auth-focused seed fixture with multiple roles and known passwords."""
    users = [
        User(
            id="usr_admin",
            name="Admin User",
            username="admin",
            password_hash=hash_password("AdminPass123!"),
            email="admin@hospital.com",
            role="admin",
            unit="ICU",
            active=True,
        ),
        User(
            id="usr_doctor",
            name="Doctor User",
            username="doctor",
            password_hash=hash_password("DoctorPass123!"),
            email="doctor@hospital.com",
            role="doctor",
            unit="ICU",
            active=True,
        ),
        User(
            id="usr_nurse",
            name="Nurse User",
            username="nurse",
            password_hash=hash_password("NursePass123!"),
            email="nurse@hospital.com",
            role="nurse",
            unit="ICU",
            active=True,
        ),
        User(
            id="usr_pharm",
            name="Pharmacist User",
            username="pharmacist",
            password_hash=hash_password("PharmPass123!"),
            email="pharmacist@hospital.com",
            role="pharmacist",
            unit="Pharmacy",
            active=True,
        ),
    ]
    db_session.add_all(users)
    await db_session.commit()
    yield db_session


@pytest_asyncio.fixture
async def test_redis():
    """In-memory redis stub to isolate auth tests from external Redis."""
    client = auth_middleware._InMemoryRedis()
    yield client
    await client.close()


@pytest_asyncio.fixture
async def mock_auth_client(seeded_db, db_engine):
    """Async client with DB override + mocked current user (legacy behavior)."""
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

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


@pytest_asyncio.fixture
async def real_auth_client(auth_seeded_db, db_engine, test_redis, monkeypatch):
    """Async client with real auth/JWT path enabled (no get_current_user override)."""
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def override_get_redis():
        return test_redis

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(auth_middleware, "get_redis", override_get_redis)
    monkeypatch.setattr(auth_router, "get_redis", override_get_redis)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(mock_auth_client):
    """Backwards-compatible alias used by existing tests."""
    from app.middleware.rate_limit import limiter
    limiter.reset()
    yield mock_auth_client
