"""Import-time resource loads shared by all HISConverter instances.

The JSON/CSV resource files live in the parent ``app/fhir/`` directory (the
original module location), so paths here resolve against that directory rather
than this package.
"""

import json
import os
from typing import Any, Dict, List, Optional, Tuple

# Directory that holds the HIS resource files (his_site_config.json, the DDI
# maps, code_maps/, ...). These have always lived in app/fhir/, so resolve
# against the parent of this package directory.
_FHIR_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_site_config() -> Dict[str, Any]:
    """Load his_site_config.json from the app/fhir directory."""
    config_path = os.path.join(_FHIR_DIR, "his_site_config.json")
    try:
        with open(config_path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def _load_ddi_alias_map() -> Dict[str, List[str]]:
    """Load his_ddi_alias_map.json: ODR_CODE → DDI DB drug name(s).

    Keys starting with '_' are metadata/comments and are skipped.
    Values are lists of DDI DB drug names (proper case from drug_interactions DB).
    """
    map_path = os.path.join(_FHIR_DIR, "his_ddi_alias_map.json")
    try:
        with open(map_path, encoding="utf-8") as f:
            raw = json.load(f)
        return {k: v for k, v in raw.items() if not k.startswith("_")}
    except FileNotFoundError:
        return {}


def _load_ddi_exclusion_set() -> set:
    """Load his_ddi_exclusion_list.json: ODR_CODEs to skip in DDI analysis.

    These are IV fluids, electrolyte solutions, and adjunct supplies with
    no clinically meaningful drug-drug interactions.
    """
    path = os.path.join(_FHIR_DIR, "his_ddi_exclusion_list.json")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        return {e["odr_code"] for e in raw.get("exclusions", [])}
    except FileNotFoundError:
        return set()


def _load_formulary() -> Dict[str, Dict[str, Any]]:
    """Load drug_formulary.csv (Yangming hospital formulary + ABX + manual fills).

    See backend/scripts/build_formulary_csv.py for how this CSV is produced.
    Returns: {ODR_CODE: {atc_code, is_antibiotic: bool, kidney_relevant: Optional[bool],
                          source, ingredient, ...}}
    """
    import csv

    path = os.path.join(_FHIR_DIR, "code_maps", "drug_formulary.csv")
    out: Dict[str, Dict[str, Any]] = {}
    try:
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                code = (row.get("odr_code") or "").strip()
                atc = (row.get("atc_code") or "").strip()
                if not code or not atc:
                    continue
                kr_raw = (row.get("kidney_relevant") or "").strip()
                if kr_raw == "1":
                    kidney_relevant: Optional[bool] = True
                elif kr_raw == "0":
                    kidney_relevant = False
                else:
                    kidney_relevant = None
                out[code] = {
                    "atc_code": atc,
                    "is_antibiotic": (row.get("is_antibiotic") or "").strip() == "1",
                    "kidney_relevant": kidney_relevant,
                    "source": (row.get("source") or "").strip(),
                    "ingredient": (row.get("ingredient") or "").strip(),
                }
    except FileNotFoundError:
        return {}
    return out


# Load once at module import time so all HISConverter instances share it.
_SITE_CONFIG = _load_site_config()
_DDI_ALIAS_MAP: Dict[str, List[str]] = _load_ddi_alias_map()
_DDI_EXCLUSION_SET: set = _load_ddi_exclusion_set()
_FORMULARY_MAP: Dict[str, Dict[str, Any]] = _load_formulary()
_FILENAME_ALIASES: Dict[str, Tuple[str, ...]] = {
    "getIPD.json": ("getIPD.json", "getIpd.json"),
    "getIpd.json": ("getIpd.json", "getIPD.json"),
}
