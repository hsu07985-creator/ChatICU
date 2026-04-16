"""Parse allergy information from HIS SOAP notes (getSO SUBJECTIVE text).

Extracts structured allergy data from free-text clinical notes.
Handles both Chinese and English documentation patterns.

Usage:
    from app.fhir.allergy_parser import parse_allergy_text, parse_allergy_texts

    result = parse_allergy_text("Drug allergy(-)")
    # {"status": "nka", "allergies": []}

    result = parse_allergy_text("Drug allergy: Penicillin, Sulfa")
    # {"status": "has_allergies", "allergies": [{"substance": "Penicillin", ...}, ...]}
"""

import re
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

AllergyResult = Dict[str, Any]
# {
#   "status": "nka" | "has_allergies" | "unknown",
#   "allergies": [{"substance": str, "reaction": str|None, "extracted_text": str}]
# }


# ---------------------------------------------------------------------------
# Positive patterns — checked FIRST (order matters)
# ---------------------------------------------------------------------------

# "Drug allergy(+): Penicillin - rash" or "Drug allergy(+):Penicillin"
_RE_POSITIVE_PAREN = re.compile(
    r"(?i)drug\s*allergy\s*\(\+\)\s*[:：]\s*(.+)",
)

# "Drug allergy: Penicillin, Sulfa" — colon followed by substance(s)
# Must NOT match "Drug allergy: nil" / "Drug allergy: none" / "Drug allergy: 無"
_RE_DRUG_ALLERGY_COLON = re.compile(
    r"(?i)drug\s*allergy\s*[:：]\s*(.+)",
)

# "ALLERGIC HX TO MEDICIN(E): Penicillin"
_RE_ALLERGIC_HX = re.compile(
    r"(?i)allergic\s+hx\s+to\s+medicin[e]?\s*[:：]\s*(.+)",
)

# "Allergy: Penicillin" (standalone)
_RE_ALLERGY_COLON = re.compile(
    r"(?i)(?<![a-z])allergy\s*[:：]\s*(.+)",
)

# "過敏: Penicillin" or "藥物過敏: Aspirin"
_RE_CN_ALLERGY_COLON = re.compile(
    r"(?:藥物)?過敏\s*[:：]\s*(.+)",
)

# "對 Vancomycin 過敏" / "對Vancomycin過敏"
_RE_CN_DUI_ALLERGY = re.compile(
    r"對\s*(.+?)\s*過敏",
)

# Collect positive patterns in priority order
_POSITIVE_PATTERNS = [
    _RE_POSITIVE_PAREN,
    _RE_DRUG_ALLERGY_COLON,
    _RE_ALLERGIC_HX,
    _RE_ALLERGY_COLON,
    _RE_CN_ALLERGY_COLON,
    _RE_CN_DUI_ALLERGY,
]

# ---------------------------------------------------------------------------
# Negative patterns — if no positive match, check these
# ---------------------------------------------------------------------------

_NEGATIVE_PATTERNS = [
    re.compile(r"(?i)drug\s*allergy\s*\(-\)"),        # Drug allergy(-)
    re.compile(r"(?i)drug\s*allergy\s*-"),             # Drug allergy - / drug allergy-
    re.compile(r"(?i)\bNKDA\b"),                       # NKDA
    re.compile(r"(?i)\bNKA\b"),                        # NKA
    re.compile(r"(?i)no\s+(?:known\s+)?(?:drug\s+)?allerg"), # No known (drug) allergy
    re.compile(r"(?i)ADR\s+to\s+.+\(-\)"),             # ADR to ... (-)
    re.compile(r"(?i)藥物過敏\s*\(-\)"),                # 藥物過敏(-)
    re.compile(r"(?i)藥物過敏\s*[:：]\s*(?:無|否認|nil|none)", re.IGNORECASE),
    re.compile(r"(?i)過敏\s*[:：]\s*(?:無|否認|nil|none)", re.IGNORECASE),
    re.compile(r"(?i)(?:無已知過敏|無藥物過敏|無過敏)"),  # 無已知過敏 / 無藥物過敏
]

# Words indicating "no allergy" when found as the substance in a positive pattern
_NEGATIVE_SUBSTANCE_WORDS = {
    "nil", "none", "no", "(-)", "-", "negative",
    "無", "否認", "否", "nka", "nkda", "nkfa",
    "not known", "not applicable", "n/a",
}


# ---------------------------------------------------------------------------
# Substance parsing helpers
# ---------------------------------------------------------------------------

def _split_substances(raw: str) -> List[Dict[str, Optional[str]]]:
    """Split comma-separated substances, optionally with reactions in parens.

    Examples:
        "Penicillin, Sulfa" → [{"substance": "Penicillin"}, {"substance": "Sulfa"}]
        "Penicillin (rash), Sulfa (GI upset)" → [{substance, reaction}, ...]
        "Penicillin - rash" → [{"substance": "Penicillin", "reaction": "rash"}]
    """
    results = []
    # Split on comma, semicolon, or 、
    parts = re.split(r"[,;、]\s*", raw.strip())
    for part in parts:
        part = part.strip()
        if not part:
            continue

        substance = part
        reaction = None

        # "Penicillin (rash)" or "Penicillin（皮疹）"
        m = re.match(r"^(.+?)\s*[（(](.+?)[）)]\s*$", part)
        if m:
            substance = m.group(1).strip()
            reaction = m.group(2).strip()
        else:
            # "Penicillin - rash" (dash separator)
            m = re.match(r"^(.+?)\s+-\s+(.+)$", part)
            if m:
                substance = m.group(1).strip()
                reaction = m.group(2).strip()
            else:
                # "Penicillin：皮疹"
                m = re.match(r"^(.+?)\s*[:：]\s+(.+)$", part)
                if m:
                    substance = m.group(1).strip()
                    reaction = m.group(2).strip()

        # Clean up substance
        substance = substance.strip(" \t\n.-:：")
        if not substance:
            continue

        results.append({
            "substance": substance,
            "reaction": reaction,
        })

    return results


def _is_negative_substance(substance: str) -> bool:
    """Check if a substance value actually means 'no allergy'."""
    normalized = substance.strip().lower()
    # Exact match
    if normalized in _NEGATIVE_SUBSTANCE_WORDS:
        return True
    # Starts with negative word
    if normalized.startswith(("nil", "none", "no ", "無", "否")):
        return True
    return False


# ---------------------------------------------------------------------------
# Main API
# ---------------------------------------------------------------------------

def parse_allergy_text(text: str) -> AllergyResult:
    """Parse a single SUBJECTIVE text block for allergy information.

    Returns:
        {"status": "nka"|"has_allergies"|"unknown", "allergies": [...]}
    """
    if not text or not text.strip():
        return {"status": "unknown", "allergies": []}

    # --- Phase 1: Check positive patterns (line by line) ---
    allergies: List[Dict[str, Any]] = []
    found_negative_via_positive = False
    lines = text.split("\n")

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue

        for pattern in _POSITIVE_PATTERNS:
            m = pattern.search(line_stripped)
            if not m:
                continue
            raw_substances = m.group(1).strip()
            parsed = _split_substances(raw_substances)
            had_match = False
            for item in parsed:
                if _is_negative_substance(item["substance"]):
                    # Pattern matched but substance is a negative word (e.g. NIL)
                    found_negative_via_positive = True
                    continue
                had_match = True
                allergies.append({
                    "substance": item["substance"],
                    "reaction": item.get("reaction"),
                    "extracted_text": line_stripped,
                })
            break  # One pattern match per line is enough

    if allergies:
        return {"status": "has_allergies", "allergies": allergies}

    # --- Phase 2: Check negative patterns ---
    if found_negative_via_positive:
        return {"status": "nka", "allergies": []}

    for line in lines:
        line_stripped = line.strip()
        for pattern in _NEGATIVE_PATTERNS:
            if pattern.search(line_stripped):
                return {"status": "nka", "allergies": []}

    # --- Phase 3: No allergy mention at all ---
    return {"status": "unknown", "allergies": []}


def parse_allergy_texts(texts: List[str]) -> AllergyResult:
    """Parse multiple SUBJECTIVE texts (from multiple visits).

    Positive findings from any visit override negatives.
    Substances are deduplicated by name (case-insensitive).
    """
    if not texts:
        return {"status": "unknown", "allergies": []}

    all_allergies: List[Dict[str, Any]] = []
    has_negative = False

    for text in texts:
        result = parse_allergy_text(text)
        if result["status"] == "has_allergies":
            all_allergies.extend(result["allergies"])
        elif result["status"] == "nka":
            has_negative = True

    if all_allergies:
        # Dedup by substance name (case-insensitive)
        seen = set()
        deduped = []
        for a in all_allergies:
            key = a["substance"].lower()
            if key not in seen:
                seen.add(key)
                deduped.append(a)
        return {"status": "has_allergies", "allergies": deduped}

    if has_negative:
        return {"status": "nka", "allergies": []}

    return {"status": "unknown", "allergies": []}
