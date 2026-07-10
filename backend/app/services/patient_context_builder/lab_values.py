"""Numeric value extractors for lab JSONB blobs and medication dose strings.

Pure functions: given an ORM row (or None), pull out a float. No DB, no
formatting. Knows about the two storage shapes (HIS-wrapped vs flat legacy)
and the canonical-key alias map.
"""

from datetime import datetime
from typing import Dict, List, Optional

from app.models.lab_data import LabData
from app.models.medication import Medication


# ── Value extractors ─────────────────────────────────────────────────────────

# Alias map: canonical lowercase key (as used by _fmt_lab_section / extract_*)
# → list of keys to try in the JSONB blob. Covers both:
#   • HIS import format (Scr, BUN, K, WBC, pH, Lactate, CRP, INR, aPTT, DDimer …)
#   • Legacy seed/flat format (creatinine, potassium, wbc, ph, lactate, crp …)
# The first hit wins. Keep HIS aliases first because production stores that format.
_LAB_KEY_ALIASES: Dict[tuple, List[str]] = {
    # biochemistry
    ("biochemistry", "creatinine"):      ["Scr", "creatinine", "Cr"],
    ("biochemistry", "bun"):             ["BUN", "bun"],
    ("biochemistry", "egfr"):            ["eGFR", "egfr", "GFR"],
    ("biochemistry", "potassium"):       ["K", "potassium"],
    ("biochemistry", "sodium"):          ["Na", "sodium"],
    ("biochemistry", "chloride"):        ["Cl", "chloride"],
    ("biochemistry", "ast"):             ["AST", "ast"],
    ("biochemistry", "alt"):             ["ALT", "alt"],
    ("biochemistry", "total_bilirubin"): ["TBil", "TBIL", "T-Bil", "T. Bili", "total_bilirubin", "bilirubin"],
    ("biochemistry", "direct_bilirubin"): ["DBil", "DBIL", "D-Bil", "Direct Bilirubin", "direct_bilirubin"],
    ("biochemistry", "alkaline_phosphatase"): ["AlkP", "ALP", "alkaline_phosphatase", "Alkaline Phosphatase"],
    ("biochemistry", "gamma_gt"):        ["rGT", "GGT", "r-GT", "gamma_gt"],
    ("biochemistry", "albumin"):         ["Alb", "albumin"],
    # hematology
    ("hematology", "wbc"):               ["WBC", "wbc"],
    ("hematology", "hemoglobin"):        ["Hb", "hemoglobin", "hgb"],
    ("hematology", "platelet"):          ["PLT", "platelet", "plt"],
    # blood_gas
    ("blood_gas", "ph"):                 ["pH", "PH", "ph"],
    ("blood_gas", "pco2"):               ["PCO2", "pco2"],
    ("blood_gas", "po2"):                ["PO2", "po2"],
    ("blood_gas", "hco3"):               ["HCO3", "hco3"],
    ("blood_gas", "lactate"):            ["Lactate", "lactate", "Lac"],
    # inflammatory
    ("inflammatory", "crp"):             ["CRP", "crp"],
    ("inflammatory", "pct"):             ["PCT", "pct", "Procalcitonin"],
    # coagulation
    ("coagulation", "inr"):              ["INR", "inr"],
    ("coagulation", "aptt"):             ["aPTT", "APTT", "aptt"],
    ("coagulation", "d_dimer"):          ["DDimer", "d_dimer", "D-Dimer"],
}


def _get_lab_val(lab: Optional[LabData], category: str, key: str) -> Optional[float]:
    """Safely extract a numeric value from a lab JSONB category.

    Handles two storage shapes transparently:
      • HIS import:  {"Scr": {"value": 1.2, "unit": "mg/dL", "referenceRange": "...", "isAbnormal": false}, ...}
      • Flat legacy: {"creatinine": 1.2, ...}

    Resolves `key` through _LAB_KEY_ALIASES so callers can use the canonical
    lowercase name regardless of which importer produced the row.
    """
    if not lab:
        return None
    data: Optional[dict] = getattr(lab, category, None)
    if not isinstance(data, dict):
        return None
    aliases = _LAB_KEY_ALIASES.get((category, key), [key])
    for alias in aliases:
        raw = data.get(alias)
        if raw is None:
            continue
        # HIS wraps each value in {"value": X, "unit": ..., ...}
        if isinstance(raw, dict):
            raw = raw.get("value")
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def _get_lab_item_as_of(lab: Optional[LabData], category: str, key: str) -> Optional[datetime]:
    """Return the source-row timestamp behind a merged item's value (svc-2).

    Reads the transient ``_item_as_of`` map that ``_merge_lab_rows``
    (repository.py) attaches to its return value — mirrors _get_lab_val's
    alias resolution so callers use the same canonical (category, key).
    Returns None when `lab` isn't a merge result, or the item has none
    (both mean: nothing stale to report, render as-is).
    """
    as_of = getattr(lab, "_item_as_of", None)
    if not isinstance(as_of, dict):
        return None
    cat_map = as_of.get(category)
    if not isinstance(cat_map, dict):
        return None
    aliases = _LAB_KEY_ALIASES.get((category, key), [key])
    for alias in aliases:
        ts = cat_map.get(alias)
        if isinstance(ts, datetime):
            return ts
    return None


def _vasopressor_ne_dose(meds: List[Medication]) -> Optional[float]:
    """Extract current NE (norepinephrine) dose in mcg/kg/min.

    W3-T5: ``m.dose`` is a free-text string. HIS data often arrives with
    units appended ("0.08 mcg/kg/min"). The previous ``float(m.dose)``
    raised ValueError on those rows and silently dropped NE from the
    delta block. Regex-extract the leading number instead.
    """
    import re as _re

    NE_NAMES = {"norepinephrine", "noradrenaline", "ne", "levophed"}
    for m in meds:
        name_lower = (m.generic_name or m.name or "").lower()
        if not any(n in name_lower for n in NE_NAMES):
            continue
        raw = (m.dose or "").strip()
        if not raw:
            continue
        match = _re.match(r"^\s*([+-]?[0-9]*\.?[0-9]+)", raw)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                pass
    return None
