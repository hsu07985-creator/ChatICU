"""Document extraction utilities."""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from pypdf import PdfReader

from raganything.parser import MineruParser


@dataclass
class ExtractionOutput:
    file_path: str
    page_text: dict[int, str]
    parser: str
    raw_blocks: list[dict[str, Any]]


def _safe_join_text(parts: list[str]) -> str:
    return "\n".join([p for p in parts if p.strip()])


def _clean_pdf_text(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    cleaned: list[str] = []
    drop_patterns = [
        "Official reprint from UpToDate",
        "Use of UpToDate is subject to the Terms of Use",
        "All Rights Reserved.",
        "Topic ",
        "Version ",
        "www.uptodate.com",
    ]
    for line in lines:
        if any(pat in line for pat in drop_patterns):
            continue
        # Drop near-empty page noise like "Page 1 of 3" and isolated page numbers.
        if re.fullmatch(r"(page\s*)?\d+(\s*of\s*\d+)?", line.lower()):
            continue
        cleaned.append(line)
    merged = " ".join(cleaned)
    merged = re.sub(r"\s+", " ", merged).strip()
    return merged


def extract_pdf_with_mineru(file_path: Path, output_dir: Path) -> ExtractionOutput:
    parser = MineruParser()
    content_list = parser.parse_document(
        file_path=str(file_path),
        output_dir=str(output_dir / file_path.stem),
        method="auto",
    )

    page_map: dict[int, list[str]] = {}
    for item in content_list:
        if not isinstance(item, dict):
            continue
        page = int(item.get("page_idx", 0))
        page_map.setdefault(page, [])
        ctype = str(item.get("type", "text"))

        if ctype == "text":
            txt = str(item.get("text", "")).strip()
            if txt:
                page_map[page].append(txt)
            continue

        if ctype == "equation":
            txt = str(item.get("text", "") or item.get("latex", "")).strip()
            if txt:
                page_map[page].append(f"[EQUATION] {txt}")
            continue

        if ctype == "table":
            body = str(item.get("table_body", "")).strip()
            caption = str(item.get("table_caption", "")).strip()
            merged = f"[TABLE] {caption}\n{body}".strip()
            if merged:
                page_map[page].append(merged)
            continue

        if ctype == "image":
            caption = str(item.get("image_caption", "") or item.get("img_caption", "")).strip()
            if caption:
                page_map[page].append(f"[IMAGE_CAPTION] {caption}")

    page_text = {k: _safe_join_text(v) for k, v in page_map.items()}
    return ExtractionOutput(
        file_path=str(file_path),
        page_text=page_text,
        parser="mineru",
        raw_blocks=[x for x in content_list if isinstance(x, dict)],
    )


def extract_pdf_with_pypdf(file_path: Path) -> ExtractionOutput:
    reader = PdfReader(str(file_path))
    page_text: dict[int, str] = {}
    raw_blocks: list[dict[str, Any]] = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        cleaned = _clean_pdf_text(text)
        page_text[i] = cleaned
        raw_blocks.append(
            {
                "type": "text",
                "text": cleaned,
                "page_idx": i,
            }
        )
    return ExtractionOutput(
        file_path=str(file_path),
        page_text=page_text,
        parser="pypdf",
        raw_blocks=raw_blocks,
    )


def extract_docx_text(file_path: Path) -> ExtractionOutput:
    with zipfile.ZipFile(file_path, "r") as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    texts = [node.text for node in root.findall(".//w:t", ns) if node.text]
    content = " ".join(texts)
    content = re.sub(r"\s+", " ", content).strip()
    return ExtractionOutput(
        file_path=str(file_path),
        page_text={0: content},
        parser="docx_zip",
        raw_blocks=[{"type": "text", "text": content, "page_idx": 0}],
    )


def _parse_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        data = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(data)
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    out: list[str] = []
    for si in root.findall(".//x:si", ns):
        texts = [t.text or "" for t in si.findall(".//x:t", ns)]
        out.append("".join(texts))
    return out


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    t = cell.attrib.get("t", "")
    v = cell.findtext("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
    if v is None:
        return ""
    if t == "s":
        try:
            return shared_strings[int(v)]
        except Exception:
            return v
    return v


def extract_xlsx_text(file_path: Path) -> ExtractionOutput:
    lines: list[str] = []
    with zipfile.ZipFile(file_path, "r") as zf:
        shared = _parse_shared_strings(zf)
        for name in sorted(zf.namelist()):
            if not name.startswith("xl/worksheets/sheet") or not name.endswith(".xml"):
                continue
            data = zf.read(name)
            root = ET.parse(io.BytesIO(data)).getroot()
            ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for row in root.findall(".//x:row", ns):
                vals: list[str] = []
                for cell in row.findall("x:c", ns):
                    vals.append(_cell_value(cell, shared))
                row_text = "\t".join([v for v in vals if v != ""])
                if row_text:
                    lines.append(row_text)
    content = "\n".join(lines).strip()
    return ExtractionOutput(
        file_path=str(file_path),
        page_text={0: content},
        parser="xlsx_zip",
        raw_blocks=[{"type": "table", "table_body": content, "page_idx": 0}],
    )
