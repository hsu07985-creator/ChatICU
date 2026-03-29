"""RAG chunk model — pgvector-backed storage for document embeddings."""

from typing import Any, Optional, List
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# text-embedding-3-large default dimension
RAG_EMBEDDING_DIM = 1536

# Try to import pgvector; fall back to LargeBinary for test environments (SQLite)
try:
    from pgvector.sqlalchemy import Vector
    _vector_type = Vector(RAG_EMBEDDING_DIM)
except ImportError:
    _vector_type = LargeBinary


class RagChunk(Base):
    __tablename__ = "rag_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_id: Mapped[str] = mapped_column(String(200), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    contextual_prefix: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contextual_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    meta: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    embedding: Mapped[Any] = mapped_column(type_=_vector_type, nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(100))
    source_fingerprint: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
