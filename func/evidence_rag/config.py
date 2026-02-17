"""Configuration for evidence-first RAG."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _default_source_dir() -> str:
    local = PROJECT_ROOT / "rag 文本"
    parent = PROJECT_ROOT.parent / "rag 文本"
    if local.exists():
        return str(local)
    return str(parent)


@dataclass
class EvidenceRAGConfig:
    """Runtime configuration for the evidence-first RAG pipeline."""

    source_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "EVIDENCE_RAG_SOURCE_DIR",
                _default_source_dir(),
            )
        )
    )
    work_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("EVIDENCE_RAG_WORK_DIR", str(PROJECT_ROOT / "evidence_rag_data"))
        )
    )
    parser_output_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "EVIDENCE_RAG_PARSER_OUTPUT_DIR",
                str(PROJECT_ROOT / "evidence_parser_output"),
            )
        )
    )
    clinical_rules_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("EVIDENCE_RAG_CLINICAL_RULES_DIR", str(PROJECT_ROOT / "clinical_rules"))
        )
    )
    clinical_manifest_path: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "EVIDENCE_RAG_CLINICAL_MANIFEST",
                str(PROJECT_ROOT / "clinical_rules" / "release_manifest.json"),
            )
        )
    )
    clinical_rule_source: str = os.getenv("EVIDENCE_RAG_CLINICAL_RULE_SOURCE", "json")
    clinical_rule_api_url: str = os.getenv("EVIDENCE_RAG_CLINICAL_RULE_API_URL", "")
    clinical_rule_api_timeout_sec: float = float(
        os.getenv("EVIDENCE_RAG_CLINICAL_RULE_API_TIMEOUT_SEC", "8")
    )
    clinical_rule_api_poll_interval_sec: int = int(
        os.getenv("EVIDENCE_RAG_CLINICAL_RULE_API_POLL_INTERVAL_SEC", "30")
    )
    clinical_rule_api_token: str | None = os.getenv("EVIDENCE_RAG_CLINICAL_RULE_API_TOKEN")
    pdf_backend: str = os.getenv("EVIDENCE_RAG_PDF_BACKEND", "pypdf")

    # Retrieval and chunking
    chunk_size_chars: int = int(os.getenv("EVIDENCE_RAG_CHUNK_SIZE", "1400"))
    chunk_overlap_chars: int = int(os.getenv("EVIDENCE_RAG_CHUNK_OVERLAP", "180"))
    retrieval_top_k: int = int(os.getenv("EVIDENCE_RAG_TOP_K", "8"))
    candidate_pool_k: int = int(os.getenv("EVIDENCE_RAG_CANDIDATE_K", "40"))
    rrf_k: int = int(os.getenv("EVIDENCE_RAG_RRF_K", "60"))
    min_evidence_score: float = float(
        os.getenv("EVIDENCE_RAG_MIN_EVIDENCE_SCORE", "0.22")
    )

    # OCR quality gate
    min_text_chars_per_page: int = int(
        os.getenv("EVIDENCE_RAG_MIN_TEXT_CHARS_PER_PAGE", "140")
    )
    max_noise_ratio: float = float(os.getenv("EVIDENCE_RAG_MAX_NOISE_RATIO", "0.45"))
    enable_vision_fallback: bool = (
        os.getenv("EVIDENCE_RAG_ENABLE_VISION_FALLBACK", "true").lower() == "true"
    )
    fallback_page_limit: int = int(os.getenv("EVIDENCE_RAG_FALLBACK_PAGE_LIMIT", "8"))

    # Models
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    embedding_model: str = os.getenv(
        "EVIDENCE_RAG_EMBEDDING_MODEL", "text-embedding-3-large"
    )
    embedding_max_chars: int = int(os.getenv("EVIDENCE_RAG_EMBEDDING_MAX_CHARS", "6000"))
    answer_model: str = os.getenv("EVIDENCE_RAG_ANSWER_MODEL", "gpt-4.1-mini")
    vision_model: str = os.getenv("EVIDENCE_RAG_VISION_MODEL", "gpt-4.1-mini")
    intent_model: str = os.getenv(
        "EVIDENCE_RAG_INTENT_MODEL",
        os.getenv("EVIDENCE_RAG_ANSWER_MODEL", "gpt-4.1-mini"),
    )

    # Operational
    language_hint: str = os.getenv("EVIDENCE_RAG_LANGUAGE_HINT", "zh,en")
    force_refusal_without_evidence: bool = (
        os.getenv("EVIDENCE_RAG_FORCE_REFUSAL", "true").lower() == "true"
    )
    store_raw_page_text: bool = (
        os.getenv("EVIDENCE_RAG_STORE_RAW_PAGE_TEXT", "true").lower() == "true"
    )

    def ensure_dirs(self) -> None:
        """Create required directories."""
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.parser_output_dir.mkdir(parents=True, exist_ok=True)
        self.clinical_rules_dir.mkdir(parents=True, exist_ok=True)
        (self.work_dir / "raw").mkdir(parents=True, exist_ok=True)
        (self.work_dir / "index").mkdir(parents=True, exist_ok=True)
        (self.work_dir / "logs").mkdir(parents=True, exist_ok=True)
