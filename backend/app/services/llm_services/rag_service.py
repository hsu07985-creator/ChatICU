"""RAG service — retrieval-augmented generation for ICU medical literature.

Architecture:
    load_and_chunk() -> index() -> retrieve(question) -> query(question)
    Generation step uses app.llm.call_llm(task="rag_generation").
    Embedding uses app.llm.embed_texts() (OpenAI or TF-IDF fallback).
"""

from __future__ import annotations

import os
from typing import Any, Optional

import numpy as np

from app.config import settings
from app.llm import call_llm, embed_texts

RAG_DOCS_PATH = settings.RAG_DOCS_PATH or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "rag 文本",
)


class RAGService:

    def __init__(self):
        self.chunks: list[dict] = []
        self.embeddings: Optional[np.ndarray] = None
        self.is_indexed: bool = False

    def load_and_chunk(self, docs_path: Optional[str] = None) -> list[dict]:
        """Read files from docs_path, split into chunks."""
        from app.services.data_services.document_loader import load_documents
        from app.services.data_services.text_chunker import chunk_documents

        path = docs_path or RAG_DOCS_PATH
        documents = load_documents(path)
        chunks = chunk_documents(documents, chunk_size=1500, chunk_overlap=200)
        self.chunks = chunks
        return chunks

    def index(self, chunks: Optional[list[dict]] = None) -> dict:
        """Embed chunks and store in memory for similarity search."""
        if chunks is not None:
            self.chunks = chunks

        if not self.chunks:
            return {"status": "error", "message": "No chunks to index", "total_chunks": 0}

        texts = [c["text"] for c in self.chunks]
        vectors = embed_texts(texts)
        self.embeddings = np.array(vectors, dtype=np.float32)
        self.is_indexed = True

        categories = {}
        doc_ids = set()
        for c in self.chunks:
            cat = c.get("category", "uncategorized")
            categories[cat] = categories.get(cat, 0) + 1
            doc_ids.add(c["doc_id"])

        return {
            "status": "indexed",
            "total_chunks": len(self.chunks),
            "total_documents": len(doc_ids),
            "categories": categories,
            "embedding_dim": self.embeddings.shape[1] if self.embeddings is not None else 0,
        }

    def get_status(self) -> dict:
        """Return current index status for admin display."""
        if not self.is_indexed:
            return {"is_indexed": False, "total_chunks": 0, "total_documents": 0}
        doc_ids = set(c["doc_id"] for c in self.chunks)
        categories = {}
        for c in self.chunks:
            cat = c.get("category", "uncategorized")
            categories[cat] = categories.get(cat, 0) + 1
        return {
            "is_indexed": True,
            "total_chunks": len(self.chunks),
            "total_documents": len(doc_ids),
            "categories": categories,
            "embedding_dim": self.embeddings.shape[1] if self.embeddings is not None else 0,
            "embedding_model": settings.LLM_PROVIDER if settings.OPENAI_API_KEY else "tfidf",
        }

    def retrieve(self, question: str, top_k: int = 5) -> list[dict]:
        """Find most relevant chunks via cosine similarity."""
        if not self.is_indexed or self.embeddings is None:
            return []

        q_vec = np.array(embed_texts([question])[0], dtype=np.float32)

        q_norm = np.linalg.norm(q_vec)
        if q_norm > 0:
            q_vec = q_vec / q_norm

        norms = np.linalg.norm(self.embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        normed = self.embeddings / norms

        similarities = normed @ q_vec
        top_indices = np.argsort(similarities)[::-1][:top_k]

        results = []
        for idx in top_indices:
            chunk = self.chunks[idx]
            results.append({
                "doc_id": chunk["doc_id"],
                "text": chunk["text"],
                "score": float(similarities[idx]),
                "chunk_index": chunk["chunk_index"],
                "category": chunk.get("category", ""),
            })

        return results

    def query(self, question: str, top_k: int = 5) -> dict[str, Any]:
        """Full RAG pipeline: retrieve -> generate via call_llm."""
        sources = self.retrieve(question, top_k=top_k)
        context = "\n\n---\n\n".join([s["text"] for s in sources])

        result = call_llm(
            task="rag_generation",
            input_data={"question": question, "context": context},
        )

        return {
            "answer": result.get("content", ""),
            "sources": [
                {
                    "doc_id": s["doc_id"],
                    "score": s["score"],
                    "chunk_index": s["chunk_index"],
                    "category": s["category"],
                    "excerpt": s["text"][:200] + "..." if len(s["text"]) > 200 else s["text"],
                }
                for s in sources
            ],
            "metadata": result.get("metadata", {}),
        }


rag_service = RAGService()
