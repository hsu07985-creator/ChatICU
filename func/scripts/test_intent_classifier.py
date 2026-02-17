#!/usr/bin/env python3
"""Unit-style checks for LLM clinical intent classifier and service routing."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from evidence_rag.clinical.router import ClinicalIntentClassifier
from evidence_rag.service import EvidenceRAGService


class _MockResponse:
    def __init__(self, output_text: str):
        self.output_text = output_text


class _MockResponses:
    def __init__(self, outputs: list[str]):
        self.outputs = list(outputs)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> _MockResponse:
        self.calls.append(kwargs)
        if not self.outputs:
            raise RuntimeError("No more mock outputs")
        return _MockResponse(self.outputs.pop(0))


class _MockOpenAIClient:
    def __init__(self, outputs: list[str]):
        self.responses = _MockResponses(outputs=outputs)


class _DummyClassifier:
    def __init__(self, intent: str, meta: dict[str, Any]):
        self.intent = intent
        self.meta = meta
        self.calls = 0
        self.last_args: dict[str, Any] | None = None

    def classify(self, **kwargs: Any) -> tuple[str, dict[str, Any]]:
        self.calls += 1
        self.last_args = kwargs
        return self.intent, self.meta


class _FailingClassifier:
    def classify(self, **kwargs: Any) -> tuple[str, dict[str, Any]]:
        raise RuntimeError("intent_classifier_error")


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_classifier_json_parsing() -> None:
    client = _MockOpenAIClient(
        [
            '{"intent":"dose_calc","confidence":0.93,"reason":"needs dose math"}',
            '```json\n{"intent":"interaction_check","confidence":0.81,"reason":"ddi request"}\n```',
            "not json",
        ]
    )
    clf = ClinicalIntentClassifier(api_key="mock-key", model="gpt-4.1-mini", client=client)

    intent1, meta1 = clf.classify(
        question="請依 70kg 算 norepinephrine 劑量",
        has_drug=True,
        has_patient_context=True,
        has_dose_target=True,
    )
    _assert(intent1 == "dose_calc", f"expected dose_calc, got {intent1}")
    _assert(meta1.get("source") == "llm", f"expected llm source, got {meta1}")

    intent2, meta2 = clf.classify(
        question="請檢查 fentanyl 與 midazolam 交互作用",
        has_drug_list=True,
    )
    _assert(intent2 == "interaction_check", f"expected interaction_check, got {intent2}")
    _assert(meta2.get("source") == "llm", f"expected llm source, got {meta2}")

    raised = False
    try:
        clf.classify(question="這是一段壞輸出測試")
    except Exception:
        raised = True
    _assert(raised, "expected classifier to raise on invalid output")


def test_classifier_without_client() -> None:
    clf = ClinicalIntentClassifier(api_key=None, model="gpt-4.1-mini", client=None)
    raised = False
    try:
        clf.classify(question="請計算劑量")
    except Exception:
        raised = True
    _assert(raised, "expected classifier to raise when no OpenAI client is configured")


def test_service_resolve_intent() -> None:
    service = object.__new__(EvidenceRAGService)
    dummy = _DummyClassifier(intent="hybrid", meta={"source": "llm", "confidence": 0.9})
    service.intent_classifier = dummy

    explicit_intent, explicit_meta = EvidenceRAGService._resolve_clinical_intent(
        service,
        req={"intent": "dose_calc", "drug": "dexmedetomidine"},
        question="ignore",
    )
    _assert(explicit_intent == "dose_calc", f"expected explicit dose_calc, got {explicit_intent}")
    _assert(explicit_meta.get("source") == "explicit", f"expected explicit source, got {explicit_meta}")
    _assert(dummy.calls == 0, f"classifier should not be called for explicit intent, calls={dummy.calls}")

    auto_intent, auto_meta = EvidenceRAGService._resolve_clinical_intent(
        service,
        req={
            "intent": "auto",
            "drug": "dexmedetomidine",
            "drug_list": ["dexmedetomidine", "fentanyl"],
            "patient_context": {"weight_kg": 70},
            "dose_target": {"dose_mcg_per_kg_hr": 0.4},
        },
        question="請幫我算劑量並確認交互作用",
    )
    _assert(auto_intent == "hybrid", f"expected hybrid, got {auto_intent}")
    _assert(auto_meta.get("source") == "llm", f"expected llm source, got {auto_meta}")
    _assert(dummy.calls == 1, f"classifier should be called once for auto intent, calls={dummy.calls}")
    _assert(dummy.last_args is not None and dummy.last_args.get("has_drug") is True, "missing has_drug")
    _assert(
        dummy.last_args is not None and dummy.last_args.get("has_drug_list") is True,
        "missing has_drug_list",
    )
    _assert(
        dummy.last_args is not None and dummy.last_args.get("has_patient_context") is True,
        "missing has_patient_context",
    )
    _assert(
        dummy.last_args is not None and dummy.last_args.get("has_dose_target") is True,
        "missing has_dose_target",
    )


def test_service_refuse_without_plan_b() -> None:
    service = object.__new__(EvidenceRAGService)
    service.intent_classifier = _FailingClassifier()

    res = EvidenceRAGService.clinical_query(
        service,
        req={
            "request_id": "no-plan-b",
            "intent": "auto",
            "question": "請計算劑量",
            "drug": "dexmedetomidine",
            "patient_context": {"weight_kg": 70},
            "dose_target": {"dose_mcg_per_kg_hr": 0.4},
        },
    )
    _assert(res.get("status") == "refused", f"expected refused, got {res}")
    _assert(
        res.get("result_type") == "intent_or_clinical_error",
        f"expected intent_or_clinical_error, got {res}",
    )
    _assert(res.get("dose_result") is None, f"dose_result should be None on classifier failure, got {res}")
    _assert(
        "intent_classifier_error" in " ".join([str(x) for x in res.get("warnings", [])]),
        f"expected classifier error warning, got {res}",
    )


def main() -> int:
    tests = [
        ("classifier_json_parsing", test_classifier_json_parsing),
        ("classifier_without_client", test_classifier_without_client),
        ("service_resolve_intent", test_service_resolve_intent),
        ("service_refuse_without_plan_b", test_service_refuse_without_plan_b),
    ]
    passed = 0
    for name, fn in tests:
        fn()
        passed += 1
        print(f"[PASS] {name}")
    print(f"All tests passed: {passed}/{len(tests)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
