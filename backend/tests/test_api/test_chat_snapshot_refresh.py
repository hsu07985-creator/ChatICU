"""F2: tests for POST /ai/chat/sessions/{id}/refresh-snapshot.

Endpoint contract:
- 404 when session is missing or owned by someone else (no existence leak).
- 400 when session has no patient_id (nothing to refresh against).
- 200 + snapshot_metadata replaced when valid; response shape matches the
  frontend "refresh snapshot button" flow.

build_critical_snapshot opens its own fresh AsyncSessions internally
(B15-B), which doesn't fit the SQLite test harness, so we monkeypatch
it to a deterministic stub. The point of these tests is the endpoint
wiring (auth + ownership + ACL + metadata persistence), not the
snapshot building (already covered by test_patient_context_builder_deferred).
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.ai_session import AISession


async def _seed_session(db, *, session_id, user_id="usr_test", patient_id="pat_001"):
    db.add(AISession(
        id=session_id,
        user_id=user_id,
        patient_id=patient_id,
        title="t",
        snapshot_metadata=None,
    ))
    await db.commit()


def _stub_snapshot_builder(monkeypatch, *, snapshot_text="STUB SNAPSHOT"):
    """Replace snapshot builders with deterministic in-memory stubs.

    Force SNAPSHOT_DEFERRED_ENABLED on so the endpoint exercises the
    branch we ship to prod (Railway has the flag enabled). Without this
    the endpoint falls back to build_clinical_snapshot which has its
    own _fresh()/async_session quirks that the test harness doesn't
    serve.
    """
    from app.config import settings
    monkeypatch.setattr(settings, "SNAPSHOT_DEFERRED_ENABLED", True)

    async def fake_build(patient_id, db):  # noqa: ARG001
        return (
            snapshot_text,
            {"cr": 1.2, "wbc": 9.8},
            {"intubated": False},
        )
    monkeypatch.setattr(
        "app.routers.ai_chat.build_critical_snapshot", fake_build,
    )

    # Also stub the deferred background fill — it spawns its own AsyncSession
    # via _fill_deferred_snapshot_bg, which we don't want firing in tests.
    async def fake_bg(*args, **kwargs):  # noqa: ARG001
        return None
    monkeypatch.setattr(
        "app.routers.ai_chat._fill_deferred_snapshot_bg", fake_bg,
    )


@pytest.mark.asyncio
async def test_refresh_404_when_session_missing(client, seeded_db, monkeypatch):
    _stub_snapshot_builder(monkeypatch)
    r = await client.post("/ai/chat/sessions/sess_missing/refresh-snapshot")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_refresh_404_when_session_owned_by_other_user(client, seeded_db, monkeypatch):
    """Existence-leak guard: another user's session looks identical to a
    missing one. Both must 404, never 403."""
    _stub_snapshot_builder(monkeypatch)
    await _seed_session(
        seeded_db, session_id="sess_other", user_id="usr_someone_else",
        patient_id="pat_001",
    )
    r = await client.post("/ai/chat/sessions/sess_other/refresh-snapshot")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_refresh_400_when_session_has_no_patient(client, seeded_db, monkeypatch):
    _stub_snapshot_builder(monkeypatch)
    await _seed_session(
        seeded_db, session_id="sess_no_pat", patient_id=None,
    )
    r = await client.post("/ai/chat/sessions/sess_no_pat/refresh-snapshot")
    assert r.status_code == 400
    # App middleware reshapes HTTPException → {success: false, error, message, ...}
    body = r.json()
    assert body.get("success") is False
    assert "patient" in (body.get("message") or "").lower()


@pytest.mark.asyncio
async def test_refresh_happy_path_replaces_snapshot_metadata(
    client, seeded_db, monkeypatch,
):
    _stub_snapshot_builder(monkeypatch, snapshot_text="FRESH SNAPSHOT v2")
    await _seed_session(
        seeded_db, session_id="sess_refresh_ok", patient_id="pat_001",
    )

    r = await client.post("/ai/chat/sessions/sess_refresh_ok/refresh-snapshot")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert data["sessionId"] == "sess_refresh_ok"
    assert data["patientId"] == "pat_001"
    assert data["snapshotTakenAt"]  # ISO-8601 string, non-empty

    # snapshot_metadata replaced and contains the fresh snapshot text + key values.
    # expire_all() is required because the request handler used a separate
    # session, and seeded_db's identity map still has the pre-call (None
    # snapshot_metadata) version cached.
    seeded_db.expire_all()
    refreshed = (await seeded_db.execute(
        select(AISession).where(AISession.id == "sess_refresh_ok")
    )).scalar_one()
    assert refreshed.snapshot_metadata is not None
    meta = refreshed.snapshot_metadata
    assert meta["clinical_snapshot"] == "FRESH SNAPSHOT v2"
    assert meta["snapshot_key_values"] == {"cr": 1.2, "wbc": 9.8}
    assert meta["snapshot_taken_at"] == data["snapshotTakenAt"]
    # Deferred fill was kicked off; status starts at "pending" (the bg stub
    # does nothing so it stays pending — that's expected).
    assert meta["deferred_status"] == "pending"


@pytest.mark.asyncio
async def test_refresh_overwrites_prior_snapshot_metadata(
    client, seeded_db, monkeypatch,
):
    """Old snapshot_metadata must be fully replaced — leftover keys from a
    previous build (e.g. an old clinical_snapshot_deferred from a 30-min-old
    session) must not bleed through into the refreshed metadata."""
    _stub_snapshot_builder(monkeypatch)

    # Seed a session that already has old metadata (deferred ready, old text).
    await _seed_session(
        seeded_db, session_id="sess_replace", patient_id="pat_001",
    )
    sess = (await seeded_db.execute(
        select(AISession).where(AISession.id == "sess_replace")
    )).scalar_one()
    sess.snapshot_metadata = {
        "snapshot_taken_at": "2026-01-01T00:00:00+00:00",
        "snapshot_key_values": {"cr": 9.9},  # stale
        "clinical_snapshot": "OLD STUFF",
        "clinical_snapshot_deferred": "OLD DEFERRED",
        "deferred_status": "ready",
    }
    await seeded_db.commit()

    r = await client.post("/ai/chat/sessions/sess_replace/refresh-snapshot")
    assert r.status_code == 200

    seeded_db.expire_all()
    refreshed = (await seeded_db.execute(
        select(AISession).where(AISession.id == "sess_replace")
    )).scalar_one()
    meta = refreshed.snapshot_metadata
    # Critical: stale deferred text gone, status reset to pending, key vals
    # replaced. If any of these remain we'd be feeding the LLM mixed-vintage
    # context after a refresh.
    assert "OLD DEFERRED" not in str(meta)
    assert meta.get("clinical_snapshot_deferred") is None
    assert meta["deferred_status"] == "pending"
    assert meta["snapshot_key_values"] == {"cr": 1.2, "wbc": 9.8}
    assert meta["clinical_snapshot"] != "OLD STUFF"


@pytest.mark.asyncio
async def test_refresh_404_when_acl_rejects_missing_patient(
    client, seeded_db, monkeypatch,
):
    """If the patient was deleted between session creation and refresh,
    assert_patient_chat_access raises 404. The endpoint must surface that
    rather than silently rebuilding against a phantom patient."""
    _stub_snapshot_builder(monkeypatch)
    # Session points at a patient that doesn't exist.
    await _seed_session(
        seeded_db, session_id="sess_ghost", patient_id="pat_does_not_exist",
    )
    r = await client.post("/ai/chat/sessions/sess_ghost/refresh-snapshot")
    assert r.status_code == 404
