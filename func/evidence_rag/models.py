"""Internal data models for evidence-first RAG."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class ChunkRecord:
    """A canonical chunk ready for indexing and citation."""

    chunk_id: str
    doc_id: str
    text: str
    source_file: str
    topic: str
    page: int
    source_type: str
    language: str
    section: str = ""
    parser: str = "mineru"
    quality_score: float = 1.0
    fallback_used: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Citation:
    """Citation pointer for one chunk."""

    citation_id: str
    chunk_id: str
    source_file: str
    page: int
    topic: str
    score: float
    snippet: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class QueryResult:
    """Structured answer payload returned to API clients."""

    answer: str
    confidence: float
    citations: list[Citation]
    evidence_snippets: list[dict[str, Any]]
    refusal: bool = False
    refusal_reason: str = ""
    debug: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "confidence": self.confidence,
            "citations": [c.to_dict() for c in self.citations],
            "evidence_snippets": self.evidence_snippets,
            "refusal": self.refusal,
            "refusal_reason": self.refusal_reason,
            "debug": self.debug,
        }

