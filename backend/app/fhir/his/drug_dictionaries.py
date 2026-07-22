"""Medicine helpers: frequency/route maps, SAN + therapeutic classification,
and HIS drug-name cleaning."""

import re
from typing import Optional, Tuple

_FREQ_MAP = {
    "STAT": "stat",
    "QD": "qd", "QDAM": "qd", "QDPM": "qd",
    "QDAC": "qd ac", "QDAC30M": "qd ac",
    "QDPC": "qd pc",
    "QDHS": "qd hs",
    "QN": "qn",
    "BID": "bid", "BIDAC30M": "bid ac", "BIDPC": "bid pc",
    "TID": "tid", "TIDAC": "tid ac", "TIDPC": "tid pc", "TIDWM": "tid",
    "QID": "qid", "QIDPC": "qid pc",
    "Q4H": "q4h", "Q4HPRN": "q4h",
    "Q6H": "q6h", "Q6HPRN": "q6h",
    "Q8H": "q8h", "Q8HPRN": "q8h",
    "Q12H": "q12h", "Q12HPRN": "q12h",
    "HS": "hs", "HSPRN": "hs",
    "PRN": "prn",
    "QOD": "qod", "QODHS": "qod hs",
    "Q3D": "q3d",
    "QW1": "qw",
    "QW": "qw",
    "QW4": "q4w",
    "BIW14": "biw",
    "QDAMAC": "qd ac",
    "Q1HPRN": "q1h prn",
    "AS ORDER": "as ordered",
}

_ROUTE_MAP = {
    "IV": "IV",
    "IVD": "IV infusion",
    "PO": "PO",
    "SC": "SC",
    "IM": "IM",
    "INHL": "INH",
    "RECT": "PR",
    "EXT": "EXT",
    "TOPI": "TOP",
    "OU": "EYE",
    "OS": "EYE",
    "IRRI": "IRRI",
    "LA": "LA",
    "LI": "LI",
}

_OPD_SW_MAP = {
    "I": "inpatient",
    "O": "outpatient",
    "0": "inpatient",
    "1": "inpatient",
}

_SAN_ATC_PREFIXES = (
    ("N05CD", "S"), ("N05BA", "S"), ("N05CM", "S"),
    ("N05AD", "S"), ("N01AX", "S"),
    ("N01AH", "A"), ("N02A", "A"), ("N02BE", "A"), ("M01A", "A"),
    ("M03A", "N"),
)


def _classify_san(atc_code: Optional[str]) -> Optional[str]:
    """Classify S/A/N solely from the HIS ATC_CODE field."""
    code = (atc_code or "").strip().upper()
    for prefix, category in _SAN_ATC_PREFIXES:
        if code.startswith(prefix):
            return category
    return None


_CATEGORY_ATC_PREFIXES = (
    # Exact exception must precede the broader A07AA antibacterial class.
    ("A07AA02", "antifungal"),
    ("J01", "antibiotic"), ("J04", "antibiotic"),
    ("P01AB", "antibiotic"), ("D06A", "antibiotic"),
    ("D06BA", "antibiotic"), ("S01AA", "antibiotic"),
    ("A07AA", "antibiotic"),
    ("J02", "antifungal"), ("D01", "antifungal"),
    ("J05", "antiviral"), ("D06BB", "antiviral"), ("S01AD", "antiviral"),
    ("C01CA", "vasopressor"), ("C01CE", "vasopressor"),
    ("H01BA", "vasopressor"),
    ("B01AA", "anticoagulant"), ("B01AB", "anticoagulant"),
    ("B01AE", "anticoagulant"), ("B01AF", "anticoagulant"),
    ("B01AX", "anticoagulant"),
    ("H02A", "steroid"), ("D07", "steroid"), ("R01AD", "steroid"),
    ("R03BA", "steroid"), ("S01BA", "steroid"), ("S01BB", "steroid"),
    ("S02B", "steroid"), ("S03B", "steroid"),
    ("A02BC", "ppi"), ("A02BA", "h2_blocker"),
    ("C03", "diuretic"), ("A10A", "insulin"),
    ("A12", "electrolyte"), ("B05XA", "electrolyte"),
    ("R03AC", "bronchodilator"), ("R03AK", "bronchodilator"),
    ("R03AL", "bronchodilator"), ("R03CC", "bronchodilator"),
    ("R03DA", "bronchodilator"),
    ("C01B", "antiarrhythmic"), ("N03A", "antiepileptic"),
    ("A06", "laxative"), ("A03FA", "antiemetic"), ("A04", "antiemetic"),
)


def _classify_category(atc_code: Optional[str]) -> Optional[str]:
    """Classify the therapeutic tag solely from the HIS ATC_CODE field."""
    code = (atc_code or "").strip().upper()
    for prefix, category in _CATEGORY_ATC_PREFIXES:
        if code.startswith(prefix):
            return category
    return None


# Combination-drug generic parsing for HIS DRUG_NAME.
# Units the ratio/dose tokens end in (the trailing (?![A-Za-z]) guard — not \b —
# is what lets a unit ending in a non-word char like '%' strip cleanly).
_COMBO_UNIT = r"(?:mg|mcg|ug|µg|g|gm|kg|ml|l|iu|units?|u|%|meq|mmol|oz|cc)"
# A strength/dose/ratio run: number (optionally a ratio 10/0.5/1) + unit(s).
# The required leading number+unit is what protects real name-numbers
# ("Vit B12", "Q10", "VIT K1", "Isosorbide-5-Mononitrate") from being stripped.
_COMBO_STRENGTH = re.compile(
    r"\b[\d.]+(?:\s*/\s*[\d.]+)*\s*" + _COMBO_UNIT + r"(?:\s*/\s*" + _COMBO_UNIT + r")*(?![A-Za-z])",
    re.IGNORECASE,
)
# Dosage-form / packaging words that pollute a generic name.
_COMBO_FORM = re.compile(
    r"\b(?:cream|gel|oint(?:ment)?|sol(?:'n|ution)?|susp(?:ension)?|"
    r"tab(?:let)?|cap(?:sule)?|inj(?:ection)?|eye\s+(?:drop|oint)s?|oph\.?|"
    r"drops?|lotion|syrup|powder|patch|spray|sr|xl|xr|lyo|respimat|"
    r"nebul(?:e|iser)?|effervescent|granules?)\b",
    re.IGNORECASE,
)
_COMBO_SEP = re.compile(r"[,;+/]")


def _combo_generic_from_his(drug_name: str) -> Optional[str]:
    """HIS DRUG_NAME → clean ' / '-joined ingredient list for DDI name matching.

    Strips strengths/forms BEFORE splitting so a strength ratio like ``50mg/gm``
    is never mistaken for a component separator. Single-ingredient names come
    back cleaned (strength/form removed); combinations split on , ; + /.
    Returns None when nothing alphabetic survives.

        "Amlodipine 5mg, Telmisartan 80mg"        -> "Amlodipine / Telmisartan"
        "Empagliflozin 12.5mg / Metformin 850mg"  -> "Empagliflozin / Metformin"
        "Acyclovir 50mg/gm 5gm Cream"             -> "Acyclovir"   (single, / is a ratio)
    """
    s = drug_name.strip()
    if not s:
        return None
    s = _COMBO_STRENGTH.sub(" ", s)
    s = _COMBO_FORM.sub(" ", s)
    parts = []
    for raw in _COMBO_SEP.split(s):
        part = re.sub(r"\s+", " ", raw).strip(" -.")
        if part and re.search(r"[A-Za-z]", part):  # drop empties / stray unit fragments
            parts.append(part)
    if not parts:
        return None
    return " / ".join(parts)


def _clean_drug_name(raw_name: str) -> Tuple[str, Optional[str]]:
    """Clean HIS drug name, extract trade name and generic name.

    Input:  "Fentanyl【#】0.05mg/ml 10ml inj(管2)(總量以amp計)"
    Output: ("Fentanyl 0.05mg/ml 10ml inj", "Fentanyl")
    """
    # Extract generic from full-width brackets before stripping them
    # e.g. "GiPAmine【#】【Dopamine】600mg/200ml inj" → generic "Dopamine"
    fw_generic = None
    for fw in re.findall(r'【([A-Za-z][A-Za-z\s\-]+)】', raw_name):
        fw_generic = fw.strip()

    # Remove control marks like 【#】, (管2), (總量以amp計)
    name = re.sub(r'【[^】]*】', ' ', raw_name)
    name = re.sub(r'\(管\d\)', '', name)
    name = re.sub(r'\(總量[^)]*\)', '', name)
    name = re.sub(r'\(自費\)', '', name)
    name = re.sub(r'\(健保\)', '', name)
    name = re.sub(r'\[注射劑\]', ' inj ', name)
    name = re.sub(r'\[錠劑\]', ' tab ', name)
    name = re.sub(r'\[膠囊\]', ' cap ', name)
    name = re.sub(r'\s+', ' ', name).strip()

    # Extract generic name: prefer full-width bracket content, then first English word
    if fw_generic:
        generic = fw_generic
    else:
        generic_match = re.match(r'^([A-Za-z][A-Za-z\-]+)', name)
        if generic_match:
            generic = generic_match.group(1)
        else:
            # Fallback: find parenthesized generic name e.g. "(Acetylcysteine)"
            paren = re.search(r'\(([A-Za-z][A-Za-z\-]{3,})\)', raw_name)
            if paren:
                generic = paren.group(1)
            else:
                # Last resort: find any English word ≥4 chars in the name
                eng = re.search(r'([A-Za-z]{4,})', name)
                generic = eng.group(1) if eng else None

    return name, generic
