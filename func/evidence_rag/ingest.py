"""Ingestion pipeline for evidence-first RAG."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .chunking import build_chunks_for_pages
from .config import EvidenceRAGConfig
from .extractors import (
    ExtractionOutput,
    extract_docx_text,
    extract_pdf_with_mineru,
    extract_pdf_with_pypdf,
    extract_xlsx_text,
)
from .fallback import VisionFallbackExtractor
from .models import ChunkRecord
from .quality import score_page_quality
from .storage import ArtifactStore
from .utils import detect_language, infer_topic, make_chunk_id, make_doc_id


SUPPORTED_EXT = {".pdf", ".docx", ".xlsx"}


@dataclass
class IngestionSummary:
    files_total: int
    files_success: int
    files_failed: int
    chunks_total: int
    report_path: str
    details: list[dict[str, Any]]


def detect_source_type(file_name: str) -> str:
    name = file_name.lower()
    if "uptodate" in name:
        return "uptodate"
    if "仿單" in file_name or "drug information" in name:
        return "drug_label"
    if "guideline" in name or "pad" in name:
        return "guideline"
    return "other"


class IngestionPipeline:
    """Parse and normalize corpus into canonical chunk records."""

    def __init__(self, cfg: EvidenceRAGConfig, store: ArtifactStore):
        self.cfg = cfg
        self.store = store
        self.fallback = VisionFallbackExtractor(cfg)

    def collect_files(self, source_dir: Path, recursive: bool = True) -> list[Path]:
        globber = source_dir.rglob if recursive else source_dir.glob
        files = [p for p in globber("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXT]
        return sorted(files)

    def _extract_file(self, file_path: Path) -> ExtractionOutput:
        ext = file_path.suffix.lower()
        if ext == ".pdf":
            backend = self.cfg.pdf_backend.lower().strip()
            if backend == "mineru":
                return extract_pdf_with_mineru(
                    file_path=file_path, output_dir=self.cfg.parser_output_dir
                )
            if backend == "pypdf":
                return extract_pdf_with_pypdf(file_path=file_path)
            # auto: try mineru first, fallback to pypdf
            try:
                return extract_pdf_with_mineru(
                    file_path=file_path, output_dir=self.cfg.parser_output_dir
                )
            except Exception:
                return extract_pdf_with_pypdf(file_path=file_path)
        if ext == ".docx":
            return extract_docx_text(file_path=file_path)
        if ext == ".xlsx":
            return extract_xlsx_text(file_path=file_path)
        raise ValueError(f"Unsupported extension: {ext}")

    def _apply_quality_gate_and_fallback(
        self,
        file_path: Path,
        page_text: dict[int, str],
    ) -> tuple[dict[int, str], list[dict[str, Any]]]:
        quality_logs: list[dict[str, Any]] = []
        replaced = dict(page_text)
        fallback_count = 0

        for page, text in sorted(page_text.items()):
            q = score_page_quality(text=text, page=page, cfg=self.cfg)
            row = {
                "page": page,
                "text_chars": q.text_chars,
                "noise": q.noise,
                "score": q.score,
                "needs_fallback": q.needs_fallback,
                "fallback_used": False,
                "fallback_error": "",
            }
            if (
                file_path.suffix.lower() == ".pdf"
                and q.needs_fallback
                and fallback_count < self.cfg.fallback_page_limit
            ):
                fb = self.fallback.extract_page_text(str(file_path), page)
                row["fallback_used"] = fb.used
                row["fallback_error"] = fb.error
                if fb.used and fb.text.strip():
                    replaced[page] = fb.text
                    fallback_count += 1

            quality_logs.append(row)
        return replaced, quality_logs

    def run(self, source_dir: Path | None = None, recursive: bool = True) -> IngestionSummary:
        source_dir = source_dir or self.cfg.source_dir
        files = self.collect_files(source_dir=source_dir, recursive=recursive)

        all_chunks: list[ChunkRecord] = []
        details: list[dict[str, Any]] = []
        success = 0
        failed = 0

        for fp in files:
            file_detail: dict[str, Any] = {
                "file": str(fp),
                "status": "ok",
                "error": "",
                "pages": 0,
                "chunks": 0,
                "quality": [],
            }
            try:
                extracted = self._extract_file(fp)
                adjusted_page_text, quality_logs = self._apply_quality_gate_and_fallback(
                    file_path=fp, page_text=extracted.page_text
                )
                file_detail["quality"] = quality_logs
                file_detail["pages"] = len(adjusted_page_text)

                chunk_spans = build_chunks_for_pages(adjusted_page_text, self.cfg)
                doc_id = make_doc_id(str(fp))
                topic = infer_topic(str(fp))
                source_type = detect_source_type(fp.name)
                ordinal = 0

                fallback_pages = {
                    q["page"] for q in quality_logs if q.get("fallback_used")
                }

                for span in chunk_spans:
                    ordinal += 1
                    if not span.text.strip():
                        continue
                    lang = detect_language(span.text)
                    chunk = ChunkRecord(
                        chunk_id=make_chunk_id(str(fp), span.page, ordinal, span.text),
                        doc_id=doc_id,
                        text=span.text,
                        source_file=str(fp),
                        topic=topic,
                        page=span.page + 1,
                        section=span.section,
                        source_type=source_type,
                        language=lang,
                        parser=extracted.parser,
                        quality_score=next(
                            (
                                q["score"]
                                for q in quality_logs
                                if int(q["page"]) == int(span.page)
                            ),
                            1.0,
                        ),
                        fallback_used=span.page in fallback_pages,
                        metadata={
                            "file_name": fp.name,
                            "extension": fp.suffix.lower(),
                            "topic": topic,
                            "source_type": source_type,
                            "parser": extracted.parser,
                            "section": span.section,
                        },
                    )
                    all_chunks.append(chunk)

                file_detail["chunks"] = ordinal
                success += 1

                if self.cfg.store_raw_page_text:
                    raw_file = self.store.raw_dir / f"{doc_id}_pages.json"
                    raw_file.write_text(
                        json.dumps(adjusted_page_text, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )

            except Exception as e:
                file_detail["status"] = "failed"
                file_detail["error"] = str(e)
                failed += 1

            details.append(file_detail)

        self.store.save_chunks(all_chunks)
        report = {
            "files_total": len(files),
            "files_success": success,
            "files_failed": failed,
            "chunks_total": len(all_chunks),
            "details": details,
        }
        self.store.ingest_report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        return IngestionSummary(
            files_total=len(files),
            files_success=success,
            files_failed=failed,
            chunks_total=len(all_chunks),
            report_path=str(self.store.ingest_report_path),
            details=details,
        )
