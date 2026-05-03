"""
patient_context_builder.py — Build structured Clinical Snapshot for ICU LLM context.

Produces a ~700-token plain-text snapshot of a patient's current status,
including lab trends, vitals, medications, ventilator settings, and reports.
Also builds delta blocks for subsequent chat turns.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python <3.9 fallback (project pins 3.12+)
    from backports.zoneinfo import ZoneInfo  # type: ignore

from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

# W3-T3: snapshot-facing timestamps run in Asia/Taipei. Internal DB columns
# stay UTC; only display strings (snapshot header, ICU-day calc, delta block)
# get converted. Keeps chronological reasoning consistent with what clinicians
# read on bedside HIS / nursing systems.
TAIPEI_TZ = ZoneInfo("Asia/Taipei")


def _now_taipei() -> datetime:
    return datetime.now(TAIPEI_TZ)

from app.models.patient import Patient
from app.models.lab_data import LabData
from app.models.medication import Medication
from app.models.medication_administration import MedicationAdministration
from app.models.vital_sign import VitalSign
from app.models.ventilator import VentilatorSetting
from app.models.diagnostic_report import DiagnosticReport
from app.models.clinical_score import ClinicalScore
from app.models.culture_result import CultureResult
from app.models.pharmacy_advice import PharmacyAdvice
from app.utils.duplicate_check import format_duplicate_metadata, format_duplicate_text
from app.services.clinical_thresholds import (
    LAB_THRESHOLDS,
    VENT_THRESHOLDS,
    VITAL_THRESHOLDS,
    flag_only,
    mark,
)

logger = logging.getLogger("chaticu")

# ── Trend thresholds ──────────────────────────────────────────────────────────
_TREND_THRESHOLD = 0.20  # 20% change → show arrow

_RENAL_RELEVANT_KEYWORDS = (
    "acyclovir", "amikacin", "amoxicillin", "ampicillin", "cefazolin",
    "cefepime", "ceftazidime", "ceftriaxone", "ciprofloxacin", "colistin",
    "dabigatran", "digoxin", "enoxaparin", "fluconazole", "gabapentin",
    "ganciclovir", "gentamicin", "imipenem", "levofloxacin", "lithium",
    "meropenem", "metformin", "morphine", "piperacillin", "pregabalin",
    "rivaroxaban", "sulfamethoxazole", "tazobactam", "tobramycin",
    "trimethoprim", "vancomycin",
)


def _format_trend(
    current: float,
    previous: Optional[float],
    unit: str = "",
    show_pct: bool = True,
) -> str:
    """Format a value with ↑↓ arrow and 24h comparison."""
    if previous is None or previous == 0:
        return f"{current}{(' ' + unit) if unit else ''}"

    pct = (current - previous) / abs(previous)
    if pct > _TREND_THRESHOLD:
        arrow = "↑"
    elif pct < -_TREND_THRESHOLD:
        arrow = "↓"
    else:
        arrow = ""

    base = f"{current}{arrow}"
    if arrow and show_pct:
        pct_str = f"{pct:+.0%}"
        base += f" (24h前{previous}, {pct_str})"
    elif arrow:
        base += f" (24h前{previous})"
    if unit:
        base += f" {unit}"
    return base


# ── DB queries ────────────────────────────────────────────────────────────────

async def _get_patient(db: AsyncSession, patient_id: str) -> Optional[Patient]:
    result = await db.execute(
        select(Patient).where(Patient.id == patient_id)
    )
    return result.scalar_one_or_none()


async def _get_latest_lab(db: AsyncSession, patient_id: str) -> Optional[LabData]:
    result = await db.execute(
        select(LabData)
        .where(LabData.patient_id == patient_id)
        .order_by(desc(LabData.timestamp))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _get_lab_before_24h(db: AsyncSession, patient_id: str, reference_ts: datetime) -> Optional[LabData]:
    """Get the most recent lab record that is at least 24h before reference_ts."""
    cutoff = reference_ts - timedelta(hours=24)
    result = await db.execute(
        select(LabData)
        .where(LabData.patient_id == patient_id, LabData.timestamp <= cutoff)
        .order_by(desc(LabData.timestamp))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _get_active_medications(db: AsyncSession, patient_id: str) -> List[Medication]:
    result = await db.execute(
        select(Medication)
        .where(
            Medication.patient_id == patient_id,
            Medication.status == "active",
        )
        .order_by(Medication.san_category.nullslast(), Medication.name)
    )
    return list(result.scalars().all())


async def _get_latest_vital(db: AsyncSession, patient_id: str) -> Optional[VitalSign]:
    result = await db.execute(
        select(VitalSign)
        .where(VitalSign.patient_id == patient_id)
        .order_by(desc(VitalSign.timestamp))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _get_latest_vent(db: AsyncSession, patient_id: str) -> Optional[VentilatorSetting]:
    result = await db.execute(
        select(VentilatorSetting)
        .where(VentilatorSetting.patient_id == patient_id)
        .order_by(desc(VentilatorSetting.timestamp))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _get_recent_reports(db: AsyncSession, patient_id: str, limit: int = 3) -> List[DiagnosticReport]:
    result = await db.execute(
        select(DiagnosticReport)
        .where(DiagnosticReport.patient_id == patient_id)
        .order_by(desc(DiagnosticReport.exam_date))
        .limit(limit)
    )
    return list(result.scalars().all())


async def _get_latest_scores(db: AsyncSession, patient_id: str) -> List[ClinicalScore]:
    """Get the most recent pain and RASS scores."""
    result = await db.execute(
        select(ClinicalScore)
        .where(ClinicalScore.patient_id == patient_id)
        .order_by(desc(ClinicalScore.timestamp))
        .limit(10)
    )
    all_scores = list(result.scalars().all())
    # Keep only most recent of each type
    seen = set()
    out = []
    for s in all_scores:
        if s.score_type not in seen:
            seen.add(s.score_type)
            out.append(s)
    return out


async def _get_latest_column_timestamp(
    db: AsyncSession,
    patient_id: str,
    model: Any,
    column: Any,
) -> Optional[datetime]:
    """Fetch MAX(column) for optional context tables.

    Snapshot construction must stay best-effort: freshness metadata is useful
    but should never break chat if a table is empty or a test stub is not a
    real AsyncSession.
    """
    if not isinstance(db, AsyncSession):
        return None
    try:
        result = await db.execute(
            select(func.max(column)).where(model.patient_id == patient_id)
        )
        value = result.scalar_one_or_none()
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug(
            "snapshot freshness timestamp fetch failed model=%s column=%s patient=%s: %s",
            getattr(model, "__tablename__", str(model)),
            getattr(column, "name", str(column)),
            patient_id,
            exc,
        )
        return None
    return value if isinstance(value, datetime) else None


async def _get_auxiliary_freshness_timestamps(
    db: AsyncSession, patient_id: str
) -> Dict[str, Optional[datetime]]:
    """Fetch freshness timestamps for tables not otherwise loaded in snapshot."""
    culture_reported = await _get_latest_column_timestamp(
        db, patient_id, CultureResult, CultureResult.reported_at
    )
    culture_collected = await _get_latest_column_timestamp(
        db, patient_id, CultureResult, CultureResult.collected_at
    )
    latest_admin = await _get_latest_column_timestamp(
        db, patient_id, MedicationAdministration, MedicationAdministration.administered_time
    )
    latest_advice = await _get_latest_column_timestamp(
        db, patient_id, PharmacyAdvice, PharmacyAdvice.updated_at
    )
    return {
        "culture_results": culture_reported or culture_collected,
        "medication_administrations": latest_admin,
        "pharmacy_advices": latest_advice,
    }


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
    ("biochemistry", "total_bilirubin"): ["TBil", "TBIL", "T-Bil", "total_bilirubin", "bilirubin"],
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


def _normalize_snapshot_dt(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(TAIPEI_TZ)


def _fmt_snapshot_dt(value: Any) -> Optional[str]:
    dt = _normalize_snapshot_dt(value)
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d %H:%M")


def _max_datetime(values: List[Any]) -> Optional[datetime]:
    normalised = [dt for value in values if (dt := _normalize_snapshot_dt(value))]
    if not normalised:
        return None
    return max(normalised)


def _fmt_status_item(
    label: str,
    timestamp: Optional[datetime],
    *,
    present: bool = False,
    deferred: bool = False,
) -> str:
    if deferred:
        return f"{label}: 延後載入"
    if timestamp:
        return f"{label}: {_fmt_snapshot_dt(timestamp)}"
    if present:
        return f"{label}: 有資料(時間不明)"
    return f"{label}: 無資料"


def _fmt_data_freshness_section(
    patient: Patient,
    lab: Optional[LabData],
    meds: List[Medication],
    vitals: Optional[VitalSign],
    vent: Optional[VentilatorSetting],
    reports: List[DiagnosticReport],
    scores: List[ClinicalScore],
    extra_timestamps: Optional[Dict[str, Optional[datetime]]] = None,
    deferred_sections: Optional[set[str]] = None,
) -> str:
    """Format data recency and missing-section hints for the LLM snapshot."""
    extra_timestamps = extra_timestamps or {}
    deferred_sections = deferred_sections or set()
    snapshot_time = _now_taipei().strftime("%Y-%m-%d %H:%M")

    patient_ts = _max_datetime([
        getattr(patient, "updated_at", None),
        getattr(patient, "last_update", None),
        getattr(patient, "created_at", None),
    ])
    med_ts = _max_datetime([
        getattr(m, "updated_at", None) or getattr(m, "created_at", None)
        for m in meds
    ])
    report_ts = _max_datetime([getattr(r, "exam_date", None) for r in reports])
    score_ts = _max_datetime([getattr(s, "timestamp", None) for s in scores])

    statuses = [
        _fmt_status_item("病患主檔", patient_ts, present=True),
        _fmt_status_item("檢驗", getattr(lab, "timestamp", None), present=lab is not None),
        _fmt_status_item(
            "生命徵象",
            getattr(vitals, "timestamp", None),
            present=vitals is not None,
        ),
        _fmt_status_item(
            "呼吸器",
            getattr(vent, "timestamp", None),
            present=vent is not None,
            deferred="ventilator_settings" in deferred_sections,
        ),
        _fmt_status_item("用藥", med_ts, present=bool(meds)),
        _fmt_status_item(
            "MAR",
            extra_timestamps.get("medication_administrations"),
        ),
        _fmt_status_item(
            "影像/報告",
            report_ts,
            present=bool(reports),
            deferred="diagnostic_reports" in deferred_sections,
        ),
        _fmt_status_item(
            "培養",
            extra_timestamps.get("culture_results"),
        ),
        _fmt_status_item(
            "臨床評分",
            score_ts,
            present=bool(scores),
            deferred="clinical_scores" in deferred_sections,
        ),
        _fmt_status_item(
            "藥師建議",
            extra_timestamps.get("pharmacy_advices"),
        ),
    ]

    missing = []
    if lab is None:
        missing.append("無近期檢驗")
    if vitals is None:
        missing.append("無生命徵象")
    if "ventilator_settings" not in deferred_sections and vent is None:
        if getattr(patient, "intubated", False):
            missing.append("插管中但無呼吸器資料")
        else:
            missing.append("無呼吸器資料")
    if not extra_timestamps.get("medication_administrations"):
        missing.append("無 MAR/實際給藥資料")
    if not extra_timestamps.get("culture_results"):
        missing.append("無微生物培養資料")

    lines = [
        "【資料狀態】",
        f"快照時間: {snapshot_time}（台北）",
        " | ".join(statuses[:5]),
        " | ".join(statuses[5:]),
    ]
    if missing:
        lines.append("缺口: " + " / ".join(missing))
    return "\n".join(lines)


def _positive_float(value: Any) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out <= 0:
        return None
    return out


def _fmt_num(value: float) -> str:
    if abs(value - round(value)) < 0.05:
        return str(int(round(value)))
    return f"{value:.1f}".rstrip("0").rstrip(".")


def _estimate_crcl(
    patient: Patient,
    lab: Optional[LabData],
    vital: Optional[VitalSign],
) -> tuple[Optional[float], str]:
    scr = _get_lab_val(lab, "biochemistry", "creatinine")
    age = _positive_float(getattr(patient, "age", None))
    weight = _positive_float(getattr(patient, "weight", None))
    weight_source = "病患主檔"
    if weight is None:
        weight = _positive_float(getattr(vital, "body_weight", None))
        weight_source = "生命徵象"

    missing = []
    if scr is None or scr <= 0:
        missing.append("Scr")
    if age is None:
        missing.append("年齡")
    if weight is None:
        missing.append("體重")
    if missing:
        return None, "缺 " + "、".join(missing)

    crcl = ((140 - age) * weight) / (72 * scr)
    gender = str(getattr(patient, "gender", "") or "").strip().lower()
    if gender in {"f", "female", "女"}:
        crcl *= 0.85
    return crcl, f"使用{weight_source}體重 {_fmt_num(weight)} kg"


def _renal_relevant_med_names(meds: List[Medication]) -> List[str]:
    names: List[str] = []
    seen = set()
    for med in meds:
        display = (getattr(med, "generic_name", None) or getattr(med, "name", None) or "").strip()
        if not display:
            continue
        lower = display.lower()
        kidney_flag = getattr(med, "kidney_relevant", False) is True
        keyword_hit = any(keyword in lower for keyword in _RENAL_RELEVANT_KEYWORDS)
        if not (kidney_flag or keyword_hit):
            continue
        key = lower
        if key in seen:
            continue
        seen.add(key)
        names.append(display)
    return names[:10]


def _fmt_renal_dosing_section(
    patient: Patient,
    lab: Optional[LabData],
    meds: List[Medication],
    vital: Optional[VitalSign],
) -> str:
    cr = _get_lab_val(lab, "biochemistry", "creatinine")
    bun = _get_lab_val(lab, "biochemistry", "bun")
    egfr = _get_lab_val(lab, "biochemistry", "egfr")

    renal_values = []
    if cr is not None:
        renal_values.append(f"Scr {_fmt_num(cr)} mg/dL")
    if egfr is not None:
        renal_values.append(f"eGFR {_fmt_num(egfr)}")
    if bun is not None:
        renal_values.append(f"BUN {_fmt_num(bun)}")

    lines = ["【腎功能/給藥摘要】"]
    if renal_values:
        lines.append("腎功能: " + " | ".join(renal_values))
    else:
        lines.append("腎功能: 無近期 Scr/eGFR/BUN")

    crcl, reason = _estimate_crcl(patient, lab, vital)
    if crcl is None:
        lines.append(f"CrCl: 無法計算（{reason}）")
    else:
        lines.append(f"CrCl 約 {_fmt_num(crcl)} mL/min（Cockcroft-Gault，{reason}）")

    renal_meds = _renal_relevant_med_names(meds)
    if renal_meds:
        lines.append("需注意腎調整藥: " + ", ".join(renal_meds))
    return "\n".join(lines)


# ── Section formatters ────────────────────────────────────────────────────────

def _fmt_patient_section(p: Patient) -> str:
    # W3-T3: ICU-day uses Taipei date, otherwise admissions near midnight
    # Taipei would shift by one day (UTC midnight = Taipei 08:00).
    now = _now_taipei()
    icu_days = ""
    vent_days = ""
    if p.icu_admission_date:
        delta = (now.date() - p.icu_admission_date) if hasattr(p.icu_admission_date, 'date') else None
        if delta is None and hasattr(p.icu_admission_date, 'days'):
            icu_days = f"入ICU第{(now.date() - p.icu_admission_date).days + 1}天"
        elif p.icu_admission_date:
            try:
                from datetime import date as _date
                icu_dt = p.icu_admission_date if isinstance(p.icu_admission_date, _date) else p.icu_admission_date.date()
                icu_days = f"入ICU第{(now.date() - icu_dt).days + 1}天"
            except Exception:
                pass
    if p.ventilator_days:
        vent_days = f"｜呼吸器第{p.ventilator_days}天"

    intubated_str = "插管中" if p.intubated else "未插管"
    dnr_str = "是" if p.has_dnr else "否"

    allergies = ""
    if p.allergies:
        if isinstance(p.allergies, list):
            allergies = "、".join(
                a.get("drug", str(a)) for a in p.allergies if a
            )
        else:
            allergies = str(p.allergies)

    alerts = ""
    if p.alerts:
        if isinstance(p.alerts, list):
            alert_strs = [
                a.get("message", str(a)) if isinstance(a, dict) else str(a)
                for a in p.alerts if a
            ]
            alerts = " | ".join(f"⚠️ {s}" for s in alert_strs[:4])
        else:
            alerts = f"⚠️ {p.alerts}"

    lines = [
        "【患者基本】",
        f"姓名: {p.name or '不詳'} | 年齡: {p.age or '不詳'}歲 | 性別: {p.gender or '不詳'} | 床號: {p.bed_number or '不詳'}",
        f"診斷: {p.diagnosis or '不詳'}",
        f"{icu_days}{vent_days} | {intubated_str} | DNR: {dnr_str}",
    ]
    if allergies:
        lines.append(f"過敏: {allergies}")
    if alerts:
        lines.append(f"警示: {alerts}")
    return "\n".join(lines)


def _fmt_vital_section(v: Optional[VitalSign]) -> str:
    if not v:
        return "【生命徵象】無資料"
    ts_str = ""
    if v.timestamp:
        try:
            ts_str = f" {v.timestamp.strftime('%Y-%m-%d %H:%M')}"
        except Exception:
            pass

    rr = mark(v.respiratory_rate, VITAL_THRESHOLDS["RR"])
    hr = mark(v.heart_rate, VITAL_THRESHOLDS["HR"])
    temp = mark(v.temperature, VITAL_THRESHOLDS["Temp"])
    sbp = v.systolic_bp or "—"
    dbp = v.diastolic_bp or "—"
    map_val = mark(v.mean_bp, VITAL_THRESHOLDS["MAP"])
    spo2 = mark(v.spo2, VITAL_THRESHOLDS["SpO2"])

    lines = [f"【生命徵象】{ts_str}"]
    lines.append(f"體溫 {temp}°C | HR {hr} bpm | RR {rr}/min")
    lines.append(f"BP {sbp}/{dbp} mmHg (MAP {map_val}) | SpO₂ {spo2}%")
    if v.cvp is not None:
        lines[-1] += f" | CVP {mark(v.cvp, VITAL_THRESHOLDS['CVP'])} mmHg"
    return "\n".join(lines)


def _fmt_vent_section(vent: Optional[VentilatorSetting]) -> str:
    if not vent:
        return ""
    parts = []
    if vent.mode:
        parts.append(vent.mode)
    if vent.fio2 is not None:
        parts.append(f"FiO₂ {vent.fio2}%{flag_only(vent.fio2, VENT_THRESHOLDS['FiO2'])}")
    if vent.peep is not None:
        parts.append(f"PEEP {vent.peep}{flag_only(vent.peep, VENT_THRESHOLDS['PEEP'])}")
    if vent.tidal_volume is not None:
        parts.append(f"Vt {vent.tidal_volume}mL")
    if vent.pip is not None:
        parts.append(f"PIP {vent.pip}{flag_only(vent.pip, VENT_THRESHOLDS['PIP'])}")
    if vent.compliance is not None:
        parts.append(f"Compliance {vent.compliance}{flag_only(vent.compliance, VENT_THRESHOLDS['Compliance'])}")
    if not parts:
        return ""
    return "【呼吸器】\n" + " | ".join(parts)


def _fmt_lab_section(
    lab: Optional[LabData],
    prev_lab: Optional[LabData],
) -> str:
    if not lab:
        return "【關鍵檢驗】無資料"

    ts_str = ""
    if lab.timestamp:
        try:
            ts_str = f" {lab.timestamp.strftime('%Y-%m-%d %H:%M')}"
        except Exception:
            pass

    def v(cat: str, key: str) -> Optional[float]:
        return _get_lab_val(lab, cat, key)

    def pv(cat: str, key: str) -> Optional[float]:
        return _get_lab_val(prev_lab, cat, key)

    lines = [f"【關鍵檢驗】{ts_str}（標 * 者含24h趨勢）"]

    # Renal
    cr = v("biochemistry", "creatinine")
    bun = v("biochemistry", "bun")
    egfr = v("biochemistry", "egfr")
    parts = []
    if cr is not None:
        parts.append(f"Cr {_format_trend(cr, pv('biochemistry', 'creatinine'))}*")
    if bun is not None:
        parts.append(f"BUN {bun}{flag_only(bun, LAB_THRESHOLDS['BUN'])}")
    if egfr is not None:
        parts.append(f"eGFR {egfr}{flag_only(egfr, LAB_THRESHOLDS['eGFR'])}")
    if parts:
        lines.append("腎功能: " + " | ".join(parts))

    # Electrolytes
    k = v("biochemistry", "potassium")
    na = v("biochemistry", "sodium")
    cl = v("biochemistry", "chloride")
    parts = []
    if k is not None:
        parts.append(f"K⁺ {k}{flag_only(k, LAB_THRESHOLDS['K'])}")
    if na is not None:
        parts.append(f"Na⁺ {na}{flag_only(na, LAB_THRESHOLDS['Na'])}")
    if cl is not None:
        parts.append(f"Cl⁻ {cl}")
    if parts:
        lines.append("電解質: " + " | ".join(parts))

    # Liver
    ast = v("biochemistry", "ast")
    alt = v("biochemistry", "alt")
    tbil = v("biochemistry", "total_bilirubin")
    alb = v("biochemistry", "albumin")
    parts = []
    if ast is not None:
        parts.append(f"AST {ast}{flag_only(ast, LAB_THRESHOLDS['AST'])}")
    if alt is not None:
        parts.append(f"ALT {alt}{flag_only(alt, LAB_THRESHOLDS['ALT'])}")
    if tbil is not None:
        parts.append(f"T-Bil {tbil}{flag_only(tbil, LAB_THRESHOLDS['T-Bil'])}")
    if alb is not None:
        parts.append(f"Albumin {alb}{flag_only(alb, LAB_THRESHOLDS['Albumin'])}")
    if parts:
        lines.append("肝功能: " + " | ".join(parts))

    # Hematology
    wbc = v("hematology", "wbc")
    hb = v("hematology", "hemoglobin")
    plt = v("hematology", "platelet")
    parts = []
    if wbc is not None:
        parts.append(f"WBC {_format_trend(wbc, pv('hematology', 'wbc'))}*")
    if hb is not None:
        parts.append(f"Hb {hb}{flag_only(hb, LAB_THRESHOLDS['Hb'])}")
    if plt is not None:
        parts.append(f"PLT {plt}{flag_only(plt, LAB_THRESHOLDS['PLT'])}")
    if parts:
        lines.append("血液: " + " | ".join(parts))

    # Coagulation
    inr = v("coagulation", "inr")
    aptt = v("coagulation", "aptt")
    ddimer = v("coagulation", "d_dimer")
    parts = []
    if inr is not None:
        parts.append(f"INR {inr}{flag_only(inr, LAB_THRESHOLDS['INR'])}")
    if aptt is not None:
        parts.append(f"aPTT {aptt}s{flag_only(aptt, LAB_THRESHOLDS['aPTT'])}")
    if ddimer is not None:
        parts.append(f"D-Dimer {ddimer}{flag_only(ddimer, LAB_THRESHOLDS['D-Dimer'])}")
    if parts:
        lines.append("凝血: " + " | ".join(parts))

    # Inflammatory
    crp = v("inflammatory", "crp")
    pct = v("inflammatory", "pct")
    parts = []
    if crp is not None:
        parts.append(f"CRP {_format_trend(crp, pv('inflammatory', 'crp'))}*")
    if pct is not None:
        parts.append(f"PCT {pct}{flag_only(pct, LAB_THRESHOLDS['PCT'])}")
    if parts:
        lines.append("發炎: " + " | ".join(parts))

    # Blood gas
    ph = v("blood_gas", "ph")
    pco2 = v("blood_gas", "pco2")
    po2 = v("blood_gas", "po2")
    hco3 = v("blood_gas", "hco3")
    lac = v("blood_gas", "lactate")
    parts = []
    if ph is not None:
        parts.append(f"pH {ph}{flag_only(ph, LAB_THRESHOLDS['pH'])}")
    if pco2 is not None:
        parts.append(f"pCO₂ {pco2}")
    if po2 is not None:
        parts.append(f"pO₂ {po2}{flag_only(po2, LAB_THRESHOLDS['pO2'])}")
    if hco3 is not None:
        parts.append(f"HCO₃ {hco3}{flag_only(hco3, LAB_THRESHOLDS['HCO3'])}")
    if lac is not None:
        parts.append(f"Lac {_format_trend(lac, pv('blood_gas', 'lactate'))}*")
    if parts:
        lines.append("血氣: " + " | ".join(parts))

    return "\n".join(lines)


def _fmt_med_section(meds: List[Medication]) -> str:
    if not meds:
        return "【用藥】無活動中藥物"

    groups: Dict[str, List[str]] = {
        "鎮靜(S)": [],
        "止痛(A)": [],
        "神肌(N)": [],
        "升壓劑": [],
        "抗感染": [],
        "外院/自備": [],
        "其他": [],
    }

    VASOPRESSOR_NAMES = {
        "norepinephrine", "noradrenaline", "dopamine", "epinephrine",
        "adrenaline", "vasopressin", "phenylephrine", "dobutamine",
    }
    ANTIINFECTIVE_NAMES = {
        "meropenem", "imipenem", "ertapenem", "vancomycin", "linezolid",
        "ceftriaxone", "cefepime", "piperacillin", "tazobactam",
        "azithromycin", "fluconazole", "caspofungin", "micafungin",
        "amphotericin", "acyclovir", "ganciclovir", "metronidazole",
        "ciprofloxacin", "levofloxacin", "colistin", "polymyxin",
    }

    for m in meds:
        name = m.generic_name or m.name or "unknown"
        dose_str = ""
        if m.dose:
            dose_str = f" {m.dose}"
            if m.unit:
                dose_str += m.unit
        if m.frequency:
            dose_str += f" {m.frequency}"
        if m.route:
            dose_str += f" {m.route}"
        entry = f"{name}{dose_str}"

        # External/self-supplied
        if m.is_external or m.source_type in ("outpatient", "self-supplied", "self_supplied"):
            label = "⚠️外院/自備"
            groups["外院/自備"].append(f"{label}: {entry}")
            continue

        name_lower = name.lower()
        san = m.san_category or ""

        if san == "S":
            groups["鎮靜(S)"].append(entry)
        elif san == "A":
            groups["止痛(A)"].append(entry)
        elif san == "N":
            groups["神肌(N)"].append(entry)
        elif any(vp in name_lower for vp in VASOPRESSOR_NAMES):
            groups["升壓劑"].append(entry)
        elif any(ab in name_lower for ab in ANTIINFECTIVE_NAMES):
            groups["抗感染"].append(entry)
        else:
            groups["其他"].append(entry)

    lines = ["【用藥】"]
    for label, items in groups.items():
        if items:
            lines.append(f"{label}: " + " | ".join(items))
    return "\n".join(lines)


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


def _fmt_reports_section(reports: List[DiagnosticReport]) -> str:
    if not reports:
        return ""
    lines = ["【影像/報告 最近3筆】"]
    for r in reports:
        date_str = ""
        if r.exam_date:
            try:
                date_str = r.exam_date.strftime("%Y-%m-%d") if hasattr(r.exam_date, 'strftime') else str(r.exam_date)[:10]
            except Exception:
                date_str = str(r.exam_date)[:10]
        name = r.exam_name or r.report_type or "報告"
        impression = (r.impression or "").strip()
        if not impression:
            impression = (r.body_text or "").strip()[:100]
        lines.append(f"{date_str} {name}: {impression}")
    return "\n".join(lines)


def _infer_duplicate_context(patient: Optional[Patient]) -> str:
    """Infer DuplicateDetector context from the patient's unit/ward.

    Returns one of "icu" | "inpatient"; falls back to "inpatient" when the
    unit is unknown. Outpatient/discharge are not reachable from the chat
    snapshot (those flows have their own builders).
    """
    if patient is None:
        return "inpatient"
    unit = (getattr(patient, "unit", None) or "").strip().lower()
    if "icu" in unit:
        return "icu"
    return "inpatient"


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
        return await format_duplicate_metadata(db, meds, context=context)
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
    block = format_duplicate_text(warnings)
    if not block:
        return ""
    return block.lstrip("\n")


def _fmt_scores_section(scores: List[ClinicalScore]) -> str:
    parts = []
    score_map = {s.score_type: s.value for s in scores}
    if "pain" in score_map:
        parts.append(f"Pain {score_map['pain']}/10")
    if "rass" in score_map:
        parts.append(f"RASS {score_map['rass']}")
    if not parts:
        return ""
    return "【臨床評分】\n" + " | ".join(parts)


# ── Public API ────────────────────────────────────────────────────────────────

async def build_clinical_snapshot(patient_id: str, db: AsyncSession) -> str:
    """
    Query all relevant patient data in parallel and return a Clinical Snapshot string.
    This is used as the first-turn system prompt context (~700 tokens).
    """
    # AsyncSession lazily acquires its underlying connection on the first
    # query. Without warm-up the asyncio.gather below races on connection
    # provisioning and crashes with "This session is provisioning a new
    # connection; concurrent operations are not permitted". Production has
    # been working only because the /ai/chat/stream router happens to call
    # _get_or_create_session() before this function — that prior SELECT
    # acquires the connection implicitly. Don't rely on caller order; warm
    # up explicitly. See docs/b15-snapshot-latency-plan-2026-04-30.md §1
    # and the audit in scripts/b15_snapshot_audit.py for the fragile-contract
    # discovery.
    await db.connection()

    patient, latest_lab, meds, vitals, vent, reports, scores = await asyncio.gather(
        _get_patient(db, patient_id),
        _get_latest_lab(db, patient_id),
        _get_active_medications(db, patient_id),
        _get_latest_vital(db, patient_id),
        _get_latest_vent(db, patient_id),
        _get_recent_reports(db, patient_id, limit=3),
        _get_latest_scores(db, patient_id),
    )

    if not patient:
        return f"[無法取得患者資料 patient_id={patient_id}]"

    # Get previous lab for trends (24h before latest)
    prev_lab = None
    if latest_lab and latest_lab.timestamp:
        prev_lab = await _get_lab_before_24h(db, patient_id, latest_lab.timestamp)

    extra_timestamps = await _get_auxiliary_freshness_timestamps(db, patient_id)
    duplicate_warnings = await _safe_duplicate_warnings(
        db, meds, context=_infer_duplicate_context(patient)
    )
    now_str = _now_taipei().strftime("%Y-%m-%d %H:%M")

    sections = [
        f"=== ICU 病患臨床快照 ===",
        f"時間戳記：{now_str}（台北時間）",
        "",
        _fmt_data_freshness_section(
            patient, latest_lab, meds, vitals, vent, reports, scores, extra_timestamps
        ),
        "",
        _fmt_patient_section(patient),
        "",
        _fmt_vital_section(vitals),
        "",
    ]

    vent_section = _fmt_vent_section(vent)
    if vent_section:
        sections += [vent_section, ""]

    sections += [
        _fmt_lab_section(latest_lab, prev_lab),
        "",
        _fmt_renal_dosing_section(patient, latest_lab, meds, vitals),
        "",
        _fmt_med_section(meds),
        "",
        _fmt_medication_safety_section(patient, meds, duplicate_warnings),
    ]

    duplicate_section = _fmt_duplicate_section(duplicate_warnings)
    if duplicate_section:
        sections += ["", duplicate_section]

    reports_section = _fmt_reports_section(reports)
    if reports_section:
        sections += ["", reports_section]

    scores_section = _fmt_scores_section(scores)
    if scores_section:
        sections += ["", scores_section]

    sections.append("\n=== 快照結束 ===")

    return "\n".join(sections)


async def build_critical_snapshot(
    patient_id: str, db: AsyncSession
) -> tuple[str, Dict[str, Any], Dict[str, Any]]:
    """B15-A1 critical-only path. Returns first-turn snapshot text + delta
    key values + metadata for the deferred follow-up.

    Includes (must be ready before LLM streams):
      patient, latest_lab + 24h-prior lab (for trend), active_medications,
      latest_vital, duplicate_warnings.

    Excludes — fetched separately by build_deferred_snapshot in a background
    task after the first response yields:
      latest_vent, recent_reports, latest_scores.

    Per docs/b15-snapshot-latency-plan-2026-04-30.md §3.1+§4.1:
    - duplicate stays in critical (medication safety)
    - lab_before_24h stays in critical (small ~600ms, trend matters clinically)
    - vent: even when not intubated _fmt_vent_section returns empty, so deferring
      it never visibly hurts; when intubated the deferred fill catches up by
      turn 2

    Returns:
      (snapshot_text, key_values_for_delta, deferred_meta_dict)
    """
    # B15-B (multi-connection true parallel): each fetcher uses its own
    # AsyncSession so asyncio.gather actually runs them concurrently. With
    # the original shared-session approach the connection serialized 6
    # SELECTs and we measured ~30-40% parallel efficiency (build_ms ~5s
    # vs sum 17s). Spawning fresh sessions lets the Supabase pooler
    # fan out to multiple backend connections, max parallel limited by
    # the slowest fetcher (~vital ~2.4s) instead of the sum.
    #
    # W3-T1 (pool relief): first wave keeps 4 fresh connections so the
    # critical-path SELECTs run truly in parallel (~2.4s wall vs ~5s
    # serial). Second wave (lab_before_24h + duplicate_warnings) is
    # serialized onto the request's `db` connection — both are fast
    # (~600ms / in-process) and serializing them drops the per-request
    # connection ceiling from 6 → 4. With Supabase pool 5 + overflow 5,
    # safe concurrent first-turn chats rise from ~2 to ~3 per replica.
    from app.database import async_session as _async_session

    async def _fresh(fn, *args):
        async with _async_session() as s:
            return await fn(s, *args)

    patient, latest_lab, meds, vitals = await asyncio.gather(
        _fresh(_get_patient, patient_id),
        _fresh(_get_latest_lab, patient_id),
        _fresh(_get_active_medications, patient_id),
        _fresh(_get_latest_vital, patient_id),
    )

    if not patient:
        return f"[無法取得患者資料 patient_id={patient_id}]", {}, {}

    # Post-gather: serialize on the request's db connection (no extra pool
    # slot). lab_before_24h needs latest_lab.timestamp, so it would have to
    # wait anyway; running duplicate_warnings right after costs the same
    # wall time as the previous parallel pair (both are sub-second) but
    # uses 0 extra connections.
    await db.connection()  # warm up before reuse
    if latest_lab and latest_lab.timestamp:
        prev_lab = await _get_lab_before_24h(db, patient_id, latest_lab.timestamp)
    else:
        prev_lab = None
    extra_timestamps = await _get_auxiliary_freshness_timestamps(db, patient_id)
    duplicate_warnings = await _safe_duplicate_warnings(
        db, meds, _infer_duplicate_context(patient)
    )

    now_str = _now_taipei().strftime("%Y-%m-%d %H:%M")

    sections = [
        "=== ICU 病患臨床快照 ===",
        f"時間戳記：{now_str}（台北時間）",
        "",
        _fmt_data_freshness_section(
            patient,
            latest_lab,
            meds,
            vitals,
            None,
            [],
            [],
            extra_timestamps,
            deferred_sections={
                *({"ventilator_settings"} if getattr(patient, "intubated", False) else set()),
                "diagnostic_reports",
                "clinical_scores",
            },
        ),
        "",
        _fmt_patient_section(patient),
        "",
        _fmt_vital_section(vitals),
        "",
        _fmt_lab_section(latest_lab, prev_lab),
        "",
        _fmt_renal_dosing_section(patient, latest_lab, meds, vitals),
        "",
        _fmt_med_section(meds),
        "",
        _fmt_medication_safety_section(patient, meds, duplicate_warnings),
    ]

    duplicate_section = _fmt_duplicate_section(duplicate_warnings)
    if duplicate_section:
        sections += ["", duplicate_section]

    sections.append("\n=== 快照結束 ===")

    key_values = extract_snapshot_key_values(latest_lab, meds)
    deferred_meta = {"intubated": bool(patient.intubated)}
    return "\n".join(sections), key_values, deferred_meta


async def build_deferred_snapshot(
    patient_id: str, db: AsyncSession, *, intubated: bool
) -> str:
    """B15-A1 deferred-only path. Fetched in background after first-turn
    LLM stream completes; result is appended to the critical snapshot for
    subsequent turns (separated by blank line).

    Includes:
      latest_vent (only when intubated; otherwise the section text is empty
        anyway so we save an RTT),
      recent_reports,
      latest_scores.

    Returns the formatted deferred section text. Empty string if all three
    sections are empty (nothing to append).
    """
    await db.connection()

    if intubated:
        vent, reports, scores = await asyncio.gather(
            _get_latest_vent(db, patient_id),
            _get_recent_reports(db, patient_id, limit=3),
            _get_latest_scores(db, patient_id),
        )
    else:
        reports, scores = await asyncio.gather(
            _get_recent_reports(db, patient_id, limit=3),
            _get_latest_scores(db, patient_id),
        )
        vent = None

    parts = []
    vent_section = _fmt_vent_section(vent) if vent else ""
    if vent_section:
        parts.append(vent_section)
    reports_section = _fmt_reports_section(reports)
    if reports_section:
        parts.append(reports_section)
    scores_section = _fmt_scores_section(scores)
    if scores_section:
        parts.append(scores_section)

    return "\n\n".join(parts)


def extract_snapshot_key_values(
    lab: Optional[LabData],
    meds: List[Medication],
) -> Dict[str, Any]:
    """
    Extract the key numeric values used for delta comparison.
    Stored in ai_sessions.snapshot_metadata JSONB.
    """
    return {
        "cr": _get_lab_val(lab, "biochemistry", "creatinine"),
        "wbc": _get_lab_val(lab, "hematology", "wbc"),
        "crp": _get_lab_val(lab, "inflammatory", "crp"),
        "lactate": _get_lab_val(lab, "blood_gas", "lactate"),
        "plt": _get_lab_val(lab, "hematology", "platelet"),
        "vasopressor_ne_dose": _vasopressor_ne_dose(meds),
    }


async def build_delta(
    patient_id: str,
    db: AsyncSession,
    snapshot_key_values: Dict[str, Any],
    snapshot_taken_at: Optional[str] = None,
) -> Optional[str]:
    """
    Compare current key values against stored snapshot values.
    Returns a delta string if significant changes detected; None otherwise.
    Only fires if snapshot is > 30 minutes old.
    """
    if snapshot_taken_at:
        try:
            taken_at = datetime.fromisoformat(snapshot_taken_at.replace("Z", "+00:00"))
            age_minutes = (datetime.now(timezone.utc) - taken_at).total_seconds() / 60
            if age_minutes < 30:
                return None
        except Exception:
            pass

    lab, meds = await asyncio.gather(
        _get_latest_lab(db, patient_id),
        _get_active_medications(db, patient_id),
    )

    current = extract_snapshot_key_values(lab, meds)
    changes = []

    field_labels = {
        "cr": ("Cr", ""),
        "wbc": ("WBC", ""),
        "crp": ("CRP", ""),
        "lactate": ("Lac", ""),
        "plt": ("PLT", ""),
        "vasopressor_ne_dose": ("NE", "mcg/kg/min"),
    }

    for key, (label, unit) in field_labels.items():
        old_val = snapshot_key_values.get(key)
        new_val = current.get(key)
        if new_val is None or old_val is None:
            continue
        try:
            old_f, new_f = float(old_val), float(new_val)
        except (TypeError, ValueError):
            continue
        if old_f == 0:
            continue
        pct = (new_f - old_f) / abs(old_f)
        if abs(pct) >= _TREND_THRESHOLD:
            arrow = "↑" if pct > 0 else "↓"
            unit_str = f" {unit}" if unit else ""
            changes.append(f"{label} {new_f}{arrow}（快照時{old_f}）{unit_str}")

    if not changes:
        return None

    now_str = _now_taipei().strftime("%H:%M")
    delta_lines = [f"[資料更新 {now_str}（台北）]"]
    delta_lines.append(" | ".join(changes))
    delta_lines.append("---")
    return "\n".join(delta_lines)
