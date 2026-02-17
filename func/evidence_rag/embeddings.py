"""Embedding providers for dense retrieval."""

from __future__ import annotations

import hashlib
import re
from abc import ABC, abstractmethod

import numpy as np
from openai import OpenAI

from .config import EvidenceRAGConfig
from .utils import batched, tokenize


class BaseEmbedder(ABC):
    @abstractmethod
    def embed_texts(self, texts: list[str]) -> np.ndarray:
        raise NotImplementedError

    @abstractmethod
    def signature(self) -> str:
        raise NotImplementedError


class HashingEmbedder(BaseEmbedder):
    """Deterministic local embedder used when no API key is available."""

    def __init__(self, dim: int = 1024):
        self.dim = dim

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        mat = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, text in enumerate(texts):
            toks = tokenize(text)
            if not toks:
                continue
            for tok in toks:
                h = int(hashlib.sha1(tok.encode("utf-8")).hexdigest(), 16)
                mat[i, h % self.dim] += 1.0
            norm = np.linalg.norm(mat[i])
            if norm > 0:
                mat[i] /= norm
        return mat

    def signature(self) -> str:
        return f"hashing:{self.dim}"


class OpenAIEmbedder(BaseEmbedder):
    """OpenAI embedding provider."""

    def __init__(self, cfg: EvidenceRAGConfig):
        self.cfg = cfg
        self.client = OpenAI(api_key=cfg.openai_api_key)
        self.max_chars = max(256, int(cfg.embedding_max_chars))

    def _prepare_text(self, text: str) -> str:
        # Normalize whitespace and clip oversized chunks to avoid embedding context-limit failures.
        cleaned = re.sub(r"\s+", " ", text or "").strip()
        if len(cleaned) <= self.max_chars:
            return cleaned
        return cleaned[: self.max_chars]

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        prepared = [self._prepare_text(t) for t in texts]
        vectors: list[list[float]] = []
        for batch in batched(prepared, 64):
            resp = self.client.embeddings.create(model=self.cfg.embedding_model, input=batch)
            vectors.extend([x.embedding for x in resp.data])
        arr = np.array(vectors, dtype=np.float32)
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        return arr / norms

    def signature(self) -> str:
        return f"openai:{self.cfg.embedding_model}:max_chars={self.max_chars}"


def build_embedder(cfg: EvidenceRAGConfig) -> BaseEmbedder:
    if cfg.openai_api_key:
        return OpenAIEmbedder(cfg)
    return HashingEmbedder()
