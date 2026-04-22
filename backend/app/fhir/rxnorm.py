"""RxNorm + ATC auto-lookup for medications not in drug_formulary.csv.

Flow:
    ODR_NAME = "Tygacil 50mg inj(抗4)(Tigecycline)"
        ↓  extract_generic_name()
    "Tigecycline"
        ↓  RxNav /REST/rxcui.json?name=...
    rxcui = "384455"
        ↓  RxNav /REST/rxclass/class/byRxcui.json?rxcui=...&relaSource=ATC
    atc = "J01AA12"
        ↓  persist to code_maps/auto_rxnorm_cache.json

Design:
- **Cache first, network fallback**: each generic name is queried once; subsequent
  lookups (same name, across patients / syncs) hit the cache.
- **Offline-safe**: network failure does NOT break the sync — we simply leave the
  row unmapped so it surfaces in the unmapped audit.
- **Production runs offline**: launchd sync uses `online=False`. Cache is built up
  on a developer's machine via `backend/scripts/refresh_rxnorm_cache.py` and
  committed to git.

Imported from FHIR功能/藥物標準化/rxnorm.py (nephro-rag project) with the import
path adapted for this repo's layout.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from app.fhir.code_maps import CODE_MAPS_DIR

RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST"
DEFAULT_TIMEOUT = 5.0  # seconds
CACHE_PATH = CODE_MAPS_DIR / "auto_rxnorm_cache.json"

# Match an English ingredient name in parentheses.
# HIS convention: the last English parenthesis holds the generic — Chinese
# category labels like "(抗4)" appear earlier in the name.
# Constraints: ≥4 chars, starts with uppercase letter, allowed chars A-Za-z0-9
# space . - / +
_GENERIC_PAREN_RE = re.compile(r"\(([A-Z][A-Za-z0-9\s\.\-/+]{3,}?)\)")


@dataclass(frozen=True)
class RxNormResult:
    generic: str
    rxcui: str
    atc_code: Optional[str]
    atc_display: Optional[str]
    resolved_at: str  # ISO timestamp


def extract_generic_name(odr_name: Optional[str]) -> Optional[str]:
    """Pull the generic (ingredient) name out of a HIS ODR_NAME.

    >>> extract_generic_name("Tygacil 50mg inj(抗4)(Tigecycline)")
    'Tigecycline'
    >>> extract_generic_name("Rasitol【#】20mg/2ml/Amp(Furosemide)")
    'Furosemide'
    >>> extract_generic_name("N.S. 0.9% 500ML<BAG>")  # no parens → None
    """
    if not odr_name:
        return None
    matches = _GENERIC_PAREN_RE.findall(odr_name)
    if not matches:
        return None
    # Take the last paren group (generic is at the tail); normalise whitespace
    candidate = re.sub(r"\s+", " ", matches[-1]).strip()
    if len(candidate) < 4:
        return None
    return candidate


# -------------------- Cache --------------------


class RxNormCache:
    def __init__(self, path: Path = CACHE_PATH):
        self.path = path
        self._data: dict[str, dict[str, Any]] = {}
        self._loaded = False
        self._dirty = False

    def load(self) -> None:
        if self._loaded:
            return
        if self.path.exists():
            self._data = json.loads(self.path.read_text(encoding="utf-8"))
        self._loaded = True

    def get(self, generic: str) -> Optional[RxNormResult]:
        self.load()
        key = generic.lower().strip()
        d = self._data.get(key)
        if d is None:
            return None
        # rxcui=None means "looked up, confirmed miss" — skip retry
        if d.get("rxcui") is None:
            return None
        return RxNormResult(
            generic=d["generic"],
            rxcui=d["rxcui"],
            atc_code=d.get("atc_code"),
            atc_display=d.get("atc_display"),
            resolved_at=d["resolved_at"],
        )

    def was_looked_up(self, generic: str) -> bool:
        """True if this generic has been queried before (hit or confirmed miss)."""
        self.load()
        return generic.lower().strip() in self._data

    def put(self, generic: str, result: Optional[RxNormResult]) -> None:
        self.load()
        key = generic.lower().strip()
        self._data[key] = {
            "generic": generic,
            "rxcui": result.rxcui if result else None,
            "atc_code": result.atc_code if result else None,
            "atc_display": result.atc_display if result else None,
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        }
        self._dirty = True

    def save(self) -> None:
        if not self._dirty:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        self._dirty = False


# -------------------- HTTP --------------------


class RxNormNetworkError(RuntimeError):
    pass


def _http_get_json(url: str, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": "chaticu-fhir/0.1"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        raise RxNormNetworkError(str(e)) from e


def _query_rxcui(generic: str, timeout: float) -> Optional[str]:
    url = f"{RXNAV_BASE}/rxcui.json?" + urllib.parse.urlencode(
        {"name": generic, "search": 1}
    )
    data = _http_get_json(url, timeout)
    ids = (data.get("idGroup") or {}).get("rxnormId") or []
    return ids[0] if ids else None


def _query_atc(rxcui: str, timeout: float) -> tuple[Optional[str], Optional[str]]:
    url = f"{RXNAV_BASE}/rxclass/class/byRxcui.json?" + urllib.parse.urlencode(
        {"rxcui": rxcui, "relaSource": "ATC"}
    )
    data = _http_get_json(url, timeout)
    infos = (data.get("rxclassDrugInfoList") or {}).get("rxclassDrugInfo") or []
    # Prefer 5-char ATC (leaf classification); fall back to 4-char
    best: Optional[tuple[Optional[str], Optional[str]]] = None
    for info in infos:
        item = info.get("rxclassMinConceptItem") or {}
        cid = item.get("classId") or ""
        if len(cid) == 5:
            return cid, item.get("className")
        if best is None:
            best = (cid, item.get("className"))
    return best if best else (None, None)


# -------------------- Public API --------------------


@lru_cache(maxsize=1)
def _default_cache() -> RxNormCache:
    return RxNormCache()


def lookup(
    generic: str,
    *,
    online: bool = True,
    timeout: float = DEFAULT_TIMEOUT,
    cache: Optional[RxNormCache] = None,
) -> Optional[RxNormResult]:
    """Resolve a generic name → RxNormResult (cache-first).

    Args:
        generic: e.g. "Tigecycline"
        online: allow network query (False = cache-only; use this in production sync)
        timeout: HTTP timeout in seconds
        cache: inject a custom cache (tests); defaults to module-level singleton
    """
    if not generic or len(generic.strip()) < 3:
        return None

    c = cache or _default_cache()
    hit = c.get(generic)
    if hit:
        return hit
    if c.was_looked_up(generic):
        # queried before, confirmed miss → do not retry network
        return None
    if not online:
        return None

    try:
        rxcui = _query_rxcui(generic, timeout)
    except RxNormNetworkError:
        return None

    if not rxcui:
        c.put(generic, None)  # mark miss to avoid retry
        return None

    try:
        atc_code, atc_display = _query_atc(rxcui, timeout)
    except RxNormNetworkError:
        atc_code, atc_display = None, None

    result = RxNormResult(
        generic=generic,
        rxcui=rxcui,
        atc_code=atc_code,
        atc_display=atc_display,
        resolved_at=datetime.now(timezone.utc).isoformat(),
    )
    c.put(generic, result)
    return result


def save_cache(cache: Optional[RxNormCache] = None) -> None:
    """Persist newly learned cache entries. Call after a batch lookup pass."""
    (cache or _default_cache()).save()


def reset_default_cache() -> None:
    """Clear the module-level cache singleton (test helper)."""
    _default_cache.cache_clear()
