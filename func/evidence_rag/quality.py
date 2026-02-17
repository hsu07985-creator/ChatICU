"""Quality gate for OCR/text extraction."""

from __future__ import annotations

from dataclasses import dataclass

from .config import EvidenceRAGConfig
from .utils import noise_ratio


@dataclass
class PageQuality:
    page: int
    text_chars: int
    noise: float
    score: float
    needs_fallback: bool
    reason: str


def score_page_quality(text: str, page: int, cfg: EvidenceRAGConfig) -> PageQuality:
    chars = len(text.strip())
    noise = noise_ratio(text)

    length_score = min(1.0, chars / max(cfg.min_text_chars_per_page, 1))
    noise_score = max(0.0, 1.0 - noise)
    score = 0.7 * length_score + 0.3 * noise_score

    needs_fallback = False
    reason = "ok"
    if chars < cfg.min_text_chars_per_page:
        needs_fallback = True
        reason = "too_short"
    if noise > cfg.max_noise_ratio:
        needs_fallback = True
        reason = "too_noisy"

    return PageQuality(
        page=page,
        text_chars=chars,
        noise=noise,
        score=round(score, 4),
        needs_fallback=needs_fallback,
        reason=reason,
    )

