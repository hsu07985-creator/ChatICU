"""E2E tests: real LLM calls through full HTTP endpoint stack.

NO mocks, NO fake AI — every test hits the real OpenAI API via the full
FastAPI → router → service → call_llm → OpenAI pipeline.

T1 rewrite (2026-07-10, llm-infra-audit): the original suite targeted five
endpoints that no longer exist (`/clinical/summary`, `/clinical/explanation`,
`/clinical/guideline`, `/clinical/decision`, `/ai/chat`) — 7/13 tests failed
with 404 before ever reaching the LLM, and the patient-not-found test was
fake-green (404 because the ROUTE was gone, not the patient). Tests now
target the surviving endpoints; the streaming ones assert on parsed SSE
frames. Explanation/guideline/decision have no replacement endpoint and
their tests were deleted.

Uses SQLite in-memory DB (from conftest) + seeded patient with full
clinical data (lab, vitals, meds, ventilator).

Run:  cd backend && RUN_REAL_LLM_E2E=1 python3 -m pytest tests/test_e2e_llm.py -v -s
Cost: ~8 OpenAI API calls per run
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pytest
import pytest_asyncio

from app.config import settings

# Skip by default (explicit opt-in) and skip if no API key — no fallback
pytestmark = pytest.mark.skipif(
    os.getenv("RUN_REAL_LLM_E2E") != "1" or not settings.OPENAI_API_KEY,
    reason="Set RUN_REAL_LLM_E2E=1 and OPENAI_API_KEY to run real LLM E2E tests",
)


def _parse_sse(text: str) -> List[Tuple[Optional[str], Any]]:
    """Parse a buffered SSE body into (event, payload) tuples.

    httpx ASGITransport buffers the whole response, so by the time we read
    `.text` every frame is present. Payloads are JSON-decoded; error frames
    whose data is a JSON string decode to dicts the same way.
    """
    frames: List[Tuple[Optional[str], Any]] = []
    event: Optional[str] = None
    for line in text.splitlines():
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data = line[5:].strip()
            if not data:
                continue
            try:
                frames.append((event, json.loads(data)))
            except json.JSONDecodeError:
                frames.append((event, data))
    return frames


def _sse_reply_and_done(text: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    """Concatenated delta chunks + the done payload (None if absent)."""
    frames = _parse_sse(text)
    errors = [p for e, p in frames if e == "error"]
    assert not errors, f"stream emitted error frame(s): {errors}"
    reply = "".join(
        p["chunk"] for e, p in frames
        if e == "delta" and isinstance(p, dict) and "chunk" in p
    )
    done = next((p for e, p in frames if e == "done"), None)
    return reply, done


@pytest_asyncio.fixture
async def e2e_client(client, seeded_db):
    """Seed full clinical data (lab, vitals, meds, vent) into pat_001, return client."""
    from app.models.lab_data import LabData
    from app.models.vital_sign import VitalSign
    from app.models.medication import Medication
    from app.models.ventilator import VentilatorSetting

    now = datetime.now(timezone.utc)

    lab = LabData(
        id="lab_e2e", patient_id="pat_001", timestamp=now,
        biochemistry={
            "K": {"value": 3.2, "unit": "mEq/L", "referenceRange": "3.5-5.0", "isAbnormal": True},
            "Na": {"value": 138, "unit": "mEq/L", "referenceRange": "136-145", "isAbnormal": False},
            "Scr": {"value": 1.8, "unit": "mg/dL", "referenceRange": "0.7-1.3", "isAbnormal": True},
            "eGFR": {"value": 38, "unit": "mL/min", "referenceRange": ">60", "isAbnormal": True},
            "BUN": {"value": 28, "unit": "mg/dL", "referenceRange": "7-20", "isAbnormal": True},
        },
        hematology={
            "WBC": {"value": 15.2, "unit": "10^3/uL", "referenceRange": "4-10", "isAbnormal": True},
            "Hb": {"value": 10.1, "unit": "g/dL", "referenceRange": "12-16", "isAbnormal": True},
            "PLT": {"value": 180, "unit": "10^3/uL", "referenceRange": "150-400", "isAbnormal": False},
        },
        inflammatory={
            "CRP": {"value": 12.5, "unit": "mg/L", "referenceRange": "<5", "isAbnormal": True},
            "Procalcitonin": {"value": 2.1, "unit": "ng/mL", "referenceRange": "<0.5", "isAbnormal": True},
        },
    )
    vital = VitalSign(
        id="vs_e2e", patient_id="pat_001", timestamp=now,
        heart_rate=95, systolic_bp=110, diastolic_bp=65, spo2=92, temperature=38.2,
    )
    med1 = Medication(
        id="med_e2e_1", patient_id="pat_001",
        name="Morphine", dose="2", unit="mg", frequency="Q4H", route="IV", status="active",
    )
    med2 = Medication(
        id="med_e2e_2", patient_id="pat_001",
        name="Midazolam", dose="3", unit="mg/hr", frequency="continuous", route="IV", status="active",
    )
    med3 = Medication(
        id="med_e2e_3", patient_id="pat_001",
        name="Meropenem", dose="1", unit="g", frequency="Q8H", route="IV", status="active",
    )
    vent = VentilatorSetting(
        id="vent_e2e", patient_id="pat_001", timestamp=now,
        mode="PC/AC", fio2=50, peep=10, tidal_volume=420,
    )

    seeded_db.add_all([lab, vital, med1, med2, med3, vent])
    await seeded_db.commit()

    return client


# ───────────────────────────────────────────────────────────────
# 1. POST /api/v1/clinical/summary/stream — 真實 AI 臨床摘要（SSE）
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_clinical_summary_stream(e2e_client):
    """Full: HTTP → _get_patient_dict(with lab/vitals/meds/vent) → call_llm_stream → OpenAI."""
    response = await e2e_client.post(
        "/api/v1/clinical/summary/stream",
        json={"patient_id": "pat_001"},
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    reply, done = _sse_reply_and_done(response.text)
    assert reply, "no delta chunks streamed"
    assert done is not None, "no done frame"

    result = done["data"]
    assert result["patient_id"] == "pat_001"
    assert isinstance(result["summary"], str)
    assert len(result["summary"]) > 50, f"Summary too short: {result['summary']}"
    assert "metadata" in result

    print(f"\n✅ /clinical/summary/stream — {len(result['summary'])} chars")
    print(f"   {result['summary'][:300]}...")


# ───────────────────────────────────────────────────────────────
# 2. POST /api/v1/clinical/polish — 真實 AI 文本修飾（4 種全測）
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("polish_type,draft", [
    (
        "progress_note",
        "病人今天狀況穩定，血壓 110/65，心率 95，SpO2 92%。血鉀偏低 3.2 已補充 KCl。持續使用呼吸器。",
    ),
    (
        "medication_advice",
        "建議調整 Meropenem 劑量因 eGFR 38，注意 Morphine+Midazolam 併用的呼吸抑制風險。",
    ),
    (
        "nursing_record",
        "病患意識: E3M5V(T)\n生命徵象: BP 110/65, HR 95, RR 22, T 38.2\n氣管內管: 22cm\n巳給予 Morphine 2mg IV",
    ),
    (
        "pharmacy_advice",
        "建議處方 KCl 40mEq IV drip 補充低血鉀。Meropenem 建議減量至 0.5g Q8H。監測 Midazolam 血中濃度。",
    ),
])
async def test_e2e_clinical_polish(e2e_client, polish_type, draft):
    """Full: HTTP → _get_patient_dict → call_llm(polish) → OpenAI + safety guardrail."""
    response = await e2e_client.post(
        "/api/v1/clinical/polish",
        json={
            "patient_id": "pat_001",
            "content": draft,
            "polish_type": polish_type,
        },
    )
    assert response.status_code == 200, f"[{polish_type}] Status {response.status_code}: {response.text}"

    data = response.json()
    assert data["success"] is True

    result = data["data"]
    assert result["patient_id"] == "pat_001"
    assert result["polish_type"] == polish_type
    assert result["original"] == draft
    assert "polished" in result
    assert len(result["polished"]) > 20

    print(f"\n✅ /clinical/polish [{polish_type}] — {len(result['polished'])} chars")
    print(f"   {result['polished'][:200]}...")


# ───────────────────────────────────────────────────────────────
# 3. POST /ai/chat/stream — 真實 AI 對話（SSE，含病患上下文注入）
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_ai_chat_stream_with_patient(e2e_client):
    """Full: HTTP → chat_stream → build_clinical_snapshot → call_llm_stream → OpenAI."""
    response = await e2e_client.post(
        "/ai/chat/stream",
        json={
            "message": "這位病人目前的腎功能狀況如何？需要注意什麼？",
            "patientId": "pat_001",
        },
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    reply, done = _sse_reply_and_done(response.text)
    assert len(reply) > 30, f"reply too short: {reply!r}"
    assert done is not None, "no done frame"

    message = done["message"]
    assert message["role"] == "assistant"
    # B14: the done payload splits the reply at 【說明/補充】 into
    # content + explanation; both halves come from the streamed text.
    assert message["content"]
    assert message["content"] in reply
    if message.get("explanation"):
        assert message["explanation"] in reply
    assert done["sessionId"]

    print(f"\n✅ /ai/chat/stream (with patient) — {len(reply)} chars")
    print(f"   Session: {done['sessionId']}")
    print(f"   {reply[:300]}...")


@pytest.mark.asyncio
async def test_e2e_ai_chat_stream_without_patient(e2e_client):
    """AI chat without patientId — should still work (general ICU question)."""
    response = await e2e_client.post(
        "/ai/chat/stream",
        json={
            "message": "ICU 常見的鎮靜藥物有哪些？各自的優缺點？",
        },
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    reply, done = _sse_reply_and_done(response.text)
    assert len(reply) > 30
    assert done is not None and done["message"]["role"] == "assistant"

    print(f"\n✅ /ai/chat/stream (no patient) — {len(reply)} chars")
    print(f"   {reply[:300]}...")


# ───────────────────────────────────────────────────────────────
# 4. 錯誤情境 — 確認不會因 LLM 而崩潰（不打 OpenAI）
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_summary_patient_not_found(e2e_client):
    """Patient not found → 404 raised by _get_patient_dict BEFORE any LLM
    call. Asserting the detail names the patient distinguishes this from
    FastAPI's route-not-found 404 — the fake-green the old suite had."""
    response = await e2e_client.post(
        "/api/v1/clinical/summary/stream",
        json={"patient_id": "NONEXIST"},
    )
    assert response.status_code == 404
    assert "NONEXIST" in response.text, (
        f"404 must come from the patient lookup, not a missing route: {response.text}"
    )


@pytest.mark.asyncio
async def test_e2e_polish_invalid_type(e2e_client):
    """Invalid polish_type → 422 validation error (no LLM call)."""
    response = await e2e_client.post(
        "/api/v1/clinical/polish",
        json={
            "patient_id": "pat_001",
            "content": "test",
            "polish_type": "invalid_type",
        },
    )
    assert response.status_code == 422
    assert "polish_type" in response.text


@pytest.mark.asyncio
async def test_e2e_chat_stream_invalid_patient_rejected(e2e_client):
    """Chat with nonexistent patientId → 404 from the W1-T1 ACL
    (assert_patient_chat_access), BEFORE any LLM call. The old /ai/chat
    silently degraded to context-less chat; the stream endpoint
    deliberately rejects instead — pin that behavior."""
    response = await e2e_client.post(
        "/ai/chat/stream",
        json={
            "message": "什麼是 ARDS？",
            "patientId": "NONEXIST",
        },
    )
    assert response.status_code == 404

    print("\n✅ /ai/chat/stream (invalid patient) — rejected by ACL with 404")
