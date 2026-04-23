"""Discharge medication reconciliation endpoint (Wave 6a).

Per docs/duplicate-medication-integration-plan.md §4.5 (出院管理) and
docs/duplicate-medication-assessment-guide.md §4.2 (Med Rec 節點), this router
exposes::

    GET /patients/{patient_id}/discharge-check

Compares inpatient medications that were active at discharge against the
discharge medication order set, to surface two categories of issues:

1. **missedDiscontinuations** — inpatient drugs (e.g. SUP PPI, empirical
   antibiotics, PRN orders, routine inpatient-only meds) that were active at
   discharge but are not carried on the discharge order (and were not
   explicitly stopped via ``end_date``). The classic ICU-to-ward trap is an
   IV PPI for stress-ulcer prophylaxis that is silently dropped or — worse —
   double-ordered alongside a PO PPI from the discharge set.
2. **dischargeDuplicates** — the discharge order set itself, passed through
   :class:`app.services.duplicate_detector.DuplicateDetector` with
   ``context="discharge"`` so the existing detector's cross-mechanism /
   endpoint-group logic runs unchanged.

If the patient has no ``discharge_date`` set yet (still inpatient) the
endpoint still returns 200 with ``dischargeDate: null`` and empty arrays so
callers can safely render a "not yet discharged" state without error handling.

The :class:`DuplicateDetector` is **consumed**, never modified — this router
is a pure orchestrator.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.medication import Medication
from app.models.patient import Patient
from app.models.user import User
from app.routers.patients import normalize_patient_id, verify_patient_access
from app.services.duplicate_detector import DuplicateDetector
from app.utils.response import success_response

router = APIRouter(tags=["medications"])


# ---------------------------------------------------------------------------
# Constants & classification helpers
# ---------------------------------------------------------------------------

# Stress-ulcer prophylaxis (SUP) / GI-prophylaxis keyword set. We deliberately
# keep this narrow so we don't misclassify PPIs legitimately prescribed for
# GERD / peptic-ulcer disease — those indications normally carry through
# discharge and do NOT belong in missedDiscontinuations.
_SUP_KEYWORDS = (
    "sup",
    "stress ulcer",
    "stress-ulcer",
    "stress ulcr",
    "gi prophylaxis",
    "gi proph",
    "gi-prophylaxis",
    "壓力性潰瘍",
    "壓力潰瘍",
    "預防",
)

# PPI L4 prefix (ATC): A02BC — Proton pump inhibitors.
_PPI_L4_PREFIX = "A02BC"

# Empirical-antibiotic duration cutoff (days). Inpatient antibiotics that ran
# ≤ 7 days typically represent an empirical course (e.g. community-acquired
# pneumonia 5-7d, uncomplicated UTI 3-7d). A course > 7 days is more likely a
# targeted / completed course and doesn't warrant an "unfinished empirical"
# flag on its own.
_EMPIRICAL_ABX_DAYS = 7


def _is_ppi(med: Medication) -> bool:
    atc = (med.atc_code or "").strip().upper()
    if atc.startswith(_PPI_L4_PREFIX):
        return True
    name = (med.generic_name or med.name or "").lower()
    return name.endswith("prazole") or "prazole" in name


def _is_sup_indication(med: Medication) -> bool:
    """Heuristic: does this inpatient PPI look like a SUP order?

    Two signals, either sufficient:
      * ``indication`` text contains a SUP / GI-prophylaxis keyword, OR
      * inpatient IV PPI order (source_type='inpatient' + route in IV family)
        — ICU SUP orders are almost universally IV per UGIB / SCCM guidance.
    """
    ind = (med.indication or "").lower()
    if any(k in ind for k in _SUP_KEYWORDS):
        return True

    route = (med.route or "").strip().upper()
    source = (med.source_type or "").strip().lower()
    if source == "inpatient" and route in {"IV", "IVP", "IVPB", "IV DRIP"}:
        return True
    return False


def _course_days(med: Medication, discharge_date) -> Optional[int]:
    """Return the (approximate) inpatient course length in days.

    Falls back to discharge_date when end_date is absent (med still active at
    discharge). Returns ``None`` when the start_date is missing so the caller
    can skip the duration-based classification.
    """
    if med.start_date is None:
        return None
    end = med.end_date or discharge_date
    if end is None:
        return None
    try:
        return (end - med.start_date).days
    except TypeError:
        return None


def _same_drug(inp: Medication, dis: Medication) -> bool:
    """Return True if the two rows represent the same drug (or same class).

    Match rules (any one wins):
      1. Identical 7-char ATC L5 code.
      2. Shared 5-char ATC L4 prefix (same therapeutic subclass — covers
         Pantoprazole → Omeprazole substitution at discharge).
      3. Same lower-cased generic_name.
    """
    a = (inp.atc_code or "").strip().upper()
    b = (dis.atc_code or "").strip().upper()
    if a and b:
        if a == b:
            return True
        if len(a) >= 5 and len(b) >= 5 and a[:5] == b[:5]:
            return True

    an = (inp.generic_name or "").strip().lower()
    bn = (dis.generic_name or "").strip().lower()
    if an and bn and an == bn:
        return True
    return False


def _has_continuation(inp_med: Medication, discharge_meds: List[Medication]) -> bool:
    return any(_same_drug(inp_med, d) for d in discharge_meds)


def _classify_missed_discontinuation(
    med: Medication, discharge_date
) -> Dict[str, Any]:
    """Classify a missed-discontinuation candidate into one of 4 buckets.

    Returns a dict with keys ``category``, ``severity``, ``reason``. The
    category order-of-check matters — SUP PPI is checked first so a PRN IV
    PPI still lands in ``sup_ppi`` rather than the PRN bucket.
    """
    # 1. SUP PPI (High) — inpatient PPI whose indication / route pattern
    #    matches stress-ulcer prophylaxis.
    if _is_ppi(med) and _is_sup_indication(med):
        return {
            "category": "sup_ppi",
            "severity": "high",
            "reason": (
                "入院時開立 IV PPI 作為 SUP，出院單未繼續開立也未記錄停藥；"
                "常見 ICU 病房轉出陷阱。"
            ),
        }

    # 2. Empirical antibiotic (High) — short course (≤ 7 d) abx not carried
    #    on discharge. We flag it for therapy-completion confirmation rather
    #    than assume it was legitimately stopped.
    if bool(med.is_antibiotic):
        days = _course_days(med, discharge_date)
        if days is not None and days <= _EMPIRICAL_ABX_DAYS:
            return {
                "category": "empirical_antibiotic",
                "severity": "high",
                "reason": (
                    "住院期間經驗性抗生素（療程 ≤ 7 天）出院未繼續；"
                    "請確認療程是否已結束，以免中斷治療。"
                ),
            }

    # 3. PRN-only (Low) — PRN orders normally are NOT expected to transfer
    #    to discharge, but flag for the pharmacist's situational awareness.
    if bool(med.prn):
        return {
            "category": "prn_only",
            "severity": "low",
            "reason": (
                "住院期間 PRN 用藥出院未開立（一般屬正常），"
                "供藥師轉銜時檢視之用。"
            ),
        }

    # 4. Other routine inpatient meds (Moderate) — worth a second look.
    return {
        "category": "other",
        "severity": "moderate",
        "reason": (
            "住院常規用藥出院未見；確認是否刻意停藥或遺漏。"
        ),
    }


# ---------------------------------------------------------------------------
# DB loaders
# ---------------------------------------------------------------------------

async def _load_inpatient_active_at_discharge(
    db: AsyncSession, patient_id: str, discharge_date
) -> List[Medication]:
    """Inpatient meds that were active on (or through) the discharge date.

    Selection criteria:
      * source_type = 'inpatient'
      * (end_date IS NULL) OR (end_date >= discharge_date) — not stopped
        before discharge.
      * start_date IS NULL OR start_date <= discharge_date — already started
        by discharge (guards against future-dated orders).
    """
    stmt = select(Medication).where(Medication.patient_id == patient_id)
    result = await db.execute(stmt)
    meds = list(result.scalars().all())

    filtered: List[Medication] = []
    for m in meds:
        # Only consider inpatient-sourced rows. Rows with NULL source_type are
        # treated as inpatient for backward-compat with legacy seeds.
        src = (m.source_type or "inpatient").lower()
        if src != "inpatient":
            continue
        # Started by discharge (or unknown).
        if m.start_date is not None and discharge_date is not None:
            if m.start_date > discharge_date:
                continue
        # Not stopped before discharge.
        if m.end_date is not None and discharge_date is not None:
            if m.end_date < discharge_date:
                continue
        filtered.append(m)
    return filtered


async def _load_discharge_medications(
    db: AsyncSession, patient_id: str
) -> List[Medication]:
    """Discharge med orders — rows with source_type='outpatient'.

    Rationale: at our HIS the discharge prescription lands in the medication
    table with ``source_type='outpatient'`` (it is dispensed from the
    outpatient pharmacy for home use). ``self-supplied`` is excluded because
    those are patient-brought meds, not physician-ordered at discharge.
    """
    stmt = select(Medication).where(
        (Medication.patient_id == patient_id)
        & (Medication.source_type == "outpatient")
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _inpatient_summary(med: Medication) -> Dict[str, Any]:
    return {
        "medicationId": med.id,
        "genericName": med.generic_name or med.name or "",
        "atcCode": med.atc_code,
        "indication": med.indication,
        "startDate": med.start_date.isoformat() if med.start_date else None,
    }


def _discharge_summary(med: Medication) -> Dict[str, Any]:
    return {
        "medicationId": med.id,
        "genericName": med.generic_name or med.name or "",
        "atcCode": med.atc_code,
        "daysSupply": med.days_supply,
    }


def _tally_alerts(alerts) -> Dict[str, int]:
    counts = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}
    for a in alerts:
        lvl = getattr(a, "level", None)
        if lvl in counts:
            counts[lvl] += 1
    return counts


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/patients/{patient_id}/discharge-check")
async def discharge_check(
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compare inpatient-active-at-discharge vs discharge meds.

    Returns 200 + ``dischargeDate: null`` + empty arrays when the patient is
    still inpatient (no discharge_date set). Returns 404 only when the
    patient does not exist.
    """
    pid = normalize_patient_id(patient_id)

    pat_result = await db.execute(select(Patient).where(Patient.id == pid))
    patient_obj = pat_result.scalar_one_or_none()
    if patient_obj is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    verify_patient_access(user, patient_obj)

    discharge_date = patient_obj.discharge_date
    discharge_type = patient_obj.discharge_type
    empty_counts = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "info": 0}

    # Still inpatient — short-circuit with an empty envelope.
    if discharge_date is None:
        return success_response(
            data={
                "patientId": pid,
                "dischargeDate": None,
                "dischargeType": discharge_type,
                "inpatientActiveAtDischarge": [],
                "dischargeMedications": [],
                "missedDiscontinuations": [],
                "dischargeDuplicates": [],
                "counts": {
                    "missedDiscontinuations": 0,
                    "dischargeDuplicates": dict(empty_counts),
                },
            }
        )

    inpatient_active = await _load_inpatient_active_at_discharge(
        db, pid, discharge_date
    )
    discharge_meds = await _load_discharge_medications(db, pid)

    # 1. Missed discontinuations — inpatient meds with no continuation on
    #    the discharge order.
    missed: List[Dict[str, Any]] = []
    for inp in inpatient_active:
        if _has_continuation(inp, discharge_meds):
            continue
        bucket = _classify_missed_discontinuation(inp, discharge_date)
        missed.append(
            {
                "medicationId": inp.id,
                "genericName": inp.generic_name or inp.name or "",
                "atcCode": inp.atc_code,
                "category": bucket["category"],
                "severity": bucket["severity"],
                "reason": bucket["reason"],
                "inpatientStartDate": (
                    inp.start_date.isoformat() if inp.start_date else None
                ),
            }
        )

    # 2. Discharge-set internal duplicates — pure DuplicateDetector reuse.
    detector = DuplicateDetector(db)
    discharge_alerts = await detector.analyze(
        discharge_meds, context="discharge"
    )
    discharge_duplicate_dicts = [a.to_dict() for a in discharge_alerts]
    discharge_counts = _tally_alerts(discharge_alerts)

    return success_response(
        data={
            "patientId": pid,
            "dischargeDate": discharge_date.isoformat() if discharge_date else None,
            "dischargeType": discharge_type,
            "inpatientActiveAtDischarge": [
                _inpatient_summary(m) for m in inpatient_active
            ],
            "dischargeMedications": [
                _discharge_summary(m) for m in discharge_meds
            ],
            "missedDiscontinuations": missed,
            "dischargeDuplicates": discharge_duplicate_dicts,
            "counts": {
                "missedDiscontinuations": len(missed),
                "dischargeDuplicates": discharge_counts,
            },
        }
    )
