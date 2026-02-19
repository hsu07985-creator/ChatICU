"""Contract tests — verify response envelope consistency across all endpoints."""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.config import settings
from app.middleware.audit import create_audit_log
from app.models.vital_sign import VitalSign


@pytest.mark.asyncio
async def test_health_follows_envelope(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "data" in data
    assert data["data"]["status"] == "healthy"


@pytest.mark.asyncio
async def test_root_follows_envelope(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "data" in data


@pytest.mark.asyncio
async def test_success_response_has_required_fields(client):
    """Any 200 response must have success=True."""
    response = await client.get("/api/v1/rag/status")
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert data["success"] is True


@pytest.mark.asyncio
async def test_404_error_envelope(client):
    """404 must return {success: false, error: 'NOT_FOUND', message: ...}."""
    response = await client.post(
        "/api/v1/clinical/summary",
        json={"patient_id": "NONEXIST"},
    )
    assert response.status_code == 404
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "NOT_FOUND"
    assert "message" in data
    assert "request_id" in data
    assert "trace_id" in data
    assert response.headers.get("X-Request-ID")
    assert response.headers.get("X-Trace-ID")


@pytest.mark.asyncio
async def test_422_validation_error_envelope(client):
    """422 must return {success: false, error: 'VALIDATION_ERROR', details: [...]}."""
    # Send invalid body (missing required field)
    response = await client.post(
        "/api/v1/rules/ckd-stage",
        json={},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "VALIDATION_ERROR"
    assert "message" in data
    assert "details" in data
    assert isinstance(data["details"], list)
    assert len(data["details"]) > 0
    assert "field" in data["details"][0]
    assert "message" in data["details"][0]
    assert "request_id" in data
    assert "trace_id" in data


@pytest.mark.asyncio
async def test_503_error_envelope(client):
    """503 must return {success: false, error: 'SERVICE_UNAVAILABLE', message: ...}."""
    response = await client.post(
        "/api/v1/rag/query",
        json={"question": "test"},
    )
    assert response.status_code == 503
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "SERVICE_UNAVAILABLE"
    assert "message" in data
    assert "request_id" in data
    assert "trace_id" in data


@pytest.mark.asyncio
async def test_security_headers_present(client):
    """All responses must include defensive security headers (T26)."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-XSS-Protection"] == "1; mode=block"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in response.headers["Permissions-Policy"]
    # In dev, FE/BE run on different origins (ports), so CORP is relaxed.
    expected_corp = "cross-origin" if settings.DEBUG else "same-origin"
    assert response.headers["Cross-Origin-Resource-Policy"] == expected_corp
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Pragma"] == "no-cache"
    assert response.headers["Expires"] == "0"


@pytest.mark.asyncio
async def test_request_trace_id_propagates_on_success(client):
    """Success responses should echo inbound request/trace IDs."""
    request_id = "contract_req_success_001"
    trace_id = "contract_trace_success_001"
    response = await client.get(
        "/health",
        headers={
            "X-Request-ID": request_id,
            "X-Trace-ID": trace_id,
        },
    )
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID") == request_id
    assert response.headers.get("X-Trace-ID") == trace_id


@pytest.mark.asyncio
async def test_request_trace_id_propagates_on_error(client):
    """Error envelopes should keep inbound request/trace IDs for incident tracing."""
    request_id = "contract_req_error_001"
    trace_id = "contract_trace_error_001"
    response = await client.post(
        "/api/v1/rules/ckd-stage",
        json={},
        headers={
            "X-Request-ID": request_id,
            "X-Trace-ID": trace_id,
        },
    )
    assert response.status_code == 422
    data = response.json()
    assert data.get("request_id") == request_id
    assert data.get("trace_id") == trace_id
    assert response.headers.get("X-Request-ID") == request_id
    assert response.headers.get("X-Trace-ID") == trace_id


@pytest.mark.asyncio
async def test_all_success_endpoints_return_envelope(client):
    """Spot-check multiple success endpoints for envelope format."""
    endpoints = [
        ("GET", "/health"),
        ("GET", "/"),
        ("GET", "/api/v1/ai/readiness"),
        ("GET", "/api/v1/rag/status"),
        ("POST", "/api/v1/rules/ckd-stage", {"egfr": 90.0}),
    ]
    for entry in endpoints:
        method = entry[0]
        path = entry[1]
        body = entry[2] if len(entry) > 2 else None

        if method == "GET":
            resp = await client.get(path)
        else:
            resp = await client.post(path, json=body)

        data = resp.json()
        assert "success" in data, f"{method} {path} missing 'success' field"
        if resp.status_code < 400:
            assert data["success"] is True, f"{method} {path} should have success=True"


@pytest.mark.asyncio
async def test_clinical_summary_contract_includes_structured_schema(client):
    with patch(
        "app.routers.clinical.generate_clinical_summary",
        return_value={"summary": "病患呼吸狀態穩定，建議持續監測血氧。", "metadata": {}},
    ):
        response = await client.post("/api/v1/clinical/summary", json={"patient_id": "pat_001"})
        assert response.status_code == 200
        payload = response.json()["data"]
        assert isinstance(payload["summary"], str)
        structured = payload["summary_structured"]
        assert structured["schema_version"] == "clinical_summary.v1"
        assert isinstance(structured["overview"], str)
        assert isinstance(structured["key_findings"], list)
        assert isinstance(structured["recommended_actions"], list)


@pytest.mark.asyncio
async def test_clinical_explanation_contract_includes_structured_schema(client):
    with patch(
        "app.routers.clinical.generate_patient_explanation",
        return_value={"explanation": "目前藥物目標是維持鎮靜穩定並降低不適。", "metadata": {}},
    ):
        response = await client.post(
            "/api/v1/clinical/explanation",
            json={
                "patient_id": "pat_001",
                "topic": "目前鎮靜策略",
                "reading_level": "moderate",
            },
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        assert isinstance(payload["explanation"], str)
        structured = payload["explanation_structured"]
        assert structured["schema_version"] == "patient_explanation.v1"
        assert structured["topic"] == "目前鎮靜策略"
        assert structured["reading_level"] == "moderate"
        assert isinstance(structured["key_points"], list)
        assert isinstance(structured["care_advice"], list)


@pytest.mark.asyncio
async def test_clinical_decision_contract_includes_structured_schema(client):
    with patch(
        "app.routers.clinical.call_llm",
        return_value={
            "status": "success",
            "content": "建議逐步減量 Midazolam 並每 4 小時重評 RASS。",
            "metadata": {},
        },
    ):
        response = await client.post(
            "/api/v1/clinical/decision",
            json={"patient_id": "pat_001", "question": "Should we change sedation?"},
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        assert isinstance(payload["recommendation"], str)
        structured = payload["decision_structured"]
        assert structured["schema_version"] == "decision_support.v1"
        assert structured["question"] == "Should we change sedation?"
        assert isinstance(structured["rationale_points"], list)
        assert isinstance(structured["action_items"], list)


@pytest.mark.asyncio
async def test_multipart_upload_contract_is_limited_to_admin_vectors_upload(client):
    """Multipart surface must stay minimal and only expose admin vectors upload."""
    response = await client.get("/openapi.json")
    assert response.status_code == 200
    spec = response.json()

    multipart_ops = []
    for path, methods in spec.get("paths", {}).items():
        for method, op in methods.items():
            request_body = op.get("requestBody", {})
            content = request_body.get("content", {})
            if "multipart/form-data" in content:
                multipart_ops.append(f"{method.upper()} {path}")

    assert "POST /admin/vectors/upload" in multipart_ops
    unexpected = [op for op in multipart_ops if op != "POST /admin/vectors/upload"]
    assert unexpected == [], f"Unexpected multipart upload endpoints: {unexpected}"


# ── F09: Dashboard stats contract ────────────────────────────────────

@pytest.mark.asyncio
async def test_dashboard_stats_contract(client):
    """Dashboard /stats must match frontend DashboardStats interface (F09)."""
    response = await client.get("/dashboard/stats")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    stats = data["data"]

    # patients block
    assert "patients" in stats
    p = stats["patients"]
    assert isinstance(p["total"], int)
    assert isinstance(p["intubated"], int)
    assert isinstance(p["intubatedBeds"], list)
    assert isinstance(p["withSAN"], int)

    # alerts block
    assert "alerts" in stats
    assert isinstance(stats["alerts"]["total"], int)

    # medications block
    assert "medications" in stats
    m = stats["medications"]
    assert isinstance(m["active"], int)
    assert isinstance(m["sedation"], int)
    assert isinstance(m["analgesia"], int)
    assert isinstance(m["nmb"], int)

    # messages block
    assert "messages" in stats
    msg = stats["messages"]
    assert isinstance(msg["today"], int)
    assert isinstance(msg["unread"], int)

    # timestamp
    assert isinstance(stats["timestamp"], str)


# ── F13: Team chat contract ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_team_chat_list_contract(client):
    """Team chat list must include 'total' field (F13)."""
    response = await client.get("/team/chat")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    payload = data["data"]
    assert "messages" in payload
    assert isinstance(payload["messages"], list)
    assert "total" in payload
    assert isinstance(payload["total"], int)


@pytest.mark.asyncio
async def test_team_chat_list_order_oldest_to_newest(client):
    """Team chat list order must be oldest -> newest for UI append semantics."""
    contents = [
        "TEAM_CHAT_ORDER_MARKER_1",
        "TEAM_CHAT_ORDER_MARKER_2",
        "TEAM_CHAT_ORDER_MARKER_3",
    ]

    for content in contents:
        post_resp = await client.post("/team/chat", json={"content": content, "pinned": False})
        assert post_resp.status_code == 200
        assert post_resp.json()["success"] is True

    list_resp = await client.get("/team/chat", params={"limit": 3})
    assert list_resp.status_code == 200
    payload = list_resp.json()["data"]
    messages = payload["messages"]

    ordered_contents = [m["content"] for m in messages]
    assert ordered_contents == contents

    timestamps = [m["timestamp"] for m in messages]
    assert timestamps == sorted(timestamps)


# ── F18: Admin users stats contract ──────────────────────────────────

@pytest.mark.asyncio
async def test_admin_users_contract(client):
    """Admin /users must include stats block (F18)."""
    response = await client.get("/admin/users")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    payload = data["data"]
    assert "users" in payload
    assert isinstance(payload["users"], list)

    # stats block
    assert "stats" in payload
    s = payload["stats"]
    assert isinstance(s["total"], int)
    assert isinstance(s["active"], int)
    assert "byRole" in s
    for role in ["admin", "doctor", "nurse", "pharmacist"]:
        assert role in s["byRole"]
        assert isinstance(s["byRole"][role], int)


# ── C1: Medications grouped keys contract ──────────────────────────

@pytest.mark.asyncio
async def test_medications_grouped_keys_contract(client):
    """Medications grouped must use full key names: sedation/analgesia/nmb/other."""
    response = await client.get("/patients/pat_001/medications")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    grouped = data["data"]["grouped"]
    for key in ["sedation", "analgesia", "nmb", "other"]:
        assert key in grouped, f"Missing grouped key: {key}"
        assert isinstance(grouped[key], list)
    # Ensure old single-letter keys are NOT present
    for old_key in ["S", "A", "N"]:
        assert old_key not in grouped, f"Deprecated key still present: {old_key}"


# ── C6: Audit logs stats contract ──────────────────────────────────

@pytest.mark.asyncio
async def test_audit_logs_stats_contract(client):
    """Audit logs must include stats: {total, success, failed}."""
    response = await client.get("/admin/audit-logs")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    payload = data["data"]
    assert "logs" in payload
    assert "pagination" in payload
    assert "stats" in payload
    s = payload["stats"]
    assert isinstance(s["total"], int)
    assert isinstance(s["success"], int)
    assert isinstance(s["failed"], int)
    assert s["total"] == s["success"] + s["failed"]


# ── M2: Vital signs history pagination contract ────────────────────

@pytest.mark.asyncio
async def test_vital_signs_history_pagination_contract(client):
    """Vital signs history must return nested pagination block."""
    response = await client.get("/patients/pat_001/vital-signs/history")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    payload = data["data"]
    assert "history" in payload
    assert isinstance(payload["history"], list)
    assert "pagination" in payload
    p = payload["pagination"]
    for field in ["page", "limit", "total", "totalPages"]:
        assert field in p, f"Missing pagination field: {field}"
        assert isinstance(p[field], int)


@pytest.mark.asyncio
async def test_vital_signs_history_supports_start_end_date_filters(client, seeded_db):
    seeded_db.add_all(
        [
            VitalSign(
                id="vs_hist_001",
                patient_id="pat_001",
                timestamp=datetime(2026, 1, 5, 8, 0, tzinfo=timezone.utc),
                heart_rate=88,
                systolic_bp=122,
                diastolic_bp=72,
                mean_bp=89.0,
                respiratory_rate=18,
                spo2=97,
                temperature=36.8,
            ),
            VitalSign(
                id="vs_hist_002",
                patient_id="pat_001",
                timestamp=datetime(2026, 1, 20, 8, 0, tzinfo=timezone.utc),
                heart_rate=92,
                systolic_bp=126,
                diastolic_bp=74,
                mean_bp=91.0,
                respiratory_rate=20,
                spo2=98,
                temperature=37.0,
            ),
            VitalSign(
                id="vs_hist_003",
                patient_id="pat_001",
                timestamp=datetime(2026, 2, 10, 8, 0, tzinfo=timezone.utc),
                heart_rate=84,
                systolic_bp=118,
                diastolic_bp=70,
                mean_bp=86.0,
                respiratory_rate=17,
                spo2=96,
                temperature=36.7,
            ),
        ]
    )
    await seeded_db.commit()

    response = await client.get(
        "/patients/pat_001/vital-signs/history",
        params={
            "startDate": "2026-01-10",
            "endDate": "2026-01-31",
            "page": 1,
            "limit": 50,
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    ids = [row["id"] for row in payload["history"]]
    assert ids == ["vs_hist_002"]
    assert payload["pagination"]["total"] == 1


@pytest.mark.asyncio
async def test_vital_signs_history_invalid_date_range_returns_400(client):
    response = await client.get(
        "/patients/pat_001/vital-signs/history",
        params={"startDate": "2026-02-01", "endDate": "2026-01-31"},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert body["error"] == "BAD_REQUEST"


@pytest.mark.asyncio
async def test_audit_logs_support_user_and_date_filters(client):
    """Audit logs API should support user/startDate/endDate filters from frontend."""
    # Seed an audit row directly (avoid calling /ai/chat which triggers LLM chain).
    from app.database import get_db
    from app.main import app as _app

    db_gen = _app.dependency_overrides[get_db]()
    db = await db_gen.__anext__()
    await create_audit_log(
        db, user_id="usr_test", user_name="Test Doctor", role="doctor",
        action="AI 對話", target="seed_session", status="success",
    )
    await db.commit()

    response = await client.get(
        "/admin/audit-logs",
        params={
            "user": "Test",
            "startDate": "2000-01-01",
            "endDate": "2100-01-01",
            "page": 1,
            "limit": 20,
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert "logs" in payload
    assert "pagination" in payload
    assert "stats" in payload
    assert payload["pagination"]["page"] == 1
    assert payload["pagination"]["limit"] == 20


@pytest.mark.asyncio
async def test_audit_logs_invalid_date_returns_422(client):
    response = await client.get("/admin/audit-logs", params={"startDate": "bad-date"})
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert body["error"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_error_reports_support_type_and_pagination(client):
    """Error reports API should support page/limit/type params expected by frontend."""
    create_a = await client.post(
        "/pharmacy/error-reports",
        json={
            "patientId": "pat_001",
            "errorType": "interaction-alert",
            "severity": "high",
            "medicationName": "Warfarin",
            "description": "Potential major interaction",
            "actionTaken": "Held dose",
        },
    )
    assert create_a.status_code == 200
    create_b = await client.post(
        "/pharmacy/error-reports",
        json={
            "patientId": "pat_001",
            "errorType": "dose-alert",
            "severity": "moderate",
            "medicationName": "Heparin",
            "description": "Dose verification needed",
            "actionTaken": "Pending review",
        },
    )
    assert create_b.status_code == 200

    list_resp = await client.get(
        "/pharmacy/error-reports",
        params={"type": "interaction", "page": 1, "limit": 1},
    )
    assert list_resp.status_code == 200
    payload = list_resp.json()["data"]
    assert "reports" in payload
    assert "pagination" in payload
    assert payload["pagination"]["page"] == 1
    assert payload["pagination"]["limit"] == 1
    assert payload["total"] >= 1
    assert all("interaction" in r["errorType"] for r in payload["reports"])
