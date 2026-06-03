"""Async DB access layer for the clinical snapshot.

All `_get_*` coroutines that read patient context out of Postgres live here,
plus the `_merge_lab_rows` helper that stitches HIS-split lab rows back into a
single logical row. Pure I/O — no formatting.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

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

from ._shared import logger


# ── DB queries ────────────────────────────────────────────────────────────────

_LAB_CATEGORY_ATTRS = (
    "biochemistry",
    "hematology",
    "blood_gas",
    "venous_blood_gas",
    "inflammatory",
    "coagulation",
    "cardiac",
    "thyroid",
    "hormone",
    "lipid",
    "other",
)
_LAB_MERGE_LIMIT = 50


def _merge_lab_rows(labs: List[LabData]) -> Optional[LabData]:
    """Merge the latest available item values across recent lab rows.

    HIS imports often split chemistry/CBC/inflammation items into separate
    timestamps. A single latest row may contain only ALP/GGT, which is not
    enough context for AI chat. Keep the newest row's timestamp, but fill each
    JSONB item from the most recent row that contains it.

    NOTE (svc-2): the merge is intentionally UNBOUNDED in time. An ICU patient's
    most recent CBC can legitimately be ~24-48h older than the latest chemistry
    draw (different draw schedules); a time window would DROP that value and hide
    a real, often abnormal result — a worse failure than the staleness it tried
    to fix. The real svc-2 concern (a stale item shown under the newest
    timestamp) should be addressed with per-item recency annotation in the lab
    formatter, NOT by discarding data here.
    """
    if not labs:
        return None
    if len(labs) == 1:
        return labs[0]

    latest = labs[0]
    merged_categories: Dict[str, Optional[dict]] = {}
    for attr in _LAB_CATEGORY_ATTRS:
        merged: dict = {}
        for lab in labs:
            data = getattr(lab, attr, None)
            if not isinstance(data, dict):
                continue
            for key, value in data.items():
                if key not in merged:
                    merged[key] = value
        merged_categories[attr] = merged or None

    return LabData(
        id=getattr(latest, "id", "lab_merged"),
        patient_id=getattr(latest, "patient_id", ""),
        timestamp=getattr(latest, "timestamp", None),
        corrections=getattr(latest, "corrections", None),
        **merged_categories,
    )


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
        .limit(_LAB_MERGE_LIMIT)
    )
    return _merge_lab_rows(list(result.scalars().all()))


async def _get_lab_before_24h(db: AsyncSession, patient_id: str, reference_ts: datetime) -> Optional[LabData]:
    """Get the most recent lab record that is at least 24h before reference_ts."""
    cutoff = reference_ts - timedelta(hours=24)
    result = await db.execute(
        select(LabData)
        .where(LabData.patient_id == patient_id, LabData.timestamp <= cutoff)
        .order_by(desc(LabData.timestamp))
        .limit(_LAB_MERGE_LIMIT)
    )
    return _merge_lab_rows(list(result.scalars().all()))


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
