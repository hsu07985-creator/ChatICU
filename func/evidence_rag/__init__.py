"""Evidence-first medical RAG package."""

from .config import EvidenceRAGConfig

__all__ = ["EvidenceRAGConfig", "EvidenceRAGService"]


def __getattr__(name: str):
    if name == "EvidenceRAGService":
        from .service import EvidenceRAGService

        return EvidenceRAGService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
