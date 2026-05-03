"""Question-triggered LLM context prefetch for AI chat.

This is the transitional path before a full LLM tool loop exists. It keeps
large/conditional data out of the stable system prompt, but lets the backend
attach high-value context to the current LLM turn when the user's question
clearly needs it.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Optional

from sqlalchemy import String, cast, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python <3.9 fallback
    from backports.zoneinfo import ZoneInfo  # type: ignore

from app.middleware.audit import create_audit_log
from app.models.culture_result import CultureResult
from app.models.medication import Medication
from app.models.pharmacy_advice import PharmacyAdvice
from app.models.user import User

logger = logging.getLogger("chaticu")

TAIPEI_TZ = ZoneInfo("Asia/Taipei")

_CULTURE_INTENT_KEYWORDS = (
    "culture",
    "cultures",
    "susceptibility",
    "sensitivity",
    "organism",
    "isolate",
    "antibiotic",
    "antibiotics",
    "de-escalation",
    "deescalation",
    "sepsis",
    "infection",
    "infectious",
    "bacteremia",
    "pneumonia",
    "vap",
    "uti",
    "菌",
    "培養",
    "感受性",
    "敏感性",
    "抗生素",
    "感染",
    "敗血",
    "菌血",
    "肺炎",
    "尿路感染",
    "降階",
    "退階",
    "去升階",
)

_MED_CHANGE_INTENT_KEYWORDS = (
    "medication change",
    "med changes",
    "changed meds",
    "started",
    "stopped",
    "discontinued",
    "on hold",
    "hold",
    "dose change",
    "route change",
    "frequency change",
    "72h",
    "72 hours",
    "用藥變更",
    "用藥改變",
    "改藥",
    "調藥",
    "加藥",
    "新增藥",
    "停藥",
    "停用",
    "剛停",
    "剛加",
    "調劑量",
    "劑量調整",
    "頻次",
    "途徑",
    "這幾天",
    "這兩天",
    "這2天",
    "三天",
)

_ADVICE_INTENT_KEYWORDS = (
    "pharmacy advice",
    "pharmacist advice",
    "advice history",
    "recommendation history",
    "藥師建議",
    "藥事建議",
    "用藥建議",
    "建議紀錄",
    "歷史紀錄",
    "之前建議",
    "之前給",
    "給過",
    "寫過",
    "寫在哪",
    "哪一床",
    "哪床",
    "哪裡可以看",
    "我今天寫",
    "我之前",
)

_ADVICE_CROSS_PATIENT_KEYWORDS = (
    "哪一床",
    "哪床",
    "哪個床",
    "哪裡",
    "寫在哪",
    "我今天寫",
    "我之前",
    "給過",
    "寫過",
)


def should_prefetch_cultures(message: str) -> bool:
    text = (message or "").lower()
    return any(keyword in text for keyword in _CULTURE_INTENT_KEYWORDS)


def should_prefetch_medication_changes(message: str) -> bool:
    text = (message or "").lower()
    return any(keyword in text for keyword in _MED_CHANGE_INTENT_KEYWORDS)


def should_prefetch_pharmacy_advice(message: str) -> bool:
    text = (message or "").lower()
    return any(keyword in text for keyword in _ADVICE_INTENT_KEYWORDS)


def _fmt_dt(value: Any) -> str:
    if not isinstance(value, datetime):
        return "時間不明"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(TAIPEI_TZ).strftime("%Y-%m-%d %H:%M")


def _fmt_date(value: Any) -> str:
    if isinstance(value, datetime):
        return _fmt_dt(value)
    if isinstance(value, date):
        return value.isoformat()
    return "未列"


def _as_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    if value:
        return [value]
    return []


def _fmt_isolates(value: Any) -> str:
    isolates = _as_list(value)
    if not isolates:
        return "無 isolate"

    parts = []
    for item in isolates[:5]:
        if isinstance(item, dict):
            organism = item.get("organism") or item.get("name") or item.get("value")
            colonies = item.get("colonies")
            if organism and colonies:
                parts.append(f"{organism} ({colonies})")
            elif organism:
                parts.append(str(organism))
            else:
                parts.append(str(item))
        else:
            parts.append(str(item))
    if len(isolates) > 5:
        parts.append(f"另有 {len(isolates) - 5} 項")
    return "；".join(parts)


def _fmt_susceptibility(value: Any) -> str:
    susceptibility = _as_list(value)
    if not susceptibility:
        return "無 susceptibility"

    parts = []
    for item in susceptibility[:8]:
        if isinstance(item, dict):
            antibiotic = (
                item.get("antibiotic")
                or item.get("drug")
                or item.get("name")
                or item.get("code")
            )
            result = item.get("result") or item.get("interpretation")
            if antibiotic and result:
                parts.append(f"{antibiotic} {result}")
            elif antibiotic:
                parts.append(str(antibiotic))
            else:
                parts.append(str(item))
        else:
            parts.append(str(item))
    if len(susceptibility) > 8:
        parts.append(f"另有 {len(susceptibility) - 8} 項")
    return "；".join(parts)


async def get_recent_cultures(
    db: AsyncSession,
    patient_id: str,
    *,
    days: int = 14,
    limit: int = 5,
) -> List[CultureResult]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        select(CultureResult)
        .where(
            CultureResult.patient_id == patient_id,
            or_(
                CultureResult.collected_at >= cutoff,
                CultureResult.reported_at >= cutoff,
            ),
        )
        .order_by(desc(CultureResult.reported_at), desc(CultureResult.collected_at))
        .limit(limit)
    )
    return list(result.scalars().all())


def format_culture_context(cultures: List[CultureResult], *, days: int = 14) -> str:
    lines = [f"【微生物培養 最近{days}天】"]
    if not cultures:
        lines.append(f"狀態: no_data（未查到最近{days}天 culture_results）")
        return "\n".join(lines)

    lines.append(f"狀態: ok（{len(cultures)} 筆，最多顯示 5 筆）")
    for culture in cultures[:5]:
        collected = _fmt_dt(getattr(culture, "collected_at", None))
        reported = _fmt_dt(getattr(culture, "reported_at", None))
        specimen = getattr(culture, "specimen", None) or "specimen 不明"
        result_text = getattr(culture, "result", None) or "未列 result"
        q_score = getattr(culture, "q_score", None)
        q_score_text = f" | Q score {q_score}" if q_score is not None else ""
        lines.append(
            f"- {specimen} | 採檢 {collected} | 報告 {reported}{q_score_text}"
        )
        lines.append(f"  結果: {result_text}")
        lines.append(f"  Isolates: {_fmt_isolates(getattr(culture, 'isolates', None))}")
        lines.append(
            "  Susceptibility: "
            + _fmt_susceptibility(getattr(culture, "susceptibility", None))
        )
    return "\n".join(lines)


async def build_question_prefetch_context(
    db: AsyncSession,
    patient_id: Optional[str],
    message: str,
    *,
    user: Optional[User] = None,
    ip: Optional[str] = None,
) -> str:
    wants_cultures = should_prefetch_cultures(message)
    wants_med_changes = should_prefetch_medication_changes(message)
    wants_advice = should_prefetch_pharmacy_advice(message)
    if not patient_id and not wants_advice:
        return ""

    blocks = []
    if patient_id and wants_cultures:
        try:
            cultures = await get_recent_cultures(db, patient_id)
            blocks.append(format_culture_context(cultures))
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "[CHAT][PREFETCH] culture prefetch failed patient=%s: %s",
                patient_id,
                exc,
            )
            blocks.append(
                "【微生物培養 最近14天】\n"
                "狀態: error（讀取 culture_results 失敗）"
            )

    if patient_id and wants_med_changes:
        try:
            changes = await get_recent_medication_changes(db, patient_id)
            blocks.append(format_medication_changes_context(changes))
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "[CHAT][PREFETCH] medication-change prefetch failed patient=%s: %s",
                patient_id,
                exc,
            )
            blocks.append(
                "【最近72小時用藥變更】\n"
                "狀態: error（讀取 medications 變更失敗）"
            )

    if wants_advice:
        if user is None or user.role not in {"admin", "pharmacist"}:
            blocks.append(format_pharmacy_advice_context([], denied=True))
        else:
            try:
                records = await search_pharmacy_advice_history(
                    db,
                    user,
                    message,
                    patient_id=patient_id,
                )
                blocks.append(format_pharmacy_advice_context(records))
                await create_audit_log(
                    db,
                    user_id=user.id,
                    user_name=user.name,
                    role=user.role,
                    action="ai_chat_pharmacy_advice_history_search",
                    target=patient_id,
                    status="success",
                    ip=ip,
                    details={
                        "result_count": len(records),
                        "scoped_to_patient": _should_scope_advice_to_patient(
                            message,
                            patient_id,
                        ),
                    },
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning(
                    "[CHAT][PREFETCH] pharmacy-advice search failed user=%s: %s",
                    getattr(user, "id", None),
                    exc,
                )
                blocks.append(
                    "【藥師建議歷史 最近30天】\n"
                    "狀態: error（讀取 PharmacyAdvice 失敗）"
                )

    return "\n\n".join(blocks)


async def get_recent_medication_changes(
    db: AsyncSession,
    patient_id: str,
    *,
    hours: int = 72,
    limit: int = 20,
) -> List[Medication]:
    cutoff_dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    cutoff_date = cutoff_dt.date()
    result = await db.execute(
        select(Medication)
        .where(
            Medication.patient_id == patient_id,
            or_(
                Medication.updated_at >= cutoff_dt,
                Medication.start_date >= cutoff_date,
                Medication.end_date >= cutoff_date,
            ),
        )
        .order_by(
            desc(Medication.updated_at),
            desc(Medication.start_date),
            desc(Medication.end_date),
        )
        .limit(limit)
    )
    return list(result.scalars().all())


def _fmt_medication_line(med: Medication) -> str:
    name = (
        getattr(med, "generic_name", None)
        or getattr(med, "name", None)
        or "unknown"
    )
    dose_parts = []
    if getattr(med, "dose", None):
        dose = str(getattr(med, "dose"))
        unit = getattr(med, "unit", None)
        dose_parts.append(dose + (str(unit) if unit else ""))
    if getattr(med, "frequency", None):
        dose_parts.append(str(getattr(med, "frequency")))
    if getattr(med, "route", None):
        dose_parts.append(str(getattr(med, "route")))
    dose_text = f" {' '.join(dose_parts)}" if dose_parts else ""
    status = getattr(med, "status", None) or "status 不明"
    start = _fmt_date(getattr(med, "start_date", None))
    end = _fmt_date(getattr(med, "end_date", None))
    updated = _fmt_dt(getattr(med, "updated_at", None))
    return f"{name}{dose_text} | status {status} | start {start} | end {end} | updated {updated}"


def _med_change_bucket(med: Medication, cutoff_date: date) -> str:
    status = str(getattr(med, "status", "") or "").lower()
    start_date = getattr(med, "start_date", None)
    end_date = getattr(med, "end_date", None)
    if status == "on-hold":
        return "on_hold"
    if status in {"discontinued", "completed", "inactive"}:
        return "discontinued"
    if isinstance(end_date, date) and end_date >= cutoff_date:
        return "discontinued"
    if isinstance(start_date, date) and start_date >= cutoff_date:
        return "started"
    return "updated_active"


def format_medication_changes_context(
    meds: List[Medication],
    *,
    hours: int = 72,
) -> str:
    lines = [f"【最近{hours}小時用藥變更】"]
    if not meds:
        lines.append(f"狀態: no_data（未查到最近{hours}小時 medications 變更）")
        return "\n".join(lines)

    cutoff_date = (datetime.now(timezone.utc) - timedelta(hours=hours)).date()
    buckets = {
        "started": [],
        "discontinued": [],
        "on_hold": [],
        "updated_active": [],
    }
    for med in meds:
        buckets[_med_change_bucket(med, cutoff_date)].append(med)

    lines.append(
        "狀態: ok（以 medications.updated_at/start_date/end_date/status 推估；"
        "目前 schema 無歷史前值，無法直接判斷舊劑量/舊途徑）"
    )
    labels = (
        ("started", "新增/開始"),
        ("discontinued", "停用/結束"),
        ("on_hold", "Hold"),
        ("updated_active", "近期更新仍 active"),
    )
    for key, label in labels:
        rows = buckets[key]
        if not rows:
            continue
        shown = rows[:5]
        lines.append(f"{label}:")
        lines.extend(f"- {_fmt_medication_line(row)}" for row in shown)
        if len(rows) > 5:
            lines.append(f"- 另有 {len(rows) - 5} 筆未列出")
    return "\n".join(lines)


def _mask_patient_name(name: Optional[str]) -> str:
    value = (name or "").strip()
    if not value:
        return "姓名未列"
    if len(value) <= 1:
        return value
    if len(value) == 2:
        return value[0] + "○"
    return value[0] + "○" + value[-1]


def _accepted_label(value: Optional[bool]) -> str:
    if value is True:
        return "accepted"
    if value is False:
        return "rejected"
    return "pending"


def _compact_text(value: Any, limit: int = 160) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def _advice_search_terms(message: str) -> List[str]:
    import re as _re

    text = message or ""
    terms = []
    for token in _re.findall(r"\d+-[A-Za-z0-9]+|[A-Za-z][A-Za-z0-9/+_.-]{2,}", text):
        lowered = token.lower()
        if lowered in {"advice", "history", "recommendation", "pharmacy", "pharmacist"}:
            continue
        if lowered not in {term.lower() for term in terms}:
            terms.append(token[:80])
    return terms[:5]


def _should_scope_advice_to_patient(message: str, patient_id: Optional[str]) -> bool:
    if not patient_id:
        return False
    text = (message or "").lower()
    return not any(keyword in text for keyword in _ADVICE_CROSS_PATIENT_KEYWORDS)


async def search_pharmacy_advice_history(
    db: AsyncSession,
    user: User,
    message: str,
    *,
    patient_id: Optional[str] = None,
    days: int = 30,
    limit: int = 10,
) -> List[PharmacyAdvice]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    query = select(PharmacyAdvice).where(
        PharmacyAdvice.pharmacist_id == user.id,
        PharmacyAdvice.timestamp >= cutoff,
    )
    if _should_scope_advice_to_patient(message, patient_id):
        query = query.where(PharmacyAdvice.patient_id == patient_id)

    term_conditions = []
    for term in _advice_search_terms(message):
        pattern = f"%{term}%"
        term_conditions.append(
            or_(
                PharmacyAdvice.content.ilike(pattern),
                PharmacyAdvice.bed_number.ilike(pattern),
                PharmacyAdvice.patient_name.ilike(pattern),
                PharmacyAdvice.advice_code.ilike(pattern),
                PharmacyAdvice.advice_label.ilike(pattern),
                PharmacyAdvice.category.ilike(pattern),
                cast(PharmacyAdvice.linked_medications, String).ilike(pattern),
            )
        )
    if term_conditions:
        query = query.where(or_(*term_conditions))

    result = await db.execute(
        query.order_by(PharmacyAdvice.timestamp.desc()).limit(limit)
    )
    return list(result.scalars().all())


def format_pharmacy_advice_context(
    records: List[PharmacyAdvice],
    *,
    days: int = 30,
    denied: bool = False,
) -> str:
    lines = [f"【藥師建議歷史 最近{days}天】"]
    if denied:
        lines.append("狀態: denied（僅 admin/pharmacist 可查詢藥師建議歷史）")
        return "\n".join(lines)
    if not records:
        lines.append(f"狀態: no_data（未查到自己最近{days}天的 PharmacyAdvice）")
        lines.append("可回看: /pharmacy/advice-statistics")
        return "\n".join(lines)

    lines.append(
        f"狀態: ok（{len(records)} 筆；範圍為目前登入者自己建立的紀錄）"
    )
    lines.append("可回看: /pharmacy/advice-statistics")
    for record in records[:10]:
        timestamp = _fmt_dt(getattr(record, "timestamp", None))
        bed = getattr(record, "bed_number", None) or "床號未列"
        patient_name = _mask_patient_name(getattr(record, "patient_name", None))
        code = getattr(record, "advice_code", None) or "code 未列"
        label = getattr(record, "advice_label", None) or "label 未列"
        linked = ", ".join(str(m) for m in (record.linked_medications or []) if m)
        linked_text = f" | linked: {linked[:120]}" if linked else ""
        accepted = _accepted_label(getattr(record, "accepted", None))
        lines.append(
            f"- {timestamp} | {bed} {patient_name} | {code} {label} | "
            f"{accepted}{linked_text} | id {record.id}"
        )
        lines.append(f"  內容: {_compact_text(record.content)}")
    return "\n".join(lines)
