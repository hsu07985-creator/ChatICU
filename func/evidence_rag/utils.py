"""Utility functions used across the pipeline."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Iterable


TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]+", flags=re.UNICODE)


def stable_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def make_doc_id(file_path: str) -> str:
    return f"doc-{stable_hash(file_path)[:16]}"


def make_chunk_id(source_file: str, page: int, ordinal: int, text: str) -> str:
    key = f"{source_file}|{page}|{ordinal}|{text[:100]}"
    return f"chunk-{stable_hash(key)[:20]}"


def detect_language(text: str) -> str:
    zh_count = len(re.findall(r"[\u4e00-\u9fff]", text))
    en_count = len(re.findall(r"[A-Za-z]", text))
    if zh_count > 0 and en_count > 0:
        return "mixed"
    if zh_count > 0:
        return "zh"
    if en_count > 0:
        return "en"
    return "unknown"


def tokenize(text: str) -> list[str]:
    return [tok.lower() for tok in TOKEN_RE.findall(text)]


def split_sentences(text: str) -> list[str]:
    if not text.strip():
        return []
    parts = re.split(r"(?<=[。！？.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def noise_ratio(text: str) -> float:
    if not text:
        return 1.0
    useful = len(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", text))
    return max(0.0, 1 - useful / max(len(text), 1))


def infer_topic(source_path: str) -> str:
    p = Path(source_path)
    parent = p.parent.name
    if parent:
        return parent
    return "unknown"


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def batched(items: Iterable[str], batch_size: int) -> Iterable[list[str]]:
    batch: list[str] = []
    for item in items:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch

