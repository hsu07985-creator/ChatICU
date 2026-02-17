"""Answer generation constrained by evidence with mandatory citations."""

from __future__ import annotations

from typing import Any

from openai import OpenAI

from .config import EvidenceRAGConfig
from .models import Citation, QueryResult
from .rerank import Candidate
from .validator import validate_answer_with_citations


class EvidenceAnswerer:
    """Generate grounded answers with citation enforcement."""

    def __init__(self, cfg: EvidenceRAGConfig):
        self.cfg = cfg
        self.client = OpenAI(api_key=cfg.openai_api_key) if cfg.openai_api_key else None

    def _build_citations(self, candidates: list[Candidate]) -> list[Citation]:
        citations: list[Citation] = []
        for i, cand in enumerate(candidates, start=1):
            snippet = cand.text.replace("\n", " ").strip()
            if len(snippet) > 260:
                snippet = snippet[:260] + "..."
            citations.append(
                Citation(
                    citation_id=f"C{i}",
                    chunk_id=cand.chunk_id,
                    source_file=str(cand.metadata.get("source_file", "")),
                    page=int(cand.metadata.get("page", 0)),
                    topic=str(cand.metadata.get("topic", "")),
                    score=float(cand.metadata.get("rerank_score", cand.fused_score)),
                    snippet=snippet,
                )
            )
        return citations

    def _confidence_from_candidates(self, candidates: list[Candidate]) -> float:
        if not candidates:
            return 0.0
        top = float(candidates[0].metadata.get("rerank_score", candidates[0].fused_score))
        conf = max(0.0, min(1.0, top))
        if conf < 0.15:
            conf = min(1.0, top * 2.5)
        return round(conf, 4)

    def _extractive_answer(self, question: str, citations: list[Citation]) -> str:
        lines = [
            f"根據檢索到的證據，以下是與問題最相關的重點：",
        ]
        for c in citations[:3]:
            lines.append(f"- {c.snippet} [{c.citation_id}]")
        lines.append("若需更精確答案，請進一步限定藥物、劑量或適應症範圍。 [C1]")
        return "\n".join(lines)

    def _llm_answer(self, question: str, citations: list[Citation]) -> str:
        if self.client is None:
            return self._extractive_answer(question, citations)

        evidence_block = "\n".join(
            [
                f"[{c.citation_id}] file={c.source_file}; page={c.page}; topic={c.topic}; snippet={c.snippet}"
                for c in citations
            ]
        )
        prompt = (
            "You are a strict medical RAG answerer.\n"
            "Rules:\n"
            "1) Use only evidence provided below.\n"
            "2) Every factual sentence must include at least one citation tag like [C1].\n"
            "3) If evidence is insufficient, explicitly say so.\n"
            "4) Keep the response concise and clinically precise.\n\n"
            f"Question:\n{question}\n\n"
            f"Evidence:\n{evidence_block}\n"
        )
        resp = self.client.responses.create(
            model=self.cfg.answer_model,
            input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        )
        text = (getattr(resp, "output_text", "") or "").strip()
        if not text:
            return self._extractive_answer(question, citations)
        return text

    def answer(self, question: str, candidates: list[Candidate]) -> QueryResult:
        confidence = self._confidence_from_candidates(candidates)
        if (not candidates) or confidence < self.cfg.min_evidence_score:
            reason = "insufficient_evidence"
            answer = "目前可用證據不足，無法提供可靠回答。請縮小問題範圍或指定藥物/情境。"
            return QueryResult(
                answer=answer,
                confidence=confidence,
                citations=[],
                evidence_snippets=[],
                refusal=self.cfg.force_refusal_without_evidence,
                refusal_reason=reason,
                debug={"candidate_count": len(candidates)},
            )

        citations = self._build_citations(candidates)
        answer = self._llm_answer(question=question, citations=citations)
        validation = validate_answer_with_citations(answer=answer, citations=citations)

        if not validation.ok:
            # Safety fallback to extractive answer to enforce citations.
            answer = self._extractive_answer(question=question, citations=citations)
            validation = validate_answer_with_citations(answer=answer, citations=citations)

        evidence_snippets = [
            {
                "citation_id": c.citation_id,
                "chunk_id": c.chunk_id,
                "source_file": c.source_file,
                "page": c.page,
                "topic": c.topic,
                "snippet": c.snippet,
                "score": c.score,
            }
            for c in citations
        ]

        return QueryResult(
            answer=answer,
            confidence=confidence,
            citations=citations,
            evidence_snippets=evidence_snippets,
            refusal=False,
            refusal_reason="",
            debug={
                "candidate_count": len(candidates),
                "validation_ok": validation.ok,
                "validation_issues": validation.issues,
            },
        )

