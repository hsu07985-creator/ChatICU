"""Pure plain-text section formatters for the clinical snapshot.

Every function here turns ORM rows (or None) into a Chinese snapshot section
string. No DB access, no async. The medication-safety / duplicate sections live
in safety.py because they carry detection logic; everything else is here.
"""

from datetime import date as _date, datetime, timezone
from typing import Any, Dict, List, Optional

from app.models.patient import Patient
from app.models.lab_data import LabData
from app.models.medication import Medication
from app.models.vital_sign import VitalSign
from app.models.ventilator import VentilatorSetting
from app.models.diagnostic_report import DiagnosticReport
from app.models.clinical_score import ClinicalScore
from app.services.clinical_thresholds import (
    LAB_THRESHOLDS,
    VENT_THRESHOLDS,
    VITAL_THRESHOLDS,
    flag_only,
    mark,
)

from ._shared import TAIPEI_TZ, _TREND_THRESHOLD, _now_taipei
from .lab_values import _get_lab_val


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
        f"資料時間: {snapshot_time}（台北）",
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
        lines.append(
            f"CrCl 約 {_fmt_num(crcl)} mL/min（Cockcroft-Gault，{reason}）"
            "（以實際體重估算，肥胖／水腫時可能高估，請臨床判讀）"
        )

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
                a.get("drug", str(a)) if isinstance(a, dict) else str(a)
                for a in p.allergies if a
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
    dbil = v("biochemistry", "direct_bilirubin")
    alp = v("biochemistry", "alkaline_phosphatase")
    ggt = v("biochemistry", "gamma_gt")
    alb = v("biochemistry", "albumin")
    parts = []
    if ast is not None:
        parts.append(f"AST {ast}{flag_only(ast, LAB_THRESHOLDS['AST'])}")
    if alt is not None:
        parts.append(f"ALT {alt}{flag_only(alt, LAB_THRESHOLDS['ALT'])}")
    if tbil is not None:
        parts.append(f"T-Bil {tbil}{flag_only(tbil, LAB_THRESHOLDS['T-Bil'])}")
    if dbil is not None:
        parts.append(f"D-Bil {dbil}")
    if alp is not None:
        parts.append(f"ALP {alp}")
    if ggt is not None:
        parts.append(f"GGT {ggt}")
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
