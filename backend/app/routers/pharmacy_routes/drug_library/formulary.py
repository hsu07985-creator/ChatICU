"""formulary — cached lookup of the hospital drug formulary CSV.

Maps a DDI drug name to its formulary entry (ATC, brand names, hospital
codes) using several normalisations so DDI display names like
"Morphine (Systemic)" resolve to formulary rows like "Morphine HCl 10mg/ml".
"""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Optional

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
FORMULARY_CSV = BACKEND_ROOT / "app" / "fhir" / "code_maps" / "drug_formulary.csv"

# ────────────────────────────────────────────────────────────────────
# Cached formulary lookup (rebuild on cold start)
# ────────────────────────────────────────────────────────────────────
_formulary_cache: Optional[dict] = None

# Tokens that aren't standalone drugs — skip when used as first-word fallback.
_AMBIGUOUS_FIRST_WORDS = frozenset({
    "sodium", "potassium", "calcium", "magnesium",
    "iron", "ferric", "ferrous", "aluminum", "aluminium",
    "zinc", "lithium",
    "insulin", "insulim",
    "human", "hepatitis", "vitamin", "amino", "recombinant",
    "mag.",
})


def _load_formulary() -> dict:
    """Return {ingredient_lower: {atc, brand_names, hospital_codes}}."""
    global _formulary_cache
    if _formulary_cache is not None:
        return _formulary_cache
    out: dict = {}
    if not FORMULARY_CSV.exists():
        _formulary_cache = out
        return out
    with FORMULARY_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ingr = (row.get("ingredient") or "").strip()
            if not ingr:
                continue
            key = ingr.lower()
            entry = out.setdefault(key, {
                "atc": (row.get("atc_code") or "").strip() or None,
                "brand_names": [],
                "hospital_codes": [],
                "ingredient": ingr,
            })
            brand = (row.get("brand_name") or "").strip()
            if brand and brand not in entry["brand_names"]:
                entry["brand_names"].append(brand)
            code = (row.get("odr_code") or "").strip()
            if code and code not in entry["hospital_codes"]:
                entry["hospital_codes"].append(code)
            # Index by first word too — so DDI's "Morphine (Systemic)" can
            # find formulary's "Morphine HCl 10mg/ml Inj" via "morphine".
            first = re.split(r"[\s\(\[/\-]", ingr)[0].strip().lower()
            if first and first != key and first not in _AMBIGUOUS_FIRST_WORDS:
                out.setdefault(first, entry)
    _formulary_cache = out
    return out


def formulary_lookup(name: str) -> Optional[dict]:
    """Try several normalisations to find a formulary entry."""
    fm = _load_formulary()
    if not name:
        return None
    key = name.strip().lower()
    if key in fm:
        return fm[key]
    # Strip parens: "Morphine (Systemic)" → "morphine"
    no_paren = re.sub(r"\s*\([^)]*\)\s*", " ", key).strip()
    no_paren = re.sub(r"\s+", " ", no_paren)
    if no_paren and no_paren != key and no_paren in fm:
        return fm[no_paren]
    # First word fallback (skip ambiguous ions like sodium / potassium)
    base = no_paren or key
    first = re.split(r"[\s\(\[/\-]", base)[0].strip().lower()
    if first and first not in _AMBIGUOUS_FIRST_WORDS and first in fm:
        return fm[first]
    return None
