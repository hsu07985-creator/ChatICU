"""Auto-ingest entrypoint with change detection for source files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import EvidenceRAGConfig
from .ingest import SUPPORTED_EXT
from .service import EvidenceRAGService
from .utils import stable_hash


def _collect_files(source_dir: Path, recursive: bool) -> list[Path]:
    globber = source_dir.rglob if recursive else source_dir.glob
    return sorted(
        [p for p in globber("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXT]
    )


def _build_source_snapshot(source_dir: Path, recursive: bool) -> dict:
    files = _collect_files(source_dir=source_dir, recursive=recursive)
    rows: list[dict] = []
    for p in files:
        st = p.stat()
        rows.append(
            {
                "path": str(p.relative_to(source_dir)),
                "size": int(st.st_size),
                "mtime_ns": int(st.st_mtime_ns),
            }
        )
    raw = json.dumps(rows, ensure_ascii=False, sort_keys=True)
    return {
        "source_dir": str(source_dir.resolve()),
        "recursive": recursive,
        "file_count": len(rows),
        "fingerprint": stable_hash(raw),
        "files": rows,
    }


def _index_artifacts_exist(cfg: EvidenceRAGConfig) -> bool:
    return (
        (cfg.work_dir / "raw" / "chunks.jsonl").exists()
        and (cfg.work_dir / "index" / "dense_vectors.npy").exists()
        and (cfg.work_dir / "index" / "chunk_ids.json").exists()
        and (cfg.work_dir / "index" / "bm25.json").exists()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto ingest with source-change detection")
    parser.add_argument("--source-dir", default=None)
    parser.add_argument("--no-recursive", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    svc = EvidenceRAGService()
    cfg = svc.cfg
    source_dir = Path(args.source_dir) if args.source_dir else cfg.source_dir
    recursive = not args.no_recursive

    current_snapshot = _build_source_snapshot(source_dir=source_dir, recursive=recursive)
    previous_snapshot = svc.store.load_source_snapshot()

    should_ingest = args.force
    reason = "force"
    if not should_ingest:
        if not _index_artifacts_exist(cfg):
            should_ingest = True
            reason = "missing_index_artifacts"
        elif (
            previous_snapshot.get("fingerprint") != current_snapshot["fingerprint"]
            or previous_snapshot.get("source_dir") != current_snapshot["source_dir"]
            or previous_snapshot.get("recursive") != current_snapshot["recursive"]
        ):
            should_ingest = True
            reason = "source_changed"
        else:
            reason = "unchanged_source"

    if should_ingest:
        summary = svc.ingest(source_dir=str(source_dir), recursive=recursive)
        svc.store.save_source_snapshot(current_snapshot)
        print(
            json.dumps(
                {
                    "action": "ingested",
                    "reason": reason,
                    "source_snapshot": {
                        "file_count": current_snapshot["file_count"],
                        "fingerprint": current_snapshot["fingerprint"],
                    },
                    "summary": summary,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    health = svc.health()
    print(
        json.dumps(
            {
                "action": "skipped_ingest",
                "reason": reason,
                "source_snapshot": {
                    "file_count": current_snapshot["file_count"],
                    "fingerprint": current_snapshot["fingerprint"],
                },
                "index": health.get("index", {}),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
