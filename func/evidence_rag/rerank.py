"""Reranking candidates after hybrid retrieval."""

from __future__ import annotations

from dataclasses import dataclass

from .utils import tokenize


@dataclass
class Candidate:
    chunk_id: str
    text: str
    fused_score: float
    dense_score: float
    bm25_score: float
    metadata: dict


def lexical_overlap_ratio(query: str, text: str) -> float:
    q = set(tokenize(query))
    if not q:
        return 0.0
    t = set(tokenize(text))
    if not t:
        return 0.0
    return len(q & t) / len(q)


def rerank_candidates(query: str, candidates: list[Candidate], top_k: int) -> list[Candidate]:
    rescored: list[tuple[Candidate, float]] = []
    for c in candidates:
        overlap = lexical_overlap_ratio(query, c.text)
        score = 0.55 * c.fused_score + 0.30 * c.dense_score + 0.15 * overlap
        c.metadata["overlap"] = overlap
        rescored.append((c, score))

    rescored.sort(key=lambda x: x[1], reverse=True)
    out = []
    for c, s in rescored[:top_k]:
        c.metadata["rerank_score"] = round(s, 6)
        out.append(c)
    return out

