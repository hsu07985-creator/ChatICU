"""Citation and grounding validation."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Citation
from .utils import split_sentences


CIT_RE = re.compile(r"\[(C[0-9]+)\]")


@dataclass
class ValidationResult:
    ok: bool
    unsupported_sentences: int
    missing_citations: int
    unknown_citation_refs: int
    issues: list[str]


def validate_answer_with_citations(answer: str, citations: list[Citation]) -> ValidationResult:
    citation_ids = {c.citation_id for c in citations}
    issues: list[str] = []
    missing = 0
    unknown = 0

    lines = [ln.strip() for ln in answer.splitlines() if ln.strip()]

    # Bullet mode: each bullet line must include a known citation.
    bullet_lines = [ln for ln in lines if ln.startswith("-")]
    if bullet_lines:
        for line in bullet_lines:
            refs = CIT_RE.findall(line)
            if not refs:
                missing += 1
                issues.append(f"Missing citation in bullet line: {line[:120]}")
                continue
            for ref in refs:
                if ref not in citation_ids:
                    unknown += 1
                    issues.append(f"Unknown citation [{ref}] in bullet line: {line[:120]}")
    else:
        # Narrative mode: enforce sentence-level citation.
        sentences = split_sentences(answer)
        for sent in sentences:
            refs = CIT_RE.findall(sent)
            if not refs:
                missing += 1
                issues.append(f"Missing citation in sentence: {sent[:120]}")
                continue
            for ref in refs:
                if ref not in citation_ids:
                    unknown += 1
                    issues.append(f"Unknown citation [{ref}] in sentence: {sent[:120]}")

    unsupported = missing + unknown
    return ValidationResult(
        ok=unsupported == 0,
        unsupported_sentences=unsupported,
        missing_citations=missing,
        unknown_citation_refs=unknown,
        issues=issues[:10],
    )
