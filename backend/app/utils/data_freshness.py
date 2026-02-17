"""Data freshness + missing-value hints for offline JSON mode (AO-06)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.config import settings

_SECTION_THRESHOLDS_HOURS = {
    "lab_data": 24.0,
    "vital_signs": 6.0,
    "ventilator_settings": 6.0,
}

_LAB_ALIAS_GROUPS = {
    "lab_data.biochemistry.K": {"k", "potassium"},
    "lab_data.biochemistry.Na": {"na", "sodium"},
    "lab_data.biochemistry.renal": {"scr", "cr", "creatinine", "egfr"},
}


def _iso_z(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_timestamp(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _value_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        if "value" in value:
            return _value_present(value.get("value"))
        return any(_value_present(v) for v in value.values())
    if isinstance(value, list):
        return any(_value_present(v) for v in value)
    return True


def _has_lab_alias_value(lab_data: dict[str, Any], aliases: set[str]) -> bool:
    for category in ("biochemistry", "hematology", "bloodGas", "inflammatory", "coagulation"):
        section = lab_data.get(category)
        if not isinstance(section, dict):
            continue
        for key, value in section.items():
            if str(key).strip().lower() in aliases and _value_present(value):
                return True
    return False


def _build_section_status(
    section_name: str,
    payload: dict[str, Any] | None,
    now_utc: datetime,
) -> tuple[dict[str, Any], datetime | None]:
    threshold = _SECTION_THRESHOLDS_HOURS.get(section_name)
    if not payload:
        return {
            "status": "missing",
            "timestamp": None,
            "age_hours": None,
            "threshold_hours": threshold,
        }, None

    ts = _parse_timestamp(payload.get("timestamp"))
    if ts is None:
        return {
            "status": "unknown",
            "timestamp": payload.get("timestamp"),
            "age_hours": None,
            "threshold_hours": threshold,
        }, None

    age_hours = round(max(0.0, (now_utc - ts).total_seconds() / 3600.0), 2)
    status = "stale" if (threshold is not None and age_hours > threshold) else "fresh"
    return {
        "status": status,
        "timestamp": _iso_z(ts),
        "age_hours": age_hours,
        "threshold_hours": threshold,
    }, ts


def build_data_freshness(patient_data: dict[str, Any] | None) -> dict[str, Any] | None:
    """Build data freshness metadata and missing-value hints.

    Returns None when patient context is absent.
    """
    if not isinstance(patient_data, dict):
        return None

    now_utc = datetime.now(timezone.utc)
    lab_data = patient_data.get("lab_data") if isinstance(patient_data.get("lab_data"), dict) else None
    vital_signs = (
        patient_data.get("vital_signs") if isinstance(patient_data.get("vital_signs"), dict) else None
    )
    ventilator_settings = (
        patient_data.get("ventilator_settings")
        if isinstance(patient_data.get("ventilator_settings"), dict)
        else None
    )
    medications = patient_data.get("medications") if isinstance(patient_data.get("medications"), list) else []

    missing_fields: list[str] = []
    stale_sections: list[str] = []

    lab_status, lab_ts = _build_section_status("lab_data", lab_data, now_utc)
    vital_status, vital_ts = _build_section_status("vital_signs", vital_signs, now_utc)
    vent_status, vent_ts = _build_section_status("ventilator_settings", ventilator_settings, now_utc)
    if lab_status["status"] == "stale":
        stale_sections.append("lab_data")
    if vital_status["status"] == "stale":
        stale_sections.append("vital_signs")
    if vent_status["status"] == "stale":
        stale_sections.append("ventilator_settings")

    if lab_data is None:
        missing_fields.append("lab_data")
    else:
        for field_name, aliases in _LAB_ALIAS_GROUPS.items():
            if not _has_lab_alias_value(lab_data, aliases):
                missing_fields.append(field_name)

    if vital_signs is None:
        missing_fields.append("vital_signs")
    else:
        if not _value_present(vital_signs.get("heartRate")):
            missing_fields.append("vital_signs.heartRate")
        if not _value_present(vital_signs.get("spo2")):
            missing_fields.append("vital_signs.spo2")
        bp = vital_signs.get("bloodPressure") if isinstance(vital_signs.get("bloodPressure"), dict) else {}
        if not _value_present(bp.get("systolic")):
            missing_fields.append("vital_signs.bloodPressure.systolic")
        if not _value_present(bp.get("diastolic")):
            missing_fields.append("vital_signs.bloodPressure.diastolic")

    intubated = bool(patient_data.get("intubated"))
    if intubated and ventilator_settings is None:
        missing_fields.append("ventilator_settings")
    if ventilator_settings is not None:
        if not _value_present(ventilator_settings.get("mode")):
            missing_fields.append("ventilator_settings.mode")
        if not _value_present(ventilator_settings.get("fio2")):
            missing_fields.append("ventilator_settings.fio2")
        if not _value_present(ventilator_settings.get("peep")):
            missing_fields.append("ventilator_settings.peep")

    if len(medications) == 0:
        missing_fields.append("medications.active")

    latest_candidates = [ts for ts in (lab_ts, vital_ts, vent_ts) if ts is not None]
    latest_ts = max(latest_candidates) if latest_candidates else None
    as_of = _iso_z(latest_ts)

    hints: list[str] = []
    if settings.DATA_SOURCE_MODE == "json":
        hints.append("目前為 JSON 離線模式，資料可能非即時。")
    if as_of:
        hints.append(f"資料快照時間：{as_of}")
    if stale_sections:
        hints.append("資料時間較舊：" + "、".join(stale_sections) + "。")
    if missing_fields:
        sample = "、".join(missing_fields[:5])
        more_count = max(0, len(missing_fields) - 5)
        suffix = f" 等 {more_count} 項" if more_count > 0 else ""
        hints.append(f"資料缺值：{sample}{suffix}。")

    return {
        "mode": settings.DATA_SOURCE_MODE,
        "generated_at": _iso_z(now_utc),
        "as_of": as_of,
        "sections": {
            "lab_data": lab_status,
            "vital_signs": vital_status,
            "ventilator_settings": vent_status,
            "medications": {
                "status": "present" if medications else "missing",
                "active_count": len(medications),
            },
        },
        "missing_fields": missing_fields,
        "hints": hints,
    }
