"""Persistence helpers for chunks and index artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import numpy as np

from .models import ChunkRecord


class ArtifactStore:
    """Simple file-based artifact store."""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.raw_dir = base_dir / "raw"
        self.index_dir = base_dir / "index"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.index_dir.mkdir(parents=True, exist_ok=True)

    @property
    def chunks_path(self) -> Path:
        return self.raw_dir / "chunks.jsonl"

    @property
    def ingest_report_path(self) -> Path:
        return self.raw_dir / "ingestion_report.json"

    @property
    def vector_path(self) -> Path:
        return self.index_dir / "dense_vectors.npy"

    @property
    def bm25_path(self) -> Path:
        return self.index_dir / "bm25.json"

    @property
    def ids_path(self) -> Path:
        return self.index_dir / "chunk_ids.json"

    @property
    def index_meta_path(self) -> Path:
        return self.index_dir / "index_meta.json"

    @property
    def source_snapshot_path(self) -> Path:
        return self.raw_dir / "source_snapshot.json"

    def save_chunks(self, chunks: Iterable[ChunkRecord]) -> None:
        with self.chunks_path.open("w", encoding="utf-8") as f:
            for chunk in chunks:
                f.write(json.dumps(chunk.to_dict(), ensure_ascii=False) + "\n")

    def load_chunks(self) -> list[ChunkRecord]:
        if not self.chunks_path.exists():
            return []
        rows: list[ChunkRecord] = []
        with self.chunks_path.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                payload = json.loads(line)
                rows.append(ChunkRecord(**payload))
        return rows

    def save_vector_index(self, vectors: np.ndarray, chunk_ids: list[str]) -> None:
        np.save(self.vector_path, vectors)
        self.ids_path.write_text(json.dumps(chunk_ids, ensure_ascii=False), encoding="utf-8")

    def load_vector_index(self) -> tuple[np.ndarray, list[str]]:
        if not self.vector_path.exists() or not self.ids_path.exists():
            return np.array([]), []
        vectors = np.load(self.vector_path)
        chunk_ids = json.loads(self.ids_path.read_text(encoding="utf-8"))
        return vectors, chunk_ids

    def save_index_meta(self, payload: dict) -> None:
        self.index_meta_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def load_index_meta(self) -> dict:
        if not self.index_meta_path.exists():
            return {}
        return json.loads(self.index_meta_path.read_text(encoding="utf-8"))

    def save_bm25_payload(self, payload: dict) -> None:
        self.bm25_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def load_bm25_payload(self) -> dict:
        if not self.bm25_path.exists():
            return {}
        return json.loads(self.bm25_path.read_text(encoding="utf-8"))

    def save_source_snapshot(self, payload: dict) -> None:
        self.source_snapshot_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def load_source_snapshot(self) -> dict:
        if not self.source_snapshot_path.exists():
            return {}
        return json.loads(self.source_snapshot_path.read_text(encoding="utf-8"))
