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

# Drug name patterns for SAN classification
_SAN_PATTERNS = {
    "S": [
        "propofol", "midazolam", "dormicum", "lorazepam", "ativan",
        "dexmedetomidine", "precedex", "ketamine",
        "haloperidol", "haldol", "quetiapine", "seroquel",
    ],
    "A": [
        "morphine", "fentanyl", "meperidine", "demerol", "tramadol",
        "acetaminophen", "panadol", "ketorolac",
        "diclofenac", "voltaren", "nefopam", "acupan",
    ],
    "N": [
        "cisatracurium", "nimbex", "rocuronium", "esmeron",
        "atracurium", "vecuronium", "succinylcholine",
    ],
}


def _classify_san(drug_name: str) -> Optional[str]:
    """Classify drug into S/A/N category by name pattern."""
    lower = drug_name.lower()
    for cat, patterns in _SAN_PATTERNS.items():
        for p in patterns:
            if p in lower:
                return cat
    return None


def _classify_category(drug_name: str) -> Optional[str]:
    """Classify drug into therapeutic category by name."""
    lower = drug_name.lower()
    categories = {
        "antibiotic": ["vancomycin", "meropenem", "ceftriaxone", "cefazolin",
                       "piperacillin", "tazobactam", "levofloxacin", "ciprofloxacin",
                       "metronidazole", "ampicillin", "amoxicillin", "azithromycin",
                       "colistin", "linezolid", "teicoplanin", "ceftazidime",
                       "cefepime", "imipenem", "ertapenem", "doxycycline",
                       "fluconazole", "voriconazole", "caspofungin", "anidulafungin",
                       "acyclovir", "ganciclovir", "oseltamivir",
                       "tigecycline", "tigelin", "biomycin", "brosym",
                       "tazocin", "gentamycin", "gentamicin", "pipe"],
        "vasopressor": ["norepinephrine", "levophed", "epinephrine", "vasopressin",
                        "dopamine", "dobutamine", "milrinone", "phenylephrine",
                        "gipamine"],
        "sedative": ["propofol", "midazolam", "dormicum", "lorazepam", "ativan",
                     "dexmedetomidine", "precedex", "ketamine", "haloperidol",
                     "xanax", "alprazolam", "seroquel", "quetiapine", "binin"],
        "analgesic": ["morphine", "fentanyl", "meperidine", "tramadol",
                      "acetaminophen", "panadol", "ketorolac", "nefopam",
                      "tramacet", "acetal"],
        "anticoagulant": ["heparin", "enoxaparin", "warfarin", "rivaroxaban"],
        "ppi": ["pantoprazole", "omeprazole", "esomeprazole", "lansoprazole",
                "famotidine", "ranitidine", "primperan"],
        "electrolyte": ["kcl", "potassium", "calcium gluconate", "magnesium",
                        "sodium bicarbonate", "nacl"],
        "diuretic": ["furosemide", "lasix", "spironolactone", "mannitol",
                     "bumetanide", "hydrochlorothiazide", "albumin"],
        "antiepileptic": ["levetiracetam", "keppra", "phenytoin", "valproic",
                          "carbamazepine", "lacosamide", "phenobarbital",
                          "depakine"],
        "antihypertensive": ["amlodipine", "nicardipine", "labetalol", "esmolol",
                             "nitroglycerin", "nitroprusside", "hydralazine",
                             "bisoprolol", "biso", "concor", "dilatrend",
                             "carvedilol", "herbesser", "diltiazem"],
        "insulin": ["insulin", "novolin", "novorapid", "lantus", "humalog"],
        "steroid": ["methylprednisolone", "hydrocortisone", "dexamethasone",
                    "prednisolone", "prednisone", "fludrocortisone"],
        "bronchodilator": ["salbutamol", "ventolin", "ipratropium", "combivent",
                           "aminophylline", "theophylline", "meptin",
                           "procaterol"],
        "nmb": ["cisatracurium", "nimbex", "rocuronium", "vecuronium",
                "succinylcholine", "atracurium"],
        "iv_fluid": ["n.s.", "normal saline", "glucose", "d5w", "d10w",
                     "lactated ringer", "benamine", "taita", "aminofluid",
                     "nutriflex", "kabiven", "smof"],
        "antiarrhythmic": ["amiodarone", "cordarone", "lidocaine"],
        "antidiabetic": ["jardiance", "empagliflozin", "metformin",
                         "trajenta", "linagliptin", "glimepiride"],
        "antihistamine": ["allegra", "fexofenadine", "cetirizine",
                          "diphenhydramine"],
        "thyroid": ["eltroxin", "levothyroxine"],
        "mucolytic": ["actein", "acetylcysteine"],
        "laxative": ["mosad", "smecta", "magnesium oxide", "dulcolax",
                     "bisacodyl", "lactulose"],
        "epo": ["nesp", "darbepoetin", "epoetin"],
        "hemostatic": ["transamin", "tranexamic"],
        "alpha_blocker": ["tamlosin", "tamsulosin"],
    }
    for cat, patterns in categories.items():
        for p in patterns:
            if p in lower:
                return cat
    return None


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
