"""A lightweight BM25 implementation."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .utils import tokenize


@dataclass
class BM25Result:
    doc_index: int
    score: float


class BM25Index:
    """Simple BM25 index over in-memory tokenized documents."""

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.docs_tokens: list[list[str]] = []
        self.doc_len: list[int] = []
        self.avg_doc_len = 0.0
        self.df: dict[str, int] = {}
        self.idf: dict[str, float] = {}

    def fit(self, texts: list[str]) -> None:
        self.docs_tokens = [tokenize(t) for t in texts]
        self.doc_len = [len(toks) for toks in self.docs_tokens]
        self.avg_doc_len = (sum(self.doc_len) / len(self.doc_len)) if self.doc_len else 0.0

        self.df = {}
        for toks in self.docs_tokens:
            for tok in set(toks):
                self.df[tok] = self.df.get(tok, 0) + 1

        n_docs = len(self.docs_tokens)
        self.idf = {}
        for tok, freq in self.df.items():
            # Robertson/Sparck Jones idf
            self.idf[tok] = math.log(1 + (n_docs - freq + 0.5) / (freq + 0.5))

    def search(self, query: str, top_k: int = 20) -> list[BM25Result]:
        q_tokens = tokenize(query)
        if not q_tokens or not self.docs_tokens:
            return []

        scores = [0.0] * len(self.docs_tokens)
        for idx, toks in enumerate(self.docs_tokens):
            tf_map: dict[str, int] = {}
            for t in toks:
                tf_map[t] = tf_map.get(t, 0) + 1
            dl = self.doc_len[idx]

            score = 0.0
            for q in q_tokens:
                if q not in tf_map:
                    continue
                tf = tf_map[q]
                idf = self.idf.get(q, 0.0)
                denom = tf + self.k1 * (1 - self.b + self.b * dl / max(self.avg_doc_len, 1e-9))
                score += idf * (tf * (self.k1 + 1)) / max(denom, 1e-9)
            scores[idx] = score

        ranked = sorted(
            [BM25Result(doc_index=i, score=s) for i, s in enumerate(scores)],
            key=lambda x: x.score,
            reverse=True,
        )
        return [r for r in ranked[:top_k] if r.score > 0]

    def to_payload(self) -> dict:
        return {
            "k1": self.k1,
            "b": self.b,
            "docs_tokens": self.docs_tokens,
            "doc_len": self.doc_len,
            "avg_doc_len": self.avg_doc_len,
            "df": self.df,
            "idf": self.idf,
        }

    @classmethod
    def from_payload(cls, payload: dict) -> "BM25Index":
        idx = cls(k1=float(payload.get("k1", 1.5)), b=float(payload.get("b", 0.75)))
        idx.docs_tokens = payload.get("docs_tokens", [])
        idx.doc_len = payload.get("doc_len", [])
        idx.avg_doc_len = float(payload.get("avg_doc_len", 0.0))
        idx.df = payload.get("df", {})
        idx.idf = payload.get("idf", {})
        return idx

