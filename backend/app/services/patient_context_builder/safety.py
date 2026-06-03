"""Medication-safety reasoning: allergy↔med conflicts and duplicate warnings.

Holds the allergy normalisation/matching pipeline, the duplicate-detector
failure isolation wrapper, and the two safety-facing section formatters that
render their results. Depends on app.utils.duplicate_check for the underlying
detector.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

import app.services.patient_context_builder as _pkg

from app.models.patient import Patient
from app.models.medication import Medication
# Re-exported on the package namespace (see __init__) so callers/tests can
# patch ``pcb.format_duplicate_metadata`` / ``pcb.format_duplicate_text``;
# _safe_duplicate_warnings / _fmt_duplicate_section resolve them through
# ``_pkg`` at call time to honour that patch point (matches the original flat
# module, where these were module-globals).
from app.utils.duplicate_check import format_duplicate_metadata, format_duplicate_text

from ._shared import logger


_NO_ALLERGY_MARKERS = {
    "nka",
    "nkda",
    "none",
    "nil",
    "no known allergies",
    "no known drug allergies",
    "無",
    "無過敏",
    "無藥物過敏",
    "未記載",
    "否認",
}

_ALLERGY_GROUP_KEYWORDS: Dict[str, tuple[str, ...]] = {
    "penicillin": (
        "penicillin",
        "amoxicillin",
        "ampicillin",
        "piperacillin",
        "oxacillin",
        "nafcillin",
        "cloxacillin",
        "dicloxacillin",
    ),
    "pcn": (
        "penicillin",
        "amoxicillin",
        "ampicillin",
        "piperacillin",
    ),
    "cephalosporin": ("ceph", "cef"),
    "sulfa": ("sulfa", "sulfamethoxazole", "sulfonamide", "bactrim"),
    "sulfonamide": ("sulfa", "sulfamethoxazole", "sulfonamide", "bactrim"),
    "nsaid": (
        "aspirin",
        "ibuprofen",
        "ketorolac",
        "naproxen",
        "diclofenac",
        "celecoxib",
        "meloxicam",
    ),
}

# Chinese class-allergy terms → trigger key in _ALLERGY_GROUP_KEYWORDS.
# HIS allergy fields are often Chinese class names, which never substring-match
# English drug names; this routes them onto the existing English group path.
_ALLERGY_ZH_ALIASES: Dict[str, str] = {
    "青黴素": "penicillin",
    "盤尼西林": "penicillin",
    "磺胺": "sulfa",
    "磺胺類": "sulfa",
    "頭孢": "cephalosporin",
    "先鋒": "cephalosporin",
    "孢菌素": "cephalosporin",
    "阿斯匹靈": "nsaid",
}

_SAFETY_CATEGORY_ORDER = (
    "QT/心律風險",
    "出血風險",
    "腎毒性風險",
    "CNS/鎮靜呼吸風險",
    "重複/其他",
)


def _split_allergy_text(text: str) -> List[str]:
    import re as _re

    parts = _re.split(r"[,，、;/；\n]+", text)
    out = []
    for part in parts:
        item = part.strip()
        if item:
            out.append(item)
    return out


def _normalise_allergy_term(value: Any) -> Optional[str]:
    if value is None:
        return None
    term = str(value).strip()
    if not term:
        return None
    lowered = term.lower()
    if lowered in _NO_ALLERGY_MARKERS:
        return None
    return term


def _extract_allergy_terms(value: Any) -> List[str]:
    terms: List[str] = []

    def add(raw: Any) -> None:
        if isinstance(raw, str):
            candidates = _split_allergy_text(raw)
        else:
            candidates = [str(raw)]
        for candidate in candidates:
            term = _normalise_allergy_term(candidate)
            if term and term.lower() not in {t.lower() for t in terms}:
                terms.append(term)

    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                for key in (
                    "drug",
                    "name",
                    "allergen",
                    "medication",
                    "generic_name",
                    "content",
                    "message",
                    "value",
                ):
                    if item.get(key):
                        add(item[key])
                        break
            elif item:
                add(item)
    elif isinstance(value, dict):
        for key in (
            "drug",
            "name",
            "allergen",
            "medication",
            "generic_name",
            "content",
            "message",
            "value",
        ):
            if value.get(key):
                add(value[key])
                break
    elif value:
        add(value)
    return terms


def _normalise_med_text(med: Medication) -> tuple[str, str]:
    display = (
        getattr(med, "generic_name", None)
        or getattr(med, "name", None)
        or ""
    ).strip()
    raw_names = [
        getattr(med, "generic_name", None),
        getattr(med, "name", None),
    ]
    searchable = " ".join(str(name) for name in raw_names if name).lower()
    return display, searchable


def _allergy_matches_med(term: str, med_text: str) -> bool:
    needle = term.lower()
    for noise in ("allergic to", "allergy", "過敏", "藥物"):
        needle = needle.replace(noise, "")
    needle = needle.strip()
    # Chinese class allergies (e.g. 青黴素/磺胺) never substring-match English
    # drug names, so route any alias onto its English group keywords first.
    for alias, group in _ALLERGY_ZH_ALIASES.items():
        if alias in needle and any(
            keyword in med_text for keyword in _ALLERGY_GROUP_KEYWORDS[group]
        ):
            return True
    if len(needle) < 3:
        return False
    if needle in med_text or med_text in needle:
        return True
    for trigger, med_keywords in _ALLERGY_GROUP_KEYWORDS.items():
        if trigger in needle and any(keyword in med_text for keyword in med_keywords):
            return True
    return False


def _find_allergy_med_conflicts(
    patient: Patient, meds: List[Medication]
) -> tuple[List[str], List[str]]:
    terms = _extract_allergy_terms(getattr(patient, "allergies", None))
    conflicts: List[str] = []
    seen = set()
    for term in terms:
        for med in meds:
            display, med_text = _normalise_med_text(med)
            if not display or not med_text:
                continue
            if not _allergy_matches_med(term, med_text):
                continue
            key = (term.lower(), display.lower())
            if key in seen:
                continue
            seen.add(key)
            conflicts.append(f"{term} ↔ {display}")
    return terms, conflicts


def _warning_safety_category(warning: Dict[str, Any]) -> str:
    mechanism = str(warning.get("mechanism") or "").lower()
    if "qtc" in mechanism or "qt" in mechanism:
        return "QT/心律風險"
    if "bleeding" in mechanism or "anticoag" in mechanism or "出血" in mechanism:
        return "出血風險"
    if "nephro" in mechanism or "aki" in mechanism or "腎" in mechanism:
        return "腎毒性風險"
    if any(
        token in mechanism
        for token in (
            "cns",
            "sedat",
            "opioid",
            "benzodiazepine",
            "bzd",
            "gabapentinoid",
            "鎮靜",
            "呼吸抑制",
        )
    ):
        return "CNS/鎮靜呼吸風險"
    return "重複/其他"


def _fmt_warning_brief(warning: Dict[str, Any]) -> str:
    level = str(warning.get("level") or "?").lower()
    mechanism = str(warning.get("mechanism") or "?")
    raw_members = warning.get("members") or []
    if isinstance(raw_members, str):
        members = raw_members
    else:
        members = " + ".join(str(member) for member in raw_members if member)
    if members:
        return f"{level} - {mechanism}: {members}"
    return f"{level} - {mechanism}"


def _fmt_medication_safety_section(
    patient: Patient,
    meds: List[Medication],
    duplicate_warnings: List[Dict[str, Any]],
) -> str:
    lines = ["【用藥安全摘要】"]

    allergy_terms, allergy_conflicts = _find_allergy_med_conflicts(patient, meds)
    if not meds:
        lines.append("過敏衝突: 無活動中藥物可比對")
    elif allergy_conflicts:
        cap = 5
        shown = allergy_conflicts[:cap]
        suffix = ""
        if len(allergy_conflicts) > cap:
            suffix = f"；另有 {len(allergy_conflicts) - cap} 筆未列出"
        lines.append("過敏衝突: " + "；".join(shown) + suffix)
    elif allergy_terms:
        lines.append("過敏衝突: 未偵測到 active med 與過敏欄位明顯衝突")
    else:
        lines.append("過敏衝突: 過敏欄位無資料/未記載")

    if not duplicate_warnings:
        lines.append("自動警示: 無 critical/high/moderate")
        return "\n".join(lines)

    counts = {"critical": 0, "high": 0, "moderate": 0}
    for warning in duplicate_warnings:
        level = str(warning.get("level") or "").lower()
        if level in counts:
            counts[level] += 1
    count_parts = [
        f"{level} {count}"
        for level, count in counts.items()
        if count
    ]
    if count_parts:
        joined_counts = " / ".join(count_parts)
        lines.append(f"自動警示: 共 {len(duplicate_warnings)} 筆（{joined_counts}）")
    else:
        lines.append(f"自動警示: 共 {len(duplicate_warnings)} 筆")

    buckets: Dict[str, List[Dict[str, Any]]] = {
        label: [] for label in _SAFETY_CATEGORY_ORDER
    }
    for warning in duplicate_warnings:
        buckets[_warning_safety_category(warning)].append(warning)

    for label in _SAFETY_CATEGORY_ORDER:
        warnings = buckets[label]
        if not warnings:
            continue
        cap = 5
        shown = "；".join(_fmt_warning_brief(w) for w in warnings[:cap])
        suffix = ""
        if len(warnings) > cap:
            suffix = f"；另有 {len(warnings) - cap} 筆未列出"
        lines.append(f"{label}: {shown}{suffix}")

    return "\n".join(lines)


_NON_ICU_WARD_MARKERS = (
    "ward",
    "outpatient",
    "opd",
    "clinic",
    "emergency",
    "er",
    "病房",
    "門診",
    "急診",
    "一般病房",
    "普通病房",
)


def _infer_duplicate_context(patient: Optional[Patient]) -> str:
    """Infer DuplicateDetector context from the patient's unit/ward.

    Returns one of "icu" | "inpatient". This builder feeds the *ICU* chat
    snapshot, and HIS patients always have an empty ``unit``; defaulting an
    empty/unknown unit to "inpatient" would wrongly downgrade ICU-level
    bleeding/QT alerts. So we fail SAFE to "icu" unless the unit explicitly
    names a recognisable non-ICU ward.
    """
    if patient is None:
        return "icu"
    unit = (getattr(patient, "unit", None) or "").strip().lower()
    if "icu" in unit:
        return "icu"
    if any(marker in unit for marker in _NON_ICU_WARD_MARKERS):
        return "inpatient"
    return "icu"


async def _safe_duplicate_warnings(
    db: AsyncSession, meds: List[Medication], context: str
) -> List[Dict[str, Any]]:
    """Wrap format_duplicate_metadata with failure isolation.

    A detector crash must NOT break snapshot build — chat must stay online
    even if the duplicate-detection pipeline has a bad day. On any exception
    we log at WARNING and return an empty list, matching the contract of
    format_duplicate_metadata's own defensive fallback.
    """
    try:
        return await _pkg.format_duplicate_metadata(db, meds, context=context)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "build_clinical_snapshot: duplicate detection failed (%s); "
            "continuing without duplicate_warnings",
            exc,
        )
        return []


def _fmt_duplicate_section(warnings: List[Dict[str, Any]]) -> str:
    """Wrap format_duplicate_text output so it slots into the snapshot cleanly.

    ``format_duplicate_text`` already returns an empty string when there are
    no warnings; this helper just strips the leading newline that the prompt
    block carries and prefixes a Chinese section header consistent with the
    rest of the snapshot.
    """
    block = _pkg.format_duplicate_text(warnings)
    if not block:
        return ""
    return block.lstrip("\n")
