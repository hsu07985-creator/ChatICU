"""Top-level service orchestration for evidence-first RAG."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from .answering import EvidenceAnswerer
from .clinical import (
    ApiRuleRepository,
    ClinicalIntentClassifier,
    ClinicalRuleStore,
    DoseEngine,
    InteractionEngine,
    JsonRuleRepository,
)
from .clinical.exceptions import ClinicalInputError, ClinicalRuleError
from .clinical.router import KNOWN_INTENTS
from .config import EvidenceRAGConfig
from .ingest import IngestionPipeline
from .models import QueryResult
from .retrieval import HybridRetriever
from .storage import ArtifactStore


class EvidenceRAGService:
    """Facade for ingest, retrieval, and answering."""

    def __init__(self, cfg: EvidenceRAGConfig | None = None):
        self.cfg = cfg or EvidenceRAGConfig()
        self.cfg.ensure_dirs()
        self.rule_source_active = "json"
        self.rule_source_warning = ""
        self.store = ArtifactStore(self.cfg.work_dir)
        self.ingestion = IngestionPipeline(cfg=self.cfg, store=self.store)
        self.retriever = HybridRetriever(cfg=self.cfg, store=self.store)
        self.answerer = EvidenceAnswerer(cfg=self.cfg)
        self.rule_store = self._build_rule_store()
        self.dose_engine = DoseEngine(self.rule_store)
        self.interaction_engine = InteractionEngine(self.rule_store)
        self.intent_classifier = ClinicalIntentClassifier(
            api_key=self.cfg.openai_api_key,
            model=self.cfg.intent_model,
        )
        self.retriever.load_or_build(force_rebuild=False)

    def _build_rule_store(self) -> ClinicalRuleStore:
        source = str(self.cfg.clinical_rule_source or "json").strip().lower()
        if source == "api":
            api_url = str(self.cfg.clinical_rule_api_url or "").strip()
            if not api_url:
                self.rule_source_active = "json"
                self.rule_source_warning = (
                    "clinical_rule_source=api but EVIDENCE_RAG_CLINICAL_RULE_API_URL is empty; fallback to json"
                )
                return ClinicalRuleStore(
                    repository=JsonRuleRepository(self.cfg.clinical_manifest_path)
                )
            self.rule_source_active = "api"
            return ClinicalRuleStore(
                repository=ApiRuleRepository(
                    api_url=api_url,
                    timeout_sec=self.cfg.clinical_rule_api_timeout_sec,
                    poll_interval_sec=self.cfg.clinical_rule_api_poll_interval_sec,
                    bearer_token=self.cfg.clinical_rule_api_token,
                )
            )

        if source != "json":
            self.rule_source_warning = (
                f"Unknown clinical rule source `{source}`; fallback to json"
            )
        self.rule_source_active = "json"
        return ClinicalRuleStore(repository=JsonRuleRepository(self.cfg.clinical_manifest_path))

    def ingest(self, source_dir: str | None = None, recursive: bool = True) -> dict:
        src = Path(source_dir) if source_dir else self.cfg.source_dir
        summary = self.ingestion.run(source_dir=src, recursive=recursive)
        self.retriever.load_or_build(force_rebuild=True)
        return asdict(summary)

    def _infer_topic_filter(self, question: str) -> list[str] | None:
        q = question.lower()
        topic_map = {
            "0_guideline": ["guideline", "padis", "指引", "建議", "台灣 pad", "taiwan pad"],
            "1_analgesic": ["pain", "analges", "fentanyl", "morphine", "cpot", "bps", "疼痛", "止痛"],
            "2_sedation": [
                "sedation",
                "sedative",
                "dexmedetomidine",
                "propofol",
                "midazolam",
                "lorazepam",
                "precedex",
                "鎮靜",
            ],
            "3_NM blocker": [
                "neuromuscular",
                "nm blocker",
                "rocuronium",
                "cisatracurium",
                "nimbex",
                "肌肉鬆弛",
            ],
            "5_delirium": ["delirium", "confusion", "cam", "haloperidol", "quetiapine", "olanzapine", "譫妄"],
        }
        matched: list[str] = []
        for topic, keys in topic_map.items():
            if any(k in q for k in keys):
                matched.append(topic)
        return matched or None

    def _is_medical_query(self, question: str) -> bool:
        q = question.lower()
        medical_keys = [
            "icu",
            "intensive care",
            "analges",
            "pain",
            "sedation",
            "delirium",
            "nmb",
            "neuromuscular",
            "rass",
            "cam-icu",
            "cpot",
            "bps",
            "fentanyl",
            "morphine",
            "dexmedetomidine",
            "propofol",
            "midazolam",
            "lorazepam",
            "haloperidol",
            "quetiapine",
            "olanzapine",
            "rocuronium",
            "cisatracurium",
            "鎮靜",
            "鎮痛",
            "疼痛",
            "譫妄",
            "重症",
            "加護",
            "加護病房",
            "神經肌肉",
            "肌肉鬆弛",
            "劑量",
            "不良反應",
            "指引",
            "藥物",
        ]
        return any(k in q for k in medical_keys)

    def _is_obviously_non_medical(self, question: str) -> bool:
        q = question.lower()
        non_medical_keys = [
            "weather",
            "temperature",
            "stock",
            "bitcoin",
            "crypto",
            "restaurant",
            "movie",
            "music",
            "travel",
            "天氣",
            "氣溫",
            "股票",
            "股價",
            "比特幣",
            "旅遊",
            "餐廳",
            "電影",
            "音樂",
        ]
        return any(k in q for k in non_medical_keys)

    def query(
        self, question: str, top_k: int | None = None, topic_filter: list[str] | None = None
    ) -> QueryResult:
        if not topic_filter and self._is_obviously_non_medical(question):
            return QueryResult(
                answer="目前問題超出已建立的醫療語料範圍，請改問 ICU 鎮痛/鎮靜/譫妄相關問題。",
                confidence=0.0,
                citations=[],
                evidence_snippets=[],
                refusal=True,
                refusal_reason="out_of_scope",
                debug={"topic_filter_applied": [], "scope_check": "non_medical_intent"},
            )
        inferred_filter = topic_filter or self._infer_topic_filter(question)
        if not topic_filter and not inferred_filter and not self._is_medical_query(question):
            return QueryResult(
                answer="目前問題超出已建立的醫療語料範圍，請改問 ICU 鎮痛/鎮靜/譫妄相關問題。",
                confidence=0.0,
                citations=[],
                evidence_snippets=[],
                refusal=True,
                refusal_reason="out_of_scope",
                debug={"topic_filter_applied": [], "scope_check": "out_of_domain"},
            )
        candidates = self.retriever.search(
            query=question,
            top_k=top_k or self.cfg.retrieval_top_k,
            candidate_k=self.cfg.candidate_pool_k,
            topic_filter=inferred_filter,
        )
        result = self.answerer.answer(question=question, candidates=candidates)
        result.debug["topic_filter_applied"] = inferred_filter or []
        return result

    def source_by_chunk_id(self, chunk_id: str) -> dict:
        return self.retriever.source_by_chunk_id(chunk_id)

    def clinical_rule_snapshot(self) -> dict:
        return self.rule_store.snapshot()

    def reload_clinical_rules(self) -> dict:
        self.rule_store.reload()
        return self.rule_store.snapshot()

    def _query_to_payload(self, result: QueryResult) -> dict:
        return result.to_dict()

    def _rag_for_context(
        self,
        *,
        question: str | None,
        top_k: int | None = None,
        topic_filter: list[str] | None = None,
    ) -> dict | None:
        q = (question or "").strip()
        if not q:
            return None
        try:
            result = self.query(question=q, top_k=top_k, topic_filter=topic_filter)
            return self._query_to_payload(result)
        except Exception as e:
            return {
                "answer": "RAG context temporarily unavailable.",
                "confidence": 0.0,
                "citations": [],
                "evidence_snippets": [],
                "refusal": True,
                "refusal_reason": "rag_unavailable",
                "debug": {"rag_error": str(e)},
            }

    def dose_calculate(self, req: dict[str, Any]) -> dict[str, Any]:
        request_id = str(req.get("request_id", "dose-mock-request"))
        try:
            payload = self.dose_engine.calculate(req)
        except (ClinicalInputError, ClinicalRuleError) as e:
            payload = {
                "request_id": request_id,
                "status": "refused",
                "result_type": "dose_calculation",
                "error_code": "RULE_OR_INPUT_ERROR",
                "message": str(e),
                "computed_values": {},
                "calculation_steps": [],
                "applied_rules": [],
                "safety_warnings": [str(e)],
                "citations": [],
                "confidence": 0.0,
            }
        rag = self._rag_for_context(
            question=req.get("question") or f"{req.get('drug', '')} {req.get('indication', '')} 劑量與注意事項",
            top_k=req.get("top_k"),
            topic_filter=req.get("topic_filter"),
        )
        payload["rag"] = rag
        return payload

    def interaction_check(self, req: dict[str, Any]) -> dict[str, Any]:
        request_id = str(req.get("request_id", "interaction-mock-request"))
        try:
            payload = self.interaction_engine.check(req)
        except (ClinicalInputError, ClinicalRuleError) as e:
            payload = {
                "request_id": request_id,
                "status": "refused",
                "result_type": "interaction_check",
                "overall_severity": "none",
                "findings": [],
                "applied_rules": [],
                "citations": [],
                "conflicts": [],
                "confidence": 0.0,
            }
        rag_question = req.get("question")
        if not rag_question:
            drug_list = req.get("drug_list", []) or []
            rag_question = f"{' 與 '.join(drug_list)} 交互作用與臨床建議"
        rag = self._rag_for_context(
            question=rag_question,
            top_k=req.get("top_k"),
            topic_filter=req.get("topic_filter"),
        )
        payload["rag"] = rag
        return payload

    def _resolve_clinical_intent(self, req: dict[str, Any], question: str) -> tuple[str, dict[str, Any]]:
        explicit_intent = str(req.get("intent", "auto") or "auto").strip().lower()
        if explicit_intent != "auto" and explicit_intent not in KNOWN_INTENTS:
            raise ClinicalInputError(f"Unsupported intent: {explicit_intent}")
        if explicit_intent in KNOWN_INTENTS and explicit_intent != "auto":
            return explicit_intent, {"source": "explicit", "confidence": 1.0, "reason": "explicit intent"}

        intent, meta = self.intent_classifier.classify(
            question=question,
            has_drug=bool(req.get("drug")),
            has_drug_list=bool(req.get("drug_list")),
            has_patient_context=bool(req.get("patient_context")),
            has_dose_target=bool(req.get("dose_target")),
        )
        return intent, meta

    def clinical_query(self, req: dict[str, Any]) -> dict[str, Any]:
        request_id = str(req.get("request_id", "clinical-mock-request"))
        question = str(req.get("question", "") or "")
        routed_intent = "unresolved"

        try:
            intent, _intent_meta = self._resolve_clinical_intent(req=req, question=question)
            routed_intent = intent
            intent_warnings: list[str] = []

            if intent == "knowledge_qa":
                rag = self._rag_for_context(
                    question=question,
                    top_k=req.get("top_k"),
                    topic_filter=req.get("topic_filter"),
                )
                citations = list((rag or {}).get("citations", []))
                return {
                    "request_id": request_id,
                    "intent": intent,
                    "status": "ok",
                    "result_type": "knowledge_qa",
                    "confidence": float((rag or {}).get("confidence", 0.0)),
                    "warnings": intent_warnings,
                    "rag": rag,
                    "dose_result": None,
                    "interaction_result": None,
                    "citations": citations,
                }

            if intent == "dose_calc":
                dose_req = {
                    "request_id": request_id,
                    "drug": req.get("drug"),
                    "indication": req.get("indication"),
                    "patient_context": req.get("patient_context", {}),
                    "dose_target": req.get("dose_target", {}),
                    "question": question,
                    "top_k": req.get("top_k"),
                    "topic_filter": req.get("topic_filter"),
                }
                dose_result = self.dose_calculate(dose_req)
                rag = dose_result.get("rag")
                citations = list(dose_result.get("citations", []))
                citations.extend(list((rag or {}).get("citations", [])))
                return {
                    "request_id": request_id,
                    "intent": intent,
                    "status": "ok" if dose_result.get("status") == "ok" else "refused",
                    "result_type": "dose_calc",
                    "confidence": float(dose_result.get("confidence", 0.0)),
                    "warnings": intent_warnings + list(dose_result.get("safety_warnings", [])),
                    "rag": rag,
                    "dose_result": dose_result,
                    "interaction_result": None,
                    "citations": citations,
                }

            if intent == "interaction_check":
                int_req = {
                    "request_id": request_id,
                    "drug_list": req.get("drug_list", []),
                    "patient_context": req.get("patient_context", {}),
                    "question": question,
                    "top_k": req.get("top_k"),
                    "topic_filter": req.get("topic_filter"),
                }
                interaction_result = self.interaction_check(int_req)
                rag = interaction_result.get("rag")
                citations = list(interaction_result.get("citations", []))
                citations.extend(list((rag or {}).get("citations", [])))
                warnings: list[str] = list(intent_warnings)
                if interaction_result.get("conflicts"):
                    warnings.append("interaction_rule_conflict_detected")
                return {
                    "request_id": request_id,
                    "intent": intent,
                    "status": "ok",
                    "result_type": "interaction_check",
                    "confidence": float(interaction_result.get("confidence", 0.0)),
                    "warnings": warnings,
                    "rag": rag,
                    "dose_result": None,
                    "interaction_result": interaction_result,
                    "citations": citations,
                }

            if intent not in {"dose_calc", "interaction_check", "hybrid", "knowledge_qa"}:
                raise ClinicalInputError(f"Unsupported routed intent: {intent}")

            # hybrid
            dose_req = {
                "request_id": request_id,
                "drug": req.get("drug"),
                "indication": req.get("indication"),
                "patient_context": req.get("patient_context", {}),
                "dose_target": req.get("dose_target", {}),
                "question": question,
                "top_k": req.get("top_k"),
                "topic_filter": req.get("topic_filter"),
            }
            int_req = {
                "request_id": request_id,
                "drug_list": req.get("drug_list", []),
                "patient_context": req.get("patient_context", {}),
                "question": question,
                "top_k": req.get("top_k"),
                "topic_filter": req.get("topic_filter"),
            }
            dose_result = self.dose_calculate(dose_req)
            interaction_result = self.interaction_check(int_req)
            rag = self._rag_for_context(
                question=question,
                top_k=req.get("top_k"),
                topic_filter=req.get("topic_filter"),
            )
            citations: list[dict] = []
            citations.extend(list(dose_result.get("citations", [])))
            citations.extend(list(interaction_result.get("citations", [])))
            citations.extend(list((rag or {}).get("citations", [])))
            warnings = list(intent_warnings) + list(dose_result.get("safety_warnings", []))
            if interaction_result.get("conflicts"):
                warnings.append("interaction_rule_conflict_detected")
            return {
                "request_id": request_id,
                "intent": intent,
                "status": "ok",
                "result_type": "hybrid",
                "confidence": round(
                    (float(dose_result.get("confidence", 0.0)) + float(interaction_result.get("confidence", 0.0)))
                    / 2,
                    4,
                ),
                "warnings": warnings,
                "rag": rag,
                "dose_result": dose_result,
                "interaction_result": interaction_result,
                "citations": citations,
            }

        except Exception as e:
            return {
                "request_id": request_id,
                "intent": routed_intent,
                "status": "refused",
                "result_type": "intent_or_clinical_error",
                "confidence": 0.0,
                "warnings": [str(e)],
                "rag": None,
                "dose_result": None,
                "interaction_result": None,
                "citations": [],
            }

    def health(self) -> dict:
        snapshot = self.retriever.debug_snapshot()
        rules_loaded = False
        rule_versions = {"dose": "", "interaction": ""}
        try:
            loaded = self.rule_store.load()
            rules_loaded = True
            rule_versions = {
                "dose": str(loaded.dose.get("version", "")),
                "interaction": str(loaded.interaction.get("version", "")),
            }
        except Exception:
            pass
        return {
            "status": "ok",
            "source_dir": str(self.cfg.source_dir),
            "work_dir": str(self.cfg.work_dir),
            "vision_fallback_enabled": self.cfg.enable_vision_fallback,
            "openai_key_present": bool(self.cfg.openai_api_key),
            "clinical_intent_router": "llm",
            "clinical_intent_model": self.cfg.intent_model,
            "clinical_intent_fallback_enabled": False,
            "clinical_rule_source_config": self.cfg.clinical_rule_source,
            "clinical_rule_source_active": self.rule_source_active,
            "clinical_rule_source_warning": self.rule_source_warning,
            "clinical_rules_loaded": rules_loaded,
            "clinical_rule_versions": rule_versions,
            "index": snapshot,
        }
