"""Runner helpers for the pharmacist_polish eval suite.

Split out from test_pharmacist_polish.py so the scoring logic stays unit-
testable without requiring an LLM.

Three rubric layers:
  1. Sentence-count preservation (tolerance = 1 per section).
  2. Entity recall (drugs, doses, lab_values, monitors, abbreviations_resolved)
     with a small synonym table ("RR" ↔ "respiratory rate", etc.).
  3. LLM-as-judge (4 Yes/No questions; any Yes → fail). Lives in the test
     module because it needs an LLM client — this file stays hermetic.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml


CASES_PATH = Path(__file__).resolve().parent / "pharmacist_polish_cases.yaml"
REAL_SAMPLES_PATH = Path(__file__).resolve().parent / "pharmacist_real_samples.yaml"
JUDGE_PATH = Path(__file__).resolve().parent / "pharmacist_polish_judge.md"
REPORTS_DIR = Path(__file__).resolve().parent / "reports"

# ── Synonym table (matches comment in cases.yaml) ──────────────────────────
SYNONYMS: Dict[str, List[str]] = {
    "RR": ["respiratory rate"],
    "H&H": ["hemoglobin and hematocrit", "Hb & Hct", "Hb and Hct"],
    "OB": ["occult blood", "stool occult blood"],
    "NKDA": ["no known drug allergies"],
    "CrCl": ["creatinine clearance"],
    "Hb": ["hemoglobin"],
    "Hct": ["hematocrit"],
}

ABBREV_CANON: Dict[str, List[str]] = {
    "discontinue": ["discontinue", "discontinuing", "d/c", "D/C"],
    "because": ["because", "due to", "bcz"],
    "due_to": ["due to", "d/t", "because of"],
    "due_to_or_similar": ["due to", "because", "owing to", "secondary to"],
    "follow up": ["follow up", "monitor", "f/u"],
    "gastrointestinal bleeding": ["gastrointestinal bleeding", "GI bleeding", "GIB"],
    "status post": ["status post", "s/p"],
}


def load_cases() -> List[Dict[str, Any]]:
    with CASES_PATH.open("r", encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    return doc.get("cases", [])


def load_real_samples() -> List[Dict[str, Any]]:
    """Load P0.4 pharmacist production ground-truth samples."""
    if not REAL_SAMPLES_PATH.exists():
        return []
    with REAL_SAMPLES_PATH.open("r", encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    return doc.get("cases", [])


def load_rubric() -> Dict[str, Any]:
    with CASES_PATH.open("r", encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    return doc.get("rubric", {})


def load_judge_prompt() -> str:
    with JUDGE_PATH.open("r", encoding="utf-8") as fh:
        return fh.read()


# ── Layer 1: sentence count preservation ───────────────────────────────────

# Split on:
#   - Chinese/Japanese full stop 。．, ASCII ! ?
#   - ASCII period FOLLOWED by whitespace, but NOT preceded by a digit
#     (so "0.25" / "1." bullet marker / "2." don't split)
#   - newline + bullet marker (dash or "N.")
_SENT_SPLIT = re.compile(
    r"(?:[。．!?]\s*|(?<!\d)[.]\s+|\n\s*(?:-|\d+[.)])\s*)"
)
# Leading bullet marker at start of the text (no preceding newline).
_LEADING_BULLET_RE = re.compile(r"^\s*(?:-|\d+[.)])\s+")


_BULLET_LINE_RE = re.compile(r"(?m)^\s*(?:-|\d+[.)])\s+\S")


def count_sentences(text: str) -> int:
    if not text or not text.strip():
        return 0
    # If the text is bulleted, count bullet lines — one recommendation per
    # bullet regardless of how many inline sub-sentences it contains. This
    # matches how pharmacists structure P sections.
    bullets = _BULLET_LINE_RE.findall(text)
    if len(bullets) >= 2:
        return len(bullets)
    cleaned = _LEADING_BULLET_RE.sub("", text, count=1)
    pieces = [p.strip() for p in _SENT_SPLIT.split(cleaned) if p and p.strip()]
    return len(pieces)


def sentence_count_preserved(
    input_sections: Dict[str, str],
    output_sections: Dict[str, str],
    *,
    tolerance: int = 1,
    refinement_baseline: Optional[Dict[str, str]] = None,
) -> Tuple[bool, Dict[str, Tuple[int, int]]]:
    """Return (passes, {section: (input_count, output_count)}).

    For refinement mode the input's P section is typically empty (the actual
    baseline is `previous_polished`). Pass `refinement_baseline` (with 's',
    'o', 'a', 'p' keys) and it will be used when the input section is empty.
    """
    per_section: Dict[str, Tuple[int, int]] = {}
    passes = True
    for key in ("s", "o", "a", "p"):
        raw_in = input_sections.get(key, "") or ""
        if not raw_in.strip() and refinement_baseline is not None:
            raw_in = refinement_baseline.get(key, "") or ""
        ic = count_sentences(raw_in)
        oc = count_sentences(output_sections.get(key, ""))
        per_section[key] = (ic, oc)
        if ic == 0 and oc == 0:
            continue
        if abs(oc - ic) > tolerance:
            passes = False
    return passes, per_section


# ── Layer 2: entity recall ─────────────────────────────────────────────────

def _expand_synonyms(term: str) -> List[str]:
    """Return all acceptable surface forms for a term (case-insensitive).

    Also applies synonym substitution on super-strings: if term contains
    a known abbreviation as a whole word, generate variants with each
    expansion (so "stool OB" → "stool occult blood").
    """
    forms = [term]
    if term in SYNONYMS:
        forms.extend(SYNONYMS[term])
    if term in ABBREV_CANON:
        forms.extend(ABBREV_CANON[term])
    # Super-string expansion: substitute any whole-word abbrev inside `term`.
    for abbrev, expansions in SYNONYMS.items():
        pattern = rf"\b{re.escape(abbrev)}\b"
        if re.search(pattern, term):
            for exp in expansions:
                forms.append(re.sub(pattern, exp, term))
    return [f.lower() for f in forms]


# Normalize whitespace & punctuation variants so "40mg" ≈ "40 mg" and
# "(hydrocortisone, 100 mg)" ≈ "(hydrocortisone 100 mg)" and lab flags/units
# between value and reference range don't break substring matching.
_WS_NORM_RE = re.compile(r"\s+")
_NUM_UNIT_GAP_RE = re.compile(r"(\d)\s*([a-zA-Z])")
_PUNCT_NORM_RE = re.compile(r"[,()=%]+")
_LAB_FLAGS_RE = re.compile(r"\b(?:HH|LL|H|L)\b", re.IGNORECASE)
_LAB_UNITS_RE = re.compile(
    r"\b(?:mg/dl|mg/l|meq/l|mmol/l|u/l|g/dl|mmhg|ml/min(?:ute)?(?:/1\.73\s*m[²2]?)?|10\^?[36]/ul)\b",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    low = text.lower()
    low = _PUNCT_NORM_RE.sub(" ", low)         # strip commas, parens, =, %
    low = _LAB_UNITS_RE.sub(" ", low)          # drop lab units
    low = _LAB_FLAGS_RE.sub(" ", low)          # drop H/L/HH/LL flags
    low = _NUM_UNIT_GAP_RE.sub(r"\1 \2", low)  # "40mg" → "40 mg"
    low = _WS_NORM_RE.sub(" ", low)            # collapse whitespace
    return low.strip()


_MAX_GAP_TOKENS = 6  # max filler tokens between consecutive expected tokens


def _fuzzy_token_sequence_match(haystack_norm: str, needle_norm: str) -> bool:
    """Return True iff every whitespace-separated token in needle appears in
    haystack in the same relative order, with bounded gaps between tokens.

    Tolerates inserted words such as "diluted" in
    "2 vials [diluted] in 100 mL of 5% dextrose".
    """
    tokens = [re.escape(t) for t in needle_norm.split() if t]
    if not tokens:
        return False
    pattern = r"\b" + tokens[0] + r"\b"
    gap = rf"(?:\s+\S+){{0,{_MAX_GAP_TOKENS}}}\s+"
    for t in tokens[1:]:
        pattern += gap + r"\b" + t + r"\b"
    return bool(re.search(pattern, haystack_norm))


def _hit(haystack: str, needle: str) -> bool:
    haystack_norm = _normalize(haystack)
    for form in _expand_synonyms(needle):
        form_norm = _normalize(form)
        if form_norm and form_norm in haystack_norm:
            return True
        if form_norm and _fuzzy_token_sequence_match(haystack_norm, form_norm):
            return True
    return False


def entity_recall(
    expected: Dict[str, Any],
    output_sections: Dict[str, str],
) -> Tuple[float, List[str]]:
    """Recall = hits / total. Returns (score, list_of_missing_terms).

    Recognised expected-entity buckets: drugs, doses, lab_values, monitors,
    abbreviations_resolved, concepts, values, abbreviations_correctly_resolved.
    """
    full_output = " \n".join(output_sections.get(k, "") or "" for k in ("s", "o", "a", "p"))
    missing: List[str] = []
    total = 0
    hits = 0
    for bucket, items in (expected or {}).items():
        if bucket == "abbreviations_correctly_resolved" and isinstance(items, dict):
            for abbrev, expansion in items.items():
                total += 1
                if _hit(full_output, expansion):
                    hits += 1
                else:
                    missing.append(f"{bucket}:{abbrev}→{expansion}")
            continue
        if isinstance(items, list):
            for term in items:
                if not isinstance(term, str):
                    continue
                total += 1
                if _hit(full_output, term):
                    hits += 1
                else:
                    missing.append(f"{bucket}:{term}")
    score = (hits / total) if total else 1.0
    return score, missing


# ── Layer 2b: format flag heuristics (for real-samples idempotency) ────────

_NUMBERED_BULLET_RE = re.compile(r"(?m)^\s*\d+\s*[.)]\s+\S")
_DASH_BULLET_RE = re.compile(r"(?m)^\s*-\s+\S")
_POLITE_RE = re.compile(r"\bplease\s+consider\b", re.IGNORECASE)
_MONITOR_RE = re.compile(
    r"\b(?:monitor|continue to monitor|follow\s*up)\b", re.IGNORECASE
)
_REASON_FIRST_RE = re.compile(
    r"(?m)^\s*(?:-\s+|\d+\s*[.)]\s+)?(?:in view of|due to|given|to optimi[sz]e|if\b)",
    re.IGNORECASE,
)
# e.g. "Tazocin inj (piperacillin 2 g)" or "Actosmet (pioglitazone 15 mg)"
_BRAND_WITH_GENERIC_RE = re.compile(
    r"[A-Z][A-Za-z][A-Za-z0-9\-]*(?:\s+inj)?\s*\(\s*[a-z][a-z\-]+\b",
)
_GUIDELINE_RE = re.compile(
    r"(?:according to|guideline|campaign|IDSA|surviving sepsis)",
    re.IGNORECASE,
)
_NUMERIC_THRESHOLD_RE = re.compile(r"[<>]\s*\d")


def check_format_flags(
    output_sections: Dict[str, str],
    flags: Dict[str, bool],
    *,
    input_sections: Optional[Dict[str, str]] = None,
) -> Tuple[bool, List[str]]:
    """Check which declared format_flags hold on the polished output.

    Returns (all_pass, list_of_failed_flags). Only flags set to True are
    checked; False flags are ignored (they document properties that should
    *not* be required, not negative assertions).
    """
    p = output_sections.get("p", "") or ""
    a = output_sections.get("a", "") or ""
    full = "\n".join(v or "" for v in output_sections.values())
    failed: List[str] = []

    def _ok(flag: str, cond: bool) -> None:
        if not cond:
            failed.append(flag)

    for flag, required in (flags or {}).items():
        if not required:
            continue
        if flag == "p_uses_numbered_bullets":
            _ok(flag, bool(_NUMBERED_BULLET_RE.search(p)))
        elif flag == "p_uses_bullets":
            _ok(flag, bool(_NUMBERED_BULLET_RE.search(p) or _DASH_BULLET_RE.search(p)))
        elif flag == "p_has_polite_phrase":
            _ok(flag, bool(_POLITE_RE.search(p)))
        elif flag == "p_has_monitor_line":
            _ok(flag, bool(_MONITOR_RE.search(p)))
        elif flag == "p_has_reason_then_request_order":
            _ok(flag, bool(_REASON_FIRST_RE.search(p)))
        elif flag == "drug_brand_with_generic_in_parens":
            _ok(flag, bool(_BRAND_WITH_GENERIC_RE.search(full)))
        elif flag == "a_cites_guideline":
            _ok(flag, bool(_GUIDELINE_RE.search(a)))
        elif flag == "a_states_specific_threshold":
            _ok(flag, bool(_NUMERIC_THRESHOLD_RE.search(a)))
        elif flag in ("s_o_verbatim", "o_verbatim", "s_verbatim"):
            if input_sections is None:
                failed.append(f"{flag}:no_input_ref")
                continue
            for key in ("s", "o") if flag == "s_o_verbatim" else (flag[0],):
                if (input_sections.get(key) or "").strip() != (
                    output_sections.get(key) or ""
                ).strip():
                    failed.append(f"{flag}:{key}_differs")
        elif flag in (
            "zero_content_addition",
            "zero_content_removal",
            "only_grammar_translation",
            "no_rationale_added",
            "no_please_consider_added",
            "no_soap_framework_added",
            "does_not_invent_s_o_a",
            "parentheses_preserved",
            "no_discharge_mistranslation",
            "format_rules_preserved_after_refinement",
        ):
            # Handled by existing layers 1/2 or judge — don't double-check.
            continue
        # Unknown flag → ignore silently so new flags don't break old runs.
    return (not failed), failed


# ── Reporting ──────────────────────────────────────────────────────────────

def render_report(
    *,
    run_id: str,
    rubric: Dict[str, Any],
    results: List[Dict[str, Any]],
) -> str:
    lines: List[str] = [
        f"# Pharmacist Polish Eval — {run_id}",
        "",
        f"- Cases: {len(results)}",
        f"- Tolerance (sentence): {rubric.get('sentence_count_tolerance', 1)}",
        f"- Entity recall threshold: {rubric.get('entity_recall_threshold', 1.0)}",
        "",
        "| Case | Mode | Sentence | Recall | Judge | Overall |",
        "|------|------|----------|--------|-------|---------|",
    ]
    for r in results:
        lines.append(
            f"| `{r['id']}` | {r.get('polish_mode', '-')} | "
            f"{'PASS' if r['sentence_pass'] else 'FAIL'} | "
            f"{r['recall']:.2f} {'✅' if r['recall_pass'] else '❌'} | "
            f"{r.get('judge_pass_str', 'n/a')} | "
            f"**{'PASS' if r['overall_pass'] else 'FAIL'}** |"
        )
    lines.append("")
    for r in results:
        if r["overall_pass"]:
            continue
        lines.extend([
            f"## FAIL: {r['id']} — {r.get('name', '')}",
            "",
            f"- polish_mode: `{r.get('polish_mode', '-')}`",
            f"- sentence_pass: {r['sentence_pass']}  (per section: {r['sentence_per_section']})",
            f"- recall: {r['recall']:.2%} (missing: {', '.join(r['missing_entities']) or '-'})",
            f"- judge: {r.get('judge_json', 'n/a')}",
            "",
            "### Input A",
            "```",
            (r.get("input_sections") or {}).get("a", "") or "",
            "```",
            "",
            "### Output A",
            "```",
            (r.get("output_sections") or {}).get("a", "") or "",
            "```",
            "",
            "### Input P",
            "```",
            (r.get("input_sections") or {}).get("p", "") or "",
            "```",
            "",
            "### Output P",
            "```",
            (r.get("output_sections") or {}).get("p", "") or "",
            "```",
            "",
        ])
    return "\n".join(lines)


def write_report(report: str, *, run_id: str) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    target = REPORTS_DIR / f"{run_id}.md"
    target.write_text(report, encoding="utf-8")
    return target


__all__ = [
    "CASES_PATH",
    "REAL_SAMPLES_PATH",
    "JUDGE_PATH",
    "REPORTS_DIR",
    "load_cases",
    "load_real_samples",
    "load_rubric",
    "load_judge_prompt",
    "count_sentences",
    "sentence_count_preserved",
    "entity_recall",
    "check_format_flags",
    "render_report",
    "write_report",
]
