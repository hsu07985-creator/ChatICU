"""Manual duplicate-medication check endpoint.

Sister of ``GET /patients/{patient_id}/medication-duplicates`` but stateless:
the caller passes a list of arbitrary drug names (typically from the pharmacy
"重複用藥" page's manual drug picker) and we run the same detector without
touching the DB cache. Resolves each name to an ATC code via the formulary
CSV so the L1/L2/L4 layers can fire.

    POST /pharmacy/duplicate-check

Request body::

    {
      "drugs": [
        {"name": "Clopidogrel", "atcCode": "B01AC04", "route": "PO"},
        {"name": "Aspirin",     "route": "PO"}
      ],
      "context": "inpatient"  // optional, default inpatient
    }

Response::

    {
      "success": true,
      "data": {
        "alerts": [DuplicateAlert.to_dict(), ...],
        "counts": {"critical": N, "high": N, "moderate": N, "low": N, "info": N},
        "resolved": [{"name": "...", "atcCode": "..."}, ...]
      }
    }
"""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.services.duplicate_detector import DuplicateDetector
from app.utils.response import success_response

router = APIRouter(tags=["pharmacy"])

# --- Formulary name→ATC lookup (mirrors backfill_drug_interactions_atc.py) ---

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
_FORMULARY_CSV = _BACKEND_ROOT / "app" / "fhir" / "code_maps" / "drug_formulary.csv"

# Shared with scripts/backfill_drug_interactions_atc.py — multi-word drugs
# starting with these first-words are NOT eligible for the first-word fallback
# (e.g. "Sodium Zirconium Cyclosilicate" would otherwise collide with saline).
_AMBIGUOUS_FIRST_WORDS = frozenset({
    "sodium", "potassium", "calcium", "magnesium",
    "iron", "ferric", "ferrous", "aluminum", "aluminium",
    "zinc", "lithium",
    "insulin", "insulim",
    "human", "hepatitis", "vitamin", "amino", "recombinant",
    "mag.",
})


def _build_name_to_atc() -> dict[str, str]:
    out: dict[str, str] = {}
    if not _FORMULARY_CSV.exists():  # pragma: no cover — defensive
        return out
    with _FORMULARY_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            atc = (row.get("atc_code") or "").strip()
            ingr = (row.get("ingredient") or "").strip()
            if not (atc and ingr):
                continue
            out.setdefault(ingr.lower(), atc)
            first = re.split(r"[\s\(\[/\-]", ingr)[0].strip().lower()
            if first and first not in _AMBIGUOUS_FIRST_WORDS:
                out.setdefault(first, atc)
    return out


_NAME_TO_ATC: Optional[dict[str, str]] = None


def _name_to_atc() -> dict[str, str]:
    global _NAME_TO_ATC
    if _NAME_TO_ATC is None:
        _NAME_TO_ATC = _build_name_to_atc()
    return _NAME_TO_ATC


def _lookup_atc(name: str) -> Optional[str]:
    if not name:
        return None
    table = _name_to_atc()
    key = name.strip().lower()
    if key in table:
        return table[key]
    first = re.split(r"[\s\(\[/\-]", name)[0].strip().lower()
    if first and first not in _AMBIGUOUS_FIRST_WORDS and first in table:
        return table[first]
    # Strip common route/form suffixes
    stripped = re.sub(
        r"\s*\((Systemic|Oral|Topical|Injection|Inhalation|Ophthalmic|Transdermal|Oral Inhalation)[^)]*\)",
        "",
        name,
        flags=re.IGNORECASE,
    ).strip().lower()
    if stripped and stripped in table:
        return table[stripped]
    return None


# --- Request / response -----------------------------------------------


class _DrugInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    atcCode: Optional[str] = Field(None, max_length=10)
    route: Optional[str] = Field(None, max_length=20)
    isPrn: Optional[bool] = None


class _DuplicateCheckRequest(BaseModel):
    drugs: List[_DrugInput] = Field(..., min_length=2, max_length=30)
    context: str = Field("inpatient", pattern="^(inpatient|outpatient|icu|discharge)$")


@router.post("/duplicate-check")
async def check_duplicate_medications(
    body: _DuplicateCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run the duplicate-medication detector on an ad-hoc drug list.

    No database writes and no cache — purely stateless. Resolves ATC codes
    from the hospital formulary when the caller didn't provide one, so the
    L1/L2/L4 detection layers still have the inputs they need.
    """
    # Build pseudo-Medication dicts for the detector.
    synth: List[dict] = []
    resolved: List[dict] = []
    for idx, d in enumerate(body.drugs):
        atc = (d.atcCode or "").strip() or _lookup_atc(d.name)
        synth.append({
            "medication_id": f"manual_{idx}",
            "generic_name": d.name.strip(),
            "atc_code": atc,
            "route": (d.route or None),
            "is_prn": bool(d.isPrn),
            "last_admin_at": None,
        })
        resolved.append({"name": d.name.strip(), "atcCode": atc})

    try:
        detector = DuplicateDetector(db)
        alerts = await detector.analyze(synth, context=body.context)  # type: ignore[arg-type]
    except Exception as exc:  # pragma: no cover — detector is well-tested
        raise HTTPException(status_code=500, detail=f"detector error: {exc}") from exc

    counts = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}
    for a in alerts:
        if a.level in counts:
            counts[a.level] += 1

    return success_response(
        data={
            "alerts": [a.to_dict() for a in alerts],
            "counts": counts,
            "resolved": resolved,
        }
    )
