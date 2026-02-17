"""Intent router for clinical query modes."""

from __future__ import annotations

import json
import re
from typing import Any

from openai import OpenAI

KNOWN_INTENTS = {"auto", "knowledge_qa", "dose_calc", "interaction_check", "hybrid"}
ROUTABLE_INTENTS = {"knowledge_qa", "dose_calc", "interaction_check", "hybrid"}

_CLASSIFIER_SYSTEM_PROMPT = """You are a strict clinical intent router.
Classify ONLY into one intent:
- knowledge_qa
- dose_calc
- interaction_check
- hybrid

Decision rules:
1) dose_calc: question asks for dose/rate/infusion calculation or dose adjustment for one drug with patient parameters.
2) interaction_check: question asks drug-drug interaction checking with >=2 drugs.
3) hybrid: both dose logic and interaction logic are required in one request.
4) knowledge_qa: clinical knowledge question that does not require deterministic dose math or DDI pair checking.

Output must be valid JSON object only:
{"intent":"...", "confidence":0.0-1.0, "reason":"short reason"}
"""


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise ValueError("empty classifier output")

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

    if not text.startswith("{"):
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise ValueError("no json object found")
        text = match.group(0).strip()

    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("classifier output must be a json object")
    return parsed


class ClinicalIntentClassifier:
    """LLM-based clinical intent classifier (strict mode, no fallback route)."""

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        client: OpenAI | None = None,
    ):
        self.model = (model or "gpt-4.1-mini").strip() or "gpt-4.1-mini"
        self.client = client or (OpenAI(api_key=api_key) if api_key else None)

    def classify(
        self,
        *,
        question: str,
        has_drug: bool = False,
        has_drug_list: bool = False,
        has_patient_context: bool = False,
        has_dose_target: bool = False,
    ) -> tuple[str, dict[str, Any]]:
        if self.client is None:
            raise RuntimeError("intent_classifier_no_openai_client")

        payload = {
            "question": question or "",
            "has_drug": bool(has_drug),
            "has_drug_list": bool(has_drug_list),
            "has_patient_context": bool(has_patient_context),
            "has_dose_target": bool(has_dose_target),
        }

        resp = self.client.responses.create(
            model=self.model,
            input=[
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": _CLASSIFIER_SYSTEM_PROMPT}],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": json.dumps(payload, ensure_ascii=False),
                        }
                    ],
                },
            ],
        )
        output_text = (getattr(resp, "output_text", "") or "").strip()
        data = _extract_json_object(output_text)
        intent = str(data.get("intent", "")).strip().lower()
        if intent not in ROUTABLE_INTENTS:
            raise ValueError(f"unsupported intent from classifier: {intent}")

        confidence = data.get("confidence", 0.0)
        try:
            confidence_f = max(0.0, min(1.0, float(confidence)))
        except Exception:
            confidence_f = 0.0

        reason = str(data.get("reason", "")).strip()
        return (
            intent,
            {
                "source": "llm",
                "confidence": round(confidence_f, 4),
                "reason": reason,
            },
        )
