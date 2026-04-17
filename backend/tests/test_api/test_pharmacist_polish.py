"""Unit tests for the pharmacist_polish flow added in Phase 1.

Covers the Phase 1 review carry-over items from
`docs/medical-records-pharmacist-revamp.md`:

- P2.8  pharmacist refinement keeps bullets/Monitor when user says "改短"
- P2.9  _try_parse_soap_json edge cases (fences, prose, partial keys, etc.)
- P2.10 router asserts polished_sections.s/.o echo soap_sections.s/.o
- P2.11 legacy clinical_polish refinement with progress_note keeps structure
- Extra: schema mutual-exclusion validator (P1.11) guards empty input.

All LLM calls are mocked — these tests are hermetic and do not hit any
external provider.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.routers.clinical import _try_parse_soap_json
from app.schemas.clinical import PolishRequest


# ─── P2.9: _try_parse_soap_json edge cases ────────────────────────────────

def test_parse_plain_json():
    raw = '{"s": "pt c/o dyspnea", "o": "Cr 1.8 (0.6-1.2)", "a": "CRE", "p": "- consider vanco"}'
    out = _try_parse_soap_json(raw)
    assert out == {
        "s": "pt c/o dyspnea",
        "o": "Cr 1.8 (0.6-1.2)",
        "a": "CRE",
        "p": "- consider vanco",
    }


def test_parse_markdown_fenced_json():
    raw = '```json\n{"s": "a", "o": "b", "a": "c", "p": "d"}\n```'
    out = _try_parse_soap_json(raw)
    assert out == {"s": "a", "o": "b", "a": "c", "p": "d"}


def test_parse_unlabeled_fence():
    raw = '```\n{"s": "x", "o": "", "a": "", "p": "y"}\n```'
    out = _try_parse_soap_json(raw)
    assert out == {"s": "x", "o": "", "a": "", "p": "y"}


def test_parse_partial_keys_defaults_to_empty():
    raw = '{"s": "only s filled"}'
    out = _try_parse_soap_json(raw)
    assert out == {"s": "only s filled", "o": "", "a": "", "p": ""}


def test_parse_non_string_value_coerces_to_empty():
    raw = '{"s": 123, "o": null, "a": ["x"], "p": "ok"}'
    out = _try_parse_soap_json(raw)
    assert out == {"s": "", "o": "", "a": "", "p": "ok"}


def test_parse_plain_prose_returns_none():
    raw = "This is a plain clinical recommendation without JSON."
    assert _try_parse_soap_json(raw) is None


def test_parse_empty_string_returns_none():
    assert _try_parse_soap_json("") is None
    assert _try_parse_soap_json("   ") is None


def test_parse_malformed_json_returns_none():
    raw = '{"s": "unclosed'
    assert _try_parse_soap_json(raw) is None


def test_parse_json_array_returns_none():
    raw = '["not", "a", "dict"]'
    assert _try_parse_soap_json(raw) is None


# ─── P1.11: Schema mutual-exclusion validator ──────────────────────────────

def test_schema_rejects_fully_empty_call():
    with pytest.raises(ValidationError):
        PolishRequest(patient_id="p1", polish_type="medication_advice")


def test_schema_accepts_content_only():
    r = PolishRequest(patient_id="p1", content="draft", polish_type="medication_advice")
    assert r.task == "clinical_polish"


def test_schema_accepts_soap_only():
    r = PolishRequest(
        patient_id="p1",
        polish_type="medication_advice",
        task="pharmacist_polish",
        soap_sections={"s": "", "o": "", "a": "", "p": "sug D/C morphine"},
    )
    assert r.task == "pharmacist_polish"
    assert r.soap_sections is not None
    assert r.soap_sections["p"] == "sug D/C morphine"


def test_schema_accepts_refinement_only():
    r = PolishRequest(
        patient_id="p1",
        polish_type="medication_advice",
        previous_polished="- Due to renal impairment, please consider...",
        instruction="改短",
    )
    assert r.polish_mode == "full"


def test_schema_rejects_soap_with_only_empty_values():
    with pytest.raises(ValidationError):
        PolishRequest(
            patient_id="p1",
            polish_type="medication_advice",
            task="pharmacist_polish",
            soap_sections={"s": "", "o": "", "a": "", "p": ""},
        )


# ─── P2.10: Router echoes S/O when polisher returns valid JSON ─────────────

@pytest.mark.asyncio
async def test_pharmacist_polish_populates_polished_sections(client):
    """When LLM returns JSON, router exposes polished_sections on the envelope."""
    llm_reply = json.dumps({
        "s": "Patient c/o dyspnea, denied chest pain.",
        "o": "Cr 1.8 (0.6-1.2), K 5.8 (3.5-5.0)",
        "a": "Inadequate CRE coverage given worsening infiltrate.",
        "p": (
            "- Due to renal impairment (CrCl ~20), please consider "
            "discontinuing Morphine and switching to Fentanyl patch "
            "to reduce respiratory depression risk.\n"
            "  Monitor: respiratory rate, sedation score."
        ),
    })
    mock_response = {"status": "success", "content": llm_reply, "metadata": {"model": "gpt-5"}}
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "polish_type": "medication_advice",
                "task": "pharmacist_polish",
                "polish_mode": "full",
                "soap_sections": {
                    "s": "Patient c/o dyspnea, denied chest pain.",
                    "o": "Cr 1.8 (0.6-1.2), K 5.8 (3.5-5.0)",
                    "a": "CRE coverage inadequate",
                    "p": "sug D/C morphine, switch fentanyl patch",
                },
                "target_section": "a_and_p",
            },
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["task"] == "pharmacist_polish"
        assert data["polish_mode"] == "full"
        assert "polished_sections" in data
        sections = data["polished_sections"]
        # P2.10: S/O must echo the input verbatim.
        assert sections["s"] == "Patient c/o dyspnea, denied chest pain."
        assert "Cr 1.8 (0.6-1.2)" in sections["o"]
        # P section should carry the required format markers.
        assert "Monitor:" in sections["p"]
        assert sections["p"].lstrip().startswith("-")


@pytest.mark.asyncio
async def test_pharmacist_polish_degrades_when_llm_returns_prose(client):
    """If the LLM returns plain prose, polished_sections should be omitted."""
    mock_response = {
        "status": "success",
        "content": "Sorry, I cannot produce JSON right now.",
        "metadata": {},
    }
    with patch("app.routers.clinical.call_llm", return_value=mock_response):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "polish_type": "medication_advice",
                "task": "pharmacist_polish",
                "soap_sections": {"s": "", "o": "", "a": "", "p": "sug check vanco trough"},
            },
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["task"] == "pharmacist_polish"
        # Graceful fallback: string kept, split omitted.
        assert "polished_sections" not in data
        assert isinstance(data["polished"], str)


# ─── P2.8: pharmacist refinement routing preserves format context ──────────

@pytest.mark.asyncio
async def test_pharmacist_refinement_passes_previous_polished_to_llm(client):
    """When polish_mode='refinement', router forwards previous_polished + instruction."""
    captured: dict = {}

    def _capture(*, task, input_data, **_):
        captured["task"] = task
        captured["input_data"] = input_data
        return {
            "status": "success",
            "content": json.dumps({
                "s": "",
                "o": "",
                "a": "",
                "p": (
                    "- Due to renal impairment, please consider discontinuing "
                    "Morphine.\n  Monitor: respiratory rate."
                ),
            }),
            "metadata": {},
        }

    with patch("app.routers.clinical.call_llm", side_effect=_capture):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "polish_type": "medication_advice",
                "task": "pharmacist_polish",
                "polish_mode": "refinement",
                "previous_polished": (
                    "- Due to renal impairment (CrCl ~20), please consider "
                    "discontinuing Morphine and switching to Fentanyl patch.\n"
                    "  Monitor: respiratory rate, sedation score."
                ),
                "instruction": "改得更短",
                "soap_sections": {"s": "", "o": "", "a": "", "p": ""},
            },
        )
        assert response.status_code == 200
        # Router must route to pharmacist_polish task.
        assert captured["task"] == "pharmacist_polish"
        # And it must pass refinement payload so the prompt's MODE SWITCH can act.
        assert "previous_polished" in captured["input_data"]
        assert captured["input_data"]["user_instruction"] == "改得更短"
        assert captured["input_data"]["polish_mode"] == "refinement"
        # Polished P must still carry bullets + Monitor (format retention contract).
        p = response.json()["data"]["polished_sections"]["p"]
        assert p.lstrip().startswith("-")
        assert "Monitor:" in p


# ─── P2.11: legacy clinical_polish refinement keeps SOAP structure ─────────

@pytest.mark.asyncio
async def test_legacy_refinement_routes_to_clinical_polish(client):
    """A legacy caller (no task field) with instruction + previous_polished should
    still hit the clinical_polish task, and the router's REFINEMENT payload is
    built for the rewritten MODE SWITCH (not the old IGNORE override)."""
    captured: dict = {}

    def _capture(*, task, input_data, **_):
        captured["task"] = task
        captured["input_data"] = input_data
        return {"status": "success", "content": "polished text", "metadata": {}}

    with patch("app.routers.clinical.call_llm", side_effect=_capture):
        response = await client.post(
            "/api/v1/clinical/polish",
            json={
                "patient_id": "pat_001",
                "content": "pt stable, labs ok",
                "polish_type": "progress_note",
                "instruction": "改短",
                "previous_polished": (
                    "S: stable.\nO: Cr 1.2.\nA: ok.\nP: continue plan."
                ),
            },
        )
        assert response.status_code == 200
        assert captured["task"] == "clinical_polish"
        assert captured["input_data"]["mode"] == "REFINEMENT"
        assert captured["input_data"]["user_instruction"] == "改短"
        # polish_type must still be forwarded so MODE SWITCH can enforce SOAP.
        assert captured["input_data"]["polish_type"] == "progress_note"
