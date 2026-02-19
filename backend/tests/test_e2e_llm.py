"""E2E tests: real LLM calls through full HTTP endpoint stack.

NO mocks, NO fake AI — every test hits the real OpenAI API via the full
FastAPI → router → service → call_llm → OpenAI pipeline.

Uses SQLite in-memory DB (from conftest) + seeded patient with full
clinical data (lab, vitals, meds, ventilator).

Run:  cd backend && python3 -m pytest tests/test_e2e_llm.py -v -s
Cost: ~10 OpenAI API calls per run (gpt-5)
"""

from __future__ import annotations

from datetime import datetime, timezone
import os

import pytest
import pytest_asyncio

from app.config import settings

# Skip by default (explicit opt-in) and skip if no API key — no fallback
pytestmark = pytest.mark.skipif(
    os.getenv("RUN_REAL_LLM_E2E") != "1" or not settings.OPENAI_API_KEY,
    reason="Set RUN_REAL_LLM_E2E=1 and OPENAI_API_KEY to run real LLM E2E tests",
)


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
# 1. POST /api/v1/clinical/summary — 真實 AI 臨床摘要
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_clinical_summary(e2e_client):
    """Full: HTTP → _get_patient_dict(with lab/vitals/meds/vent) → generate_clinical_summary → OpenAI."""
    response = await e2e_client.post(
        "/api/v1/clinical/summary",
        json={"patient_id": "pat_001"},
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    data = response.json()
    assert data["success"] is True
    assert "data" in data

    result = data["data"]
    assert "summary" in result
    assert "metadata" in result
    assert isinstance(result["summary"], str)
    assert len(result["summary"]) > 50, f"Summary too short: {result['summary']}"

    print(f"\n✅ /clinical/summary — {len(result['summary'])} chars")
    print(f"   {result['summary'][:300]}...")


# ───────────────────────────────────────────────────────────────
# 2. POST /api/v1/clinical/explanation — 真實 AI 衛教說明
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_patient_explanation(e2e_client):
    """Full: HTTP → _get_patient_dict → generate_patient_explanation → OpenAI."""
    response = await e2e_client.post(
        "/api/v1/clinical/explanation",
        json={
            "patient_id": "pat_001",
            "topic": "目前使用的呼吸器和鎮靜藥物",
        },
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    data = response.json()
    assert data["success"] is True

    result = data["data"]
    assert "explanation" in result
    assert len(result["explanation"]) > 50

    print(f"\n✅ /clinical/explanation — {len(result['explanation'])} chars")
    print(f"   {result['explanation'][:300]}...")


# ───────────────────────────────────────────────────────────────
# 3. POST /api/v1/clinical/guideline — 真實 AI 指引查詢
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_guideline_interpretation(e2e_client):
    """Full: HTTP → _get_patient_dict → call_llm(guideline) → OpenAI + safety guardrail."""
    response = await e2e_client.post(
        "/api/v1/clinical/guideline",
        json={
            "patient_id": "pat_001",
            "scenario": "病人使用 Midazolam 連續鎮靜超過 72 小時，RASS -4，是否應轉換為 Propofol",
            "guideline_topic": "ICU sedation management PADIS guidelines",
        },
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    data = response.json()
    assert data["success"] is True

    result = data["data"]
    assert result["patient_id"] == "pat_001"
    assert "interpretation" in result
    assert len(result["interpretation"]) > 50
    assert "sources" in result
    assert isinstance(result["sources"], list)

    print(f"\n✅ /clinical/guideline — {len(result['interpretation'])} chars, {len(result['sources'])} sources")
    print(f"   {result['interpretation'][:300]}...")


# ───────────────────────────────────────────────────────────────
# 4. POST /api/v1/clinical/decision — 真實 AI 多角色決策
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_multi_agent_decision(e2e_client):
    """Full: HTTP → _get_patient_dict → call_llm(decision) → OpenAI + safety guardrail."""
    response = await e2e_client.post(
        "/api/v1/clinical/decision",
        json={
            "patient_id": "pat_001",
            "question": "腎功能持續下降 (eGFR 38)，是否需要啟動 CRRT？Meropenem 是否需要調整劑量？",
            "assessments": [
                {"agent": "nephrologist", "opinion": "eGFR trending down, consider CRRT if < 15"},
                {"agent": "pharmacist", "opinion": "Meropenem dose adjustment needed for CrCl < 50"},
                {"agent": "intensivist", "opinion": "Hemodynamically stable, can tolerate CRRT"},
            ],
        },
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    data = response.json()
    assert data["success"] is True

    result = data["data"]
    assert result["patient_id"] == "pat_001"
    assert "recommendation" in result
    assert len(result["recommendation"]) > 50

    print(f"\n✅ /clinical/decision — {len(result['recommendation'])} chars")
    print(f"   {result['recommendation'][:300]}...")


# ───────────────────────────────────────────────────────────────
# 5. POST /api/v1/clinical/polish — 真實 AI 文本修飾（4 種全測）
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
# 6. POST /ai/chat — 真實 AI 對話（含病患上下文注入）
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_ai_chat_with_patient(e2e_client):
    """Full: HTTP → ai_chat → _get_patient_dict → call_llm(rag) → OpenAI + safety guardrail."""
    response = await e2e_client.post(
        "/ai/chat",
        json={
            "message": "這位病人目前的腎功能狀況如何？需要注意什麼？",
            "patientId": "pat_001",
        },
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    data = response.json()
    assert data["success"] is True

    result = data["data"]
    assert "message" in result
    assert result["message"]["role"] == "assistant"
    assert len(result["message"]["content"]) > 30
    assert "sessionId" in result

    print(f"\n✅ /ai/chat (with patient) — {len(result['message']['content'])} chars")
    print(f"   Session: {result['sessionId']}")
    print(f"   {result['message']['content'][:300]}...")


@pytest.mark.asyncio
async def test_e2e_ai_chat_without_patient(e2e_client):
    """AI chat without patientId — should still work (general ICU question)."""
    response = await e2e_client.post(
        "/ai/chat",
        json={
            "message": "ICU 常見的鎮靜藥物有哪些？各自的優缺點？",
        },
    )
    assert response.status_code == 200, f"Status {response.status_code}: {response.text}"

    data = response.json()
    assert data["success"] is True

    result = data["data"]
    assert result["message"]["role"] == "assistant"
    assert len(result["message"]["content"]) > 30

    print(f"\n✅ /ai/chat (no patient) — {len(result['message']['content'])} chars")
    print(f"   {result['message']['content'][:300]}...")


# ───────────────────────────────────────────────────────────────
# 7. 錯誤情境 — 確認不會因 LLM 而崩潰
# ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_summary_patient_not_found(e2e_client):
    """Patient not found → 404, not crash."""
    response = await e2e_client.post(
        "/api/v1/clinical/summary",
        json={"patient_id": "NONEXIST"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_e2e_polish_invalid_type(e2e_client):
    """Invalid polish_type → 422 validation error."""
    response = await e2e_client.post(
        "/api/v1/clinical/polish",
        json={
            "patient_id": "pat_001",
            "content": "test",
            "polish_type": "invalid_type",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_e2e_chat_invalid_patient_still_works(e2e_client):
    """Chat with nonexistent patientId → still works (patient context = None)."""
    response = await e2e_client.post(
        "/ai/chat",
        json={
            "message": "什麼是 ARDS？",
            "patientId": "NONEXIST",
        },
    )
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert len(data["data"]["message"]["content"]) > 20

    print(f"\n✅ /ai/chat (invalid patient) — still works, {len(data['data']['message']['content'])} chars")
