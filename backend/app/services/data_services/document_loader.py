"""Document loader — extracts text from PDF and DOCX files."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


def extract_text_from_pdf(file_path: str) -> str:
    """Extract all text from a PDF file using PyMuPDF."""
    import fitz  # PyMuPDF

    doc = fitz.open(file_path)
    pages = []
    for page_num, page in enumerate(doc):
        text = page.get_text()
        if text.strip():
            pages.append(f"[Page {page_num + 1}]\n{text}")
    doc.close()
    return "\n\n".join(pages)


def extract_text_from_docx(file_path: str) -> str:
    """Extract all text from a DOCX file."""
    from docx import Document

    doc = Document(file_path)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def load_documents(docs_path: str) -> list[dict]:
    """Load all supported documents from a directory (recursive).

    Returns:
        [{"doc_id": "category/filename.pdf", "text": "...", "category": "...", "file_path": "..."}, ...]
    """
    docs_path = Path(docs_path)
    if not docs_path.exists():
        return []

    documents = []
    supported_ext = {".pdf", ".docx", ".txt"}

    for root, _dirs, files in os.walk(docs_path):
        root_path = Path(root)
        for filename in sorted(files):
            if filename.startswith("."):
                continue

            file_path = root_path / filename
            ext = file_path.suffix.lower()

            if ext not in supported_ext:
                continue

            # Category = first-level subdirectory name
            rel_path = file_path.relative_to(docs_path)
            category = rel_path.parts[0] if len(rel_path.parts) > 1 else "uncategorized"

            try:
                if ext == ".pdf":
                    text = extract_text_from_pdf(str(file_path))
                elif ext == ".docx":
                    text = extract_text_from_docx(str(file_path))
                elif ext == ".txt":
                    text = file_path.read_text(encoding="utf-8")
                else:
                    continue

                if text.strip():
                    documents.append({
                        "doc_id": str(rel_path),
                        "text": text,
                        "category": category,
                        "file_path": str(file_path),
                    })
            except Exception as e:
                # Skip unreadable files but log the error
                print(f"[document_loader] Warning: could not read {file_path}: {e}")

    return documents
