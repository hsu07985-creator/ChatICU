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

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient import Patient
from app.models.lab_data import LabData
from app.models.medication import Medication
from app.models.vital_sign import VitalSign
from app.models.ventilator import VentilatorSetting
from app.models.diagnostic_report import DiagnosticReport
from app.models.clinical_score import ClinicalScore

logger = logging.getLogger("chaticu")

# ── Trend thresholds ──────────────────────────────────────────────────────────
_TREND_THRESHOLD = 0.20  # 20% change → show arrow


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


# ── Value extractors ─────────────────────────────────────────────────────────

def _get_lab_val(lab: Optional[LabData], category: str, key: str) -> Optional[float]:
    """Safely extract a numeric value from a lab JSONB category."""
    if not lab:
        return None
    data: Optional[dict] = getattr(lab, category, None)
    if not isinstance(data, dict):
        return None
    raw = data.get(key)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _vasopressor_ne_dose(meds: List[Medication]) -> Optional[float]:
    """Extract current NE (norepinephrine) dose in mcg/kg/min."""
    NE_NAMES = {"norepinephrine", "noradrenaline", "ne", "levophed"}
    for m in meds:
        name_lower = (m.generic_name or m.name or "").lower()
        if any(n in name_lower for n in NE_NAMES):
            try:
                return float(m.dose)
            except (TypeError, ValueError):
                pass
    return None


# ── Section formatters ────────────────────────────────────────────────────────

def _fmt_patient_section(p: Patient) -> str:
    now = datetime.now(timezone.utc)
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

    def _mark(val: Optional[float], low: Optional[float], high: Optional[float]) -> str:
        if val is None:
            return "—"
        if high is not None and val > high:
            return f"{val}↑"
        if low is not None and val < low:
            return f"{val}↓"
        return str(val)

    rr = _mark(v.respiratory_rate, None, 20)
    hr = _mark(v.heart_rate, 60, 100)
    temp = _mark(v.temperature, 36.0, 37.5)
    sbp = v.systolic_bp or "—"
    dbp = v.diastolic_bp or "—"
    map_val = _mark(v.mean_bp, 65, None)
    spo2 = _mark(v.spo2, 92, None)

    lines = [f"【生命徵象】{ts_str}"]
    lines.append(f"體溫 {temp}°C | HR {hr} bpm | RR {rr}/min")
    lines.append(f"BP {sbp}/{dbp} mmHg (MAP {map_val}) | SpO₂ {spo2}%")
    if v.cvp is not None:
        lines[-1] += f" | CVP {_mark(v.cvp, None, 12)} mmHg"
    return "\n".join(lines)


def _fmt_vent_section(vent: Optional[VentilatorSetting]) -> str:
    if not vent:
        return ""
    parts = []
    if vent.mode:
        parts.append(vent.mode)
    if vent.fio2 is not None:
        flag = "↑" if vent.fio2 > 50 else ""
        parts.append(f"FiO₂ {vent.fio2}%{flag}")
    if vent.peep is not None:
        flag = "↑" if vent.peep > 8 else ""
        parts.append(f"PEEP {vent.peep}{flag}")
    if vent.tidal_volume is not None:
        parts.append(f"Vt {vent.tidal_volume}mL")
    if vent.pip is not None:
        flag = "↑" if vent.pip > 35 else ""
        parts.append(f"PIP {vent.pip}{flag}")
    if vent.compliance is not None:
        flag = "↓" if vent.compliance < 40 else ""
        parts.append(f"Compliance {vent.compliance}{flag}")
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
        flag = "↑" if bun > 20 else ""
        parts.append(f"BUN {bun}{flag}")
    if egfr is not None:
        flag = "↓" if egfr < 60 else ""
        parts.append(f"eGFR {egfr}{flag}")
    if parts:
        lines.append("腎功能: " + " | ".join(parts))

    # Electrolytes
    k = v("biochemistry", "potassium")
    na = v("biochemistry", "sodium")
    cl = v("biochemistry", "chloride")
    parts = []
    if k is not None:
        flag = "↑" if k > 5.0 else ("↓" if k < 3.5 else "")
        parts.append(f"K⁺ {k}{flag}")
    if na is not None:
        flag = "↑" if na > 145 else ("↓" if na < 135 else "")
        parts.append(f"Na⁺ {na}{flag}")
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
        parts.append(f"AST {ast}{'↑' if ast > 40 else ''}")
    if alt is not None:
        parts.append(f"ALT {alt}{'↑' if alt > 40 else ''}")
    if tbil is not None:
        parts.append(f"T-Bil {tbil}{'↑' if tbil > 1.2 else ''}")
    if alb is not None:
        parts.append(f"Albumin {alb}{'↓' if alb < 3.5 else ''}")
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
        flag = "↓" if hb < 8 else ""
        parts.append(f"Hb {hb}{flag}")
    if plt is not None:
        flag = "↓" if plt < 100 else ""
        parts.append(f"PLT {plt}{flag}")
    if parts:
        lines.append("血液: " + " | ".join(parts))

    # Coagulation
    inr = v("coagulation", "inr")
    aptt = v("coagulation", "aptt")
    ddimer = v("coagulation", "d_dimer")
    parts = []
    if inr is not None:
        parts.append(f"INR {inr}{'↑' if inr > 1.2 else ''}")
    if aptt is not None:
        parts.append(f"aPTT {aptt}s{'↑' if aptt > 35 else ''}")
    if ddimer is not None:
        parts.append(f"D-Dimer {ddimer}{'↑' if ddimer > 0.5 else ''}")
    if parts:
        lines.append("凝血: " + " | ".join(parts))

    # Inflammatory
    crp = v("inflammatory", "crp")
    pct = v("inflammatory", "pct")
    parts = []
    if crp is not None:
        parts.append(f"CRP {_format_trend(crp, pv('inflammatory', 'crp'))}*")
    if pct is not None:
        parts.append(f"PCT {pct}{'↑' if pct > 0.5 else ''}")
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
        flag = "↓" if ph < 7.35 else ("↑" if ph > 7.45 else "")
        parts.append(f"pH {ph}{flag}")
    if pco2 is not None:
        parts.append(f"pCO₂ {pco2}")
    if po2 is not None:
        flag = "↓" if po2 < 60 else ""
        parts.append(f"pO₂ {po2}{flag}")
    if hco3 is not None:
        flag = "↓" if hco3 < 22 else ""
        parts.append(f"HCO₃ {hco3}{flag}")
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

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

    sections = [
        f"=== ICU 病患臨床快照 ===",
        f"時間戳記：{now_str}",
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
        _fmt_med_section(meds),
    ]

    reports_section = _fmt_reports_section(reports)
    if reports_section:
        sections += ["", reports_section]

    scores_section = _fmt_scores_section(scores)
    if scores_section:
        sections += ["", scores_section]

    sections.append("\n=== 快照結束 ===")

    return "\n".join(sections)


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

    now_str = datetime.now(timezone.utc).strftime("%H:%M")
    delta_lines = [f"[資料更新 {now_str}]"]
    delta_lines.append(" | ".join(changes))
    delta_lines.append("---")
    return "\n".join(delta_lines)
