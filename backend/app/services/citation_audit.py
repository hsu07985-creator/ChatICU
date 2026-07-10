"""Post-stream audit of citations the LLM emits in its reply.

Step 4 of the AI-chat sycophancy mitigation plan adds a rule to the
system prompt telling the LLM to cite the snapshot section whenever it
makes a claim about this patient's specific data (e.g.
"（依【用藥】Meropenem 2.0 瓶 q12h IV）"). This module is the
**verification** counterpart: after the reply finishes streaming, we
scan it for citations and check whether they actually match the
patient's snapshot.

Scope notes (deliberately narrow for MVP):
- Only the [用藥] section is validated strictly. The first identifier
  token of the citation content must appear in the supplied
  ``drug_aliases`` (active-medication name list, including both brand
  and generic forms). This catches the most dangerous failure mode —
  the LLM inventing a drug regimen that doesn't exist on the patient.
- 關鍵檢驗 / 生命徵象 citations get a shape check only (llm-2): they
  must contain a number, since the prompt's citation format always
  carries the value. Identifier/value-vs-snapshot validation is still
  deferred, because lab-name aliasing (e.g. snapshot uses ``Cr``, the
  step-1 prompt asks the LLM to write ``肌酸酐``) would produce noisy
  false positives without a proper glossary. Once we have a week of
  production audit logs we can decide whether to add that glossary.
- 影像/報告 and the remaining snapshot sections are free text —
  counted, never value-checked.
- The check is read-only — it never modifies the LLM reply or blocks
  streaming. Output is intended for the audit log so we can measure
  how often the LLM fabricates citations before deciding on remediation.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

from app.services.patient_context_builder.formatters import (
    SNAPSHOT_SECTION_TITLES,
)


# Citation form set by step-1/step-4 system-prompt examples:
#   （依【用藥】Meropenem 2.0 瓶 q12h IV）
#   （依【關鍵檢驗】eGFR 7.97，2026-04-26 22:30）
# Both Chinese full-width parens （） and ASCII () are tolerated so we
# don't miss citations when the LLM mixes punctuation.
_CITATION_RE = re.compile(
    r"[（(]\s*依\s*【\s*([^】]+?)\s*】\s*([^）)]+?)\s*[）)]"
)

# Every section title the context builders put in front of the LLM
# (T2 2026-07-10: the old hand-kept 4-entry list flagged real snapshot
# sections like 【患者基本】 as fabrication). Single source of truth lives
# in patient_context_builder/formatters.py.
_KNOWN_SECTIONS = SNAPSHOT_SECTION_TITLES

# Prefetch blocks render with a trailing qualifier (【微生物培養 最近14天】,
# 【影像/報告 最近3筆】) or a leading one (【最近72小時用藥變更】).
_MED_CHANGE_TITLE_RE = re.compile(r"^最近\d+小時用藥變更$")

# Sections we strictly validate today. Expand later when we add a lab
# alias glossary.
_STRICT_SECTIONS = frozenset({"用藥"})

# llm-2 (safe subset): lab/vital citations must carry a number — the
# prompt's citation format always includes the value, so a digit-less
# citation is the LLM sounding grounded without saying anything
# checkable. Identifier/value-vs-snapshot validation stays deferred
# until we have a lab-alias glossary (see module docstring).
_VALUE_REQUIRED_SECTIONS = frozenset({"關鍵檢驗", "生命徵象"})
_HAS_DIGIT_RE = re.compile(r"\d")


def _section_is_known(section: str) -> bool:
    """True when `section` matches a context-block title, with or without
    its 最近N天/筆 qualifier."""
    if section in _KNOWN_SECTIONS:
        return True
    if _MED_CHANGE_TITLE_RE.match(section):
        return True
    return any(section.startswith(base + " ") for base in _KNOWN_SECTIONS)


def extract_citations(reply: str) -> List[Dict[str, str]]:
    """Pull every citation out of `reply` in source order.

    Each entry has: ``section`` (text inside 【】), ``content`` (text
    between 】 and the closing paren), and ``raw`` (the original match
    including parens). Returns an empty list if the reply has none.
    """
    out: List[Dict[str, str]] = []
    for m in _CITATION_RE.finditer(reply or ""):
        out.append({
            "section": m.group(1).strip(),
            "content": m.group(2).strip(),
            "raw": m.group(0),
        })
    return out


def _first_id_token(content: str) -> str:
    """Take the first identifier-like token from citation content.

    Splits on whitespace, ASCII comma / Chinese comma / Chinese 、 so
    citations like ``Meropenem 2.0 瓶`` → ``Meropenem`` and
    ``eGFR 7.97，2026-04-26`` → ``eGFR``.
    """
    parts = re.split(r"[\s,，、]+", (content or "").strip(), maxsplit=1)
    return parts[0] if parts and parts[0] else ""


def audit_citations(
    reply: str,
    drug_aliases: Iterable[str],
) -> Dict[str, Any]:
    """Audit every citation in `reply`.

    Returns a metadata dict the router can fold into an audit log:

        {
          "total": int,                        # citations found
          "by_section": {"用藥": 2, ...},      # counts grouped by section
          "suspects": [                        # likely fabrications
            {
              "section": str,
              "content": str,
              "token": str,                    # the identifier we checked
              "reason": str,                   # human-readable rationale
              "raw": str,                      # original citation incl. parens
            },
            ...
          ],
        }

    ``drug_aliases`` should be a flat iterable of every acceptable name
    form for the patient's active medications — both ``med.name`` and
    ``med.generic_name`` — so the LLM is free to cite either the brand
    or the generic.
    """
    citations = extract_citations(reply)
    by_section: Dict[str, int] = {}
    suspects: List[Dict[str, str]] = []

    if not citations:
        return {"total": 0, "by_section": {}, "suspects": []}

    alias_set = {
        a.strip().lower()
        for a in drug_aliases
        if isinstance(a, str) and a.strip()
    }

    for cit in citations:
        section = cit["section"]
        content = cit["content"]
        token = _first_id_token(content)
        by_section[section] = by_section.get(section, 0) + 1

        if not _section_is_known(section):
            suspects.append({
                **cit,
                "token": token,
                "reason": f"unknown_section:{section}",
            })
            continue

        if section in _VALUE_REQUIRED_SECTIONS:
            if not _HAS_DIGIT_RE.search(content):
                suspects.append({
                    **cit,
                    "token": token,
                    "reason": "no_value_in_citation",
                })
            continue

        if section not in _STRICT_SECTIONS:
            # Counted but not strictly validated today (see module docstring).
            continue

        if not token:
            suspects.append({
                **cit,
                "token": token,
                "reason": "empty_token",
            })
            continue

        if token.lower() not in alias_set:
            suspects.append({
                **cit,
                "token": token,
                "reason": "drug_not_in_active_meds",
            })

    return {
        "total": len(citations),
        "by_section": by_section,
        "suspects": suspects,
    }


def summarize_suspects(suspects: List[Dict[str, str]]) -> Optional[str]:
    """Render a one-line summary suitable for log messages. None if empty."""
    if not suspects:
        return None
    pieces = [
        f"{s['section']}={s['token']}({s['reason']})"
        for s in suspects
    ]
    return "; ".join(pieces)
