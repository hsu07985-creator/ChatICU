"""Test clinical API endpoints."""

from datetime import datetime, timezone
from unittest.mock import patch

import httpx
import pytest


@pytest.mark.asyncio
async def test_clinical_summary(client):
    mock_response = {
        "status": "success",
        "content": "Clinical summary for pat_001.",
        "metadata": {"model": "gpt-5"},
    }
    with patch("app.routers.clinical.generate_clinical_summary", return_value={"summary": "test", "metadata": {}}):
        response = await client.post("/api/v1/clinical/summary", json={"patient_id": "pat_001"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        payload = data["data"]
        assert payload["patient_id"] == "pat_001"
        assert isinstance(payload["summary"], str)
        assert payload["summary_structured"]["schema_version"] == "clinical_summary.v1"
        assert isinstance(payload["summary_structured"]["key_findings"], list)
        assert isinstance(payload["summary_structured"]["recommended_actions"], list)
        assert payload["dataFreshness"] is not None
        assert isinstance(payload["dataFreshness"]["hints"], list)
        assert isinstance(payload["dataFreshness"]["missing_fields"], list)


@pytest.mark.asyncio
async def test_clinical_summary_not_found(client):
    response = await client.post("/api/v1/clinical/summary", json={"patient_id": "NONEXIST"})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_patient_explanation_returns_structured_schema(client):
    with patch(
        "app.routers.clinical.generate_patient_explanation",
        return_value={"explanation": "請家屬注意血氧與鎮靜評估。", "metadata": {}},
    ):
        response = await client.post(
            "/api/v1/clinical/explanation",
            json={
                "patient_id": "pat_001",
                "topic": "如何解釋目前鎮靜治療？",
                "reading_level": "simple",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        payload = data["data"]
        assert payload["patient_id"] == "pat_001"
        assert payload["topic"] == "如何解釋目前鎮靜治療？"
        assert payload["explanation_structured"]["schema_version"] == "patient_explanation.v1"
        assert payload["explanation_structured"]["topic"] == "如何解釋目前鎮靜治療？"
        assert payload["explanation_structured"]["reading_level"] == "simple"
        assert isinstance(payload["explanation_structured"]["key_points"], list)
        assert payload["dataFreshness"] is not None
        assert isinstance(payload["dataFreshness"]["hints"], list)


@pytest.mark.asyncio
async def test_guideline_interpretation(client):
    mock_response = {
        "status": "success",
        "content": "Based on PADIS guidelines, recommend reducing sedation.",
        "metadata": {"model": "gpt-5"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/guideline",
            json={
                "patient_id": "pat_001",
                "scenario": "Patient on continuous Midazolam infusion for 3 days",
                "guideline_topic": "sedation management",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["patient_id"] == "pat_001"
        assert "interpretation" in data["data"]
        assert data["data"]["dataFreshness"] is not None
        assert isinstance(data["data"]["dataFreshness"]["hints"], list)


@pytest.mark.asyncio
async def test_guideline_not_found(client):
    response = await client.post(
        "/api/v1/clinical/guideline",
        json={"patient_id": "NONEXIST", "scenario": "test"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_multi_agent_decision(client):
    mock_response = {
        "status": "success",
        "content": "Recommend switching from Midazolam to Propofol.",
        "metadata": {"model": "gpt-5"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/decision",
            json={
                "patient_id": "pat_001",
                "question": "Should we switch sedation agents?",
                "assessments": [
                    {"agent": "pharmacist", "opinion": "Midazolam accumulation risk"},
                ],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "recommendation" in data["data"]
        assert data["data"]["decision_structured"]["schema_version"] == "decision_support.v1"
        assert data["data"]["decision_structured"]["question"] == "Should we switch sedation agents?"
        assert isinstance(data["data"]["decision_structured"]["rationale_points"], list)
        assert data["data"]["dataFreshness"] is not None
        assert isinstance(data["data"]["dataFreshness"]["hints"], list)


@pytest.mark.asyncio
async def test_decision_not_found(client):
    response = await client.post(
        "/api/v1/clinical/decision",
        json={"patient_id": "NONEXIST", "question": "test"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_patient_dict_includes_related_data(client, seeded_db):
    """Verify _get_patient_dict() returns lab/vitals/meds/ventilator data."""
    from app.models.lab_data import LabData
    from app.models.vital_sign import VitalSign
    from app.models.medication import Medication
    from app.models.ventilator import VentilatorSetting

    now = datetime.now(timezone.utc)

    lab = LabData(
        id="lab_001", patient_id="pat_001", timestamp=now,
        biochemistry={"K": {"value": 3.8, "unit": "mEq/L", "referenceRange": "3.5-5.0", "isAbnormal": False}},
        hematology={"WBC": {"value": 12.5, "unit": "10^3/uL", "referenceRange": "4-10", "isAbnormal": True}},
    )
    vital = VitalSign(
        id="vs_001", patient_id="pat_001", timestamp=now,
        heart_rate=88, systolic_bp=120, diastolic_bp=80, spo2=96, temperature=37.2,
    )
    med = Medication(
        id="med_001", patient_id="pat_001", name="Morphine", dose="2",
        unit="mg", frequency="Q4H", route="IV", status="active",
    )
    vent = VentilatorSetting(
        id="vent_001", patient_id="pat_001", timestamp=now,
        mode="PC/AC", fio2=40, peep=8, tidal_volume=450,
    )

    seeded_db.add_all([lab, vital, med, vent])
    await seeded_db.commit()

    captured_args = {}

    def mock_summary(patient_data):
        captured_args["patient_data"] = patient_data
        return {"summary": "test", "metadata": {}}

    with patch("app.routers.clinical.generate_clinical_summary", side_effect=mock_summary):
        response = await client.post("/api/v1/clinical/summary", json={"patient_id": "pat_001"})
        assert response.status_code == 200

    pd = captured_args["patient_data"]
    # Lab data present
    assert pd["lab_data"] is not None
    assert "biochemistry" in pd["lab_data"]
    # Vital signs present
    assert pd["vital_signs"] is not None
    assert pd["vital_signs"]["heartRate"] == 88
    # Active medications present
    assert len(pd["medications"]) == 1
    assert pd["medications"][0]["name"] == "Morphine"
    # Ventilator settings present
    assert pd["ventilator_settings"] is not None
    assert pd["ventilator_settings"]["mode"] == "PC/AC"
    # Additional patient fields present
    assert "height" in pd
    assert "allergies" in pd


@pytest.mark.asyncio
async def test_patient_dict_handles_empty_related_data(client):
    """Verify _get_patient_dict() returns None/[] for absent related data."""
    captured_args = {}

    def mock_summary(patient_data):
        captured_args["patient_data"] = patient_data
        return {"summary": "test", "metadata": {}}

    with patch("app.routers.clinical.generate_clinical_summary", side_effect=mock_summary):
        response = await client.post("/api/v1/clinical/summary", json={"patient_id": "pat_001"})
        assert response.status_code == 200

    pd = captured_args["patient_data"]
    assert pd["lab_data"] is None
    assert pd["vital_signs"] is None
    assert pd["medications"] == []
    assert pd["ventilator_settings"] is None


@pytest.mark.asyncio
async def test_polish_progress_note(client):
    mock_response = {
        "status": "success",
        "content": "Polished progress note content.",
        "metadata": {"model": "gpt-5"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "content": "pt stable, labs ok",
                "polish_type": "progress_note",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["patient_id"] == "pat_001"
        assert data["data"]["polish_type"] == "progress_note"
        assert data["data"]["original"] == "pt stable, labs ok"
        assert "polished" in data["data"]
        assert data["data"]["dataFreshness"] is not None
        assert isinstance(data["data"]["dataFreshness"]["hints"], list)


@pytest.mark.asyncio
async def test_polish_medication_advice(client):
    mock_response = {
        "status": "success",
        "content": "Polished medication advice.",
        "metadata": {"model": "gpt-5"},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "content": "suggest switch to propofol",
                "polish_type": "medication_advice",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["polish_type"] == "medication_advice"


@pytest.mark.asyncio
async def test_polish_invalid_type(client):
    response = await client.post(
        "/api/v1/clinical/polish",
        json={
            "patient_id": "pat_001",
            "content": "some text",
            "polish_type": "invalid_type",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_polish_patient_not_found(client):
    mock_response = {
        "status": "success",
        "content": "polished",
        "metadata": {},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "NONEXIST",
                "content": "some text",
                "polish_type": "progress_note",
            },
        )
        assert response.status_code == 404


# ── P3-1: Dose Calculation ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dose_calculate(client):
    mock_result = {
        "request_id": "dose-001",
        "status": "ok",
        "result_type": "dose_calculation",
        "drug": "norepinephrine",
        "computed_values": {"rate_ml_hr": 5.0},
        "calculation_steps": ["step1"],
        "applied_rules": [],
        "safety_warnings": [],
        "citations": [],
        "confidence": 0.95,
        "rag": None,
    }
    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.dose_calculate.return_value = mock_result
        response = await client.post(
            "/api/v1/clinical/dose",
            json={
                "drug": "norepinephrine",
                "patient_context": {"weight_kg": 70, "age_years": 55},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["status"] == "ok"
        assert data["data"]["drug"] == "norepinephrine"


@pytest.mark.asyncio
async def test_dose_calculate_forwards_request_trace_ids(client):
    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.dose_calculate.return_value = {"status": "ok", "drug": "norepinephrine"}
        response = await client.post(
            "/api/v1/clinical/dose",
            json={
                "drug": "norepinephrine",
                "patient_context": {"weight_kg": 70, "age_years": 55},
            },
            headers={
                "X-Request-ID": "p1-dose-req-001",
                "X-Trace-ID": "p1-dose-trace-001",
            },
        )
        assert response.status_code == 200
        kwargs = mock_ec.dose_calculate.call_args.kwargs
        assert kwargs["request_id"] == "p1-dose-req-001"
        assert kwargs["trace_id"] == "p1-dose-trace-001"


@pytest.mark.asyncio
async def test_dose_calculate_missing_drug(client):
    """Drug name is required and must be >= 2 chars."""
    response = await client.post(
        "/api/v1/clinical/dose",
        json={"drug": "x", "patient_context": {"weight_kg": 70}},
    )
    assert response.status_code == 422


# ── P3-2: Interaction Check ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_interaction_check(client):
    mock_result = {
        "request_id": "int-001",
        "status": "ok",
        "result_type": "interaction_check",
        "overall_severity": "major",
        "findings": [{"drugA": "Warfarin", "drugB": "Amiodarone", "severity": "major"}],
        "applied_rules": [],
        "citations": [],
        "conflicts": [],
        "confidence": 0.9,
        "rag": None,
    }
    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.interaction_check.return_value = mock_result
        response = await client.post(
            "/api/v1/clinical/interactions",
            json={"drug_list": ["Warfarin", "Amiodarone"]},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["overall_severity"] == "major"


@pytest.mark.asyncio
async def test_interaction_check_forwards_request_trace_ids(client):
    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.interaction_check.return_value = {"status": "ok", "overall_severity": "major"}
        response = await client.post(
            "/api/v1/clinical/interactions",
            json={"drug_list": ["Warfarin", "Amiodarone"]},
            headers={
                "X-Request-ID": "p1-int-req-001",
                "X-Trace-ID": "p1-int-trace-001",
            },
        )
        assert response.status_code == 200
        kwargs = mock_ec.interaction_check.call_args.kwargs
        assert kwargs["request_id"] == "p1-int-req-001"
        assert kwargs["trace_id"] == "p1-int-trace-001"


@pytest.mark.asyncio
async def test_interaction_check_requires_two_drugs(client):
    """drug_list needs at least 2 items."""
    response = await client.post(
        "/api/v1/clinical/interactions",
        json={"drug_list": ["Warfarin"]},
    )
    assert response.status_code == 422


# ── P3-3: Clinical Query ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_clinical_query(client):
    mock_result = {
        "request_id": "cq-001",
        "intent": "knowledge_qa",
        "status": "ok",
        "result_type": "knowledge_qa",
        "confidence": 0.85,
        "warnings": [],
        "rag": {"answer": "PADIS guidelines recommend..."},
        "dose_result": None,
        "interaction_result": None,
        "citations": [],
    }
    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.clinical_query.return_value = mock_result
        response = await client.post(
            "/api/v1/clinical/clinical-query",
            json={"question": "What are the PADIS guidelines for sedation?"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["intent"] == "knowledge_qa"


@pytest.mark.asyncio
async def test_clinical_query_forwards_request_trace_ids(client):
    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.clinical_query.return_value = {
            "status": "ok",
            "intent": "knowledge_qa",
            "result_type": "knowledge_qa",
        }
        response = await client.post(
            "/api/v1/clinical/clinical-query",
            json={"question": "What are PADIS sedation targets?"},
            headers={
                "X-Request-ID": "p1-cq-req-001",
                "X-Trace-ID": "p1-cq-trace-001",
            },
        )
        assert response.status_code == 200
        kwargs = mock_ec.clinical_query.call_args.kwargs
        assert kwargs["request_id"] == "p1-cq-req-001"
        assert kwargs["trace_id"] == "p1-cq-trace-001"


@pytest.mark.asyncio
async def test_clinical_query_fallback_to_dose_when_intent_router_unavailable(client):
    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.clinical_query.side_effect = httpx.ConnectError("func unavailable")
        mock_ec.dose_calculate.return_value = {
            "request_id": "dose-fallback-001",
            "status": "ok",
            "result_type": "dose_calculation",
            "confidence": 0.88,
            "citations": [{"source": "rule"}],
        }
        response = await client.post(
            "/api/v1/clinical/clinical-query",
            json={
                "question": "請計算 norepinephrine 劑量",
                "intent": "auto",
                "drug": "norepinephrine",
                "patient_context": {"weight_kg": 70, "age_years": 60},
            },
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["intent"] == "dose_calculation"
        assert payload["dose_result"] is not None
        assert payload["fallback"]["applied"] is True
        assert payload["fallback"]["strategy"] == "deterministic"
        assert any("INTENT_ROUTER_DEGRADED" in w for w in payload["warnings"])


@pytest.mark.asyncio
async def test_clinical_query_fallback_to_interaction_when_router_http_error(client):
    request_obj = httpx.Request("POST", "http://func/clinical/query")
    response_obj = httpx.Response(status_code=502, request=request_obj)

    with patch("app.routers.clinical.evidence_client") as mock_ec:
        mock_ec.clinical_query.side_effect = httpx.HTTPStatusError(
            "upstream 502",
            request=request_obj,
            response=response_obj,
        )
        mock_ec.interaction_check.return_value = {
            "request_id": "int-fallback-001",
            "status": "ok",
            "result_type": "interaction_check",
            "confidence": 0.79,
            "citations": [{"source": "rule"}],
            "overall_severity": "major",
        }
        response = await client.post(
            "/api/v1/clinical/clinical-query",
            json={
                "question": "Warfarin + Amiodarone 交互作用?",
                "intent": "auto",
                "drug_list": ["Warfarin", "Amiodarone"],
            },
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["intent"] == "interaction_check"
        assert payload["interaction_result"] is not None
        assert payload["fallback"]["applied"] is True
        assert payload["fallback"]["reason"] == "upstream_http_502"


@pytest.mark.asyncio
async def test_clinical_query_fallback_to_knowledge_qa_with_local_rag(client):
    with patch("app.routers.clinical.evidence_client") as mock_ec, \
         patch("app.routers.clinical.rag_service") as mock_rag:
        mock_ec.clinical_query.side_effect = httpx.ConnectError("router down")
        mock_rag.is_indexed = True
        mock_rag.query.return_value = {
            "answer": "PADIS 指引建議每日鎮靜中斷評估。",
            "sources": [{"doc_id": "guideline/padis", "score": 0.82}],
            "metadata": {},
        }
        response = await client.post(
            "/api/v1/clinical/clinical-query",
            json={"question": "PADIS sedation guidance", "intent": "auto"},
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["intent"] == "knowledge_qa"
        assert payload["rag"]["answer"].startswith("PADIS")
        assert payload["citations"]
        assert payload["fallback"]["applied"] is True
