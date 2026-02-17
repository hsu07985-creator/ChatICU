"""Chunking strategies for evidence-first retrieval."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .config import EvidenceRAGConfig
from .utils import split_sentences


HEADER_RE = re.compile(r"^\s*(#{1,6}\s+|[0-9]+[\.\)]\s+|[A-Z][A-Z\s]{3,}:?)")


@dataclass
class TextSpan:
    page: int
    section: str
    text: str


def infer_section(line: str, current: str) -> str:
    if HEADER_RE.match(line.strip()):
        return line.strip()[:160]
    return current


def to_spans(page_text: dict[int, str]) -> list[TextSpan]:
    spans: list[TextSpan] = []
    for page, text in sorted(page_text.items()):
        section = f"page_{page + 1}"
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        buf: list[str] = []

        for line in lines:
            section = infer_section(line, section)
            buf.append(line)
        merged = "\n".join(buf).strip()
        if merged:
            spans.append(TextSpan(page=page, section=section, text=merged))
    return spans


def chunk_span_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    sentences = split_sentences(text)
    if not sentences:
        return []
    chunks: list[str] = []
    cur = ""

    for sent in sentences:
        if len(cur) + len(sent) + 1 <= chunk_size:
            cur = f"{cur} {sent}".strip()
            continue
        if cur:
            chunks.append(cur)
        cur = sent

    if cur:
        chunks.append(cur)

    if overlap <= 0 or len(chunks) <= 1:
        return chunks

    merged: list[str] = [chunks[0]]
    for chunk in chunks[1:]:
        prev_tail = merged[-1][-overlap:]
        merged.append(f"{prev_tail} {chunk}".strip())
    return merged


def build_chunks_for_pages(page_text: dict[int, str], cfg: EvidenceRAGConfig) -> list[TextSpan]:
    spans = to_spans(page_text)
    out: list[TextSpan] = []
    for span in spans:
        chunks = chunk_span_text(
            text=span.text,
            chunk_size=cfg.chunk_size_chars,
            overlap=cfg.chunk_overlap_chars,
        )
        for chunk in chunks:
            out.append(TextSpan(page=span.page, section=span.section, text=chunk))
    return out

