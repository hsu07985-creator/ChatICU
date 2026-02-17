"""OpenAI vision fallback for low-quality PDF pages."""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from pathlib import Path

try:
    import pypdfium2 as pdfium
except Exception:  # pragma: no cover
    pdfium = None

from openai import OpenAI

from .config import EvidenceRAGConfig


@dataclass
class FallbackResult:
    text: str
    used: bool
    error: str = ""


class VisionFallbackExtractor:
    """Extract text from a PDF page image using OpenAI vision."""

    def __init__(self, cfg: EvidenceRAGConfig):
        self.cfg = cfg
        self.client = OpenAI(api_key=cfg.openai_api_key) if cfg.openai_api_key else None

    def available(self) -> bool:
        return (
            self.cfg.enable_vision_fallback
            and self.client is not None
            and pdfium is not None
        )

    def _render_page_image_base64(self, pdf_path: Path, page_idx: int) -> str:
        if pdfium is None:
            raise RuntimeError("pypdfium2 is not available for page rendering")

        doc = pdfium.PdfDocument(str(pdf_path))
        if page_idx < 0 or page_idx >= len(doc):
            raise IndexError(f"Invalid page index {page_idx} for {pdf_path}")

        page = doc[page_idx]
        bitmap = page.render(scale=2.0)
        pil = bitmap.to_pil()
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    def extract_page_text(self, pdf_path: str, page_idx: int) -> FallbackResult:
        if not self.available():
            return FallbackResult(text="", used=False, error="vision_fallback_unavailable")

        try:
            b64 = self._render_page_image_base64(Path(pdf_path), page_idx)
            prompt = (
                "Extract all readable text from this medical document page. "
                "Keep original terms, units, dosage, and section meaning. "
                "Output plain text only."
            )

            resp = self.client.responses.create(
                model=self.cfg.vision_model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {
                                "type": "input_image",
                                "image_url": f"data:image/png;base64,{b64}",
                            },
                        ],
                    }
                ],
            )
            text = (getattr(resp, "output_text", "") or "").strip()
            if not text:
                return FallbackResult(text="", used=True, error="empty_fallback_output")
            return FallbackResult(text=text, used=True)

        except Exception as e:  # pragma: no cover - network/model dependent
            return FallbackResult(text="", used=False, error=str(e))

