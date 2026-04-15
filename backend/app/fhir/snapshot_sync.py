"""Database sync helpers for HIS hourly snapshots."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import text

from app.fhir.his_converter import HISConverter
from app.fhir.snapshot_resolver import SnapshotInfo


HIS_OWNED_FIELDS = frozenset(
    {
        "id",
        "name",
        "medical_record_number",
        "age",
        "date_of_birth",
        "gender",
        "diagnosis",
        "attending_physician",
        "department",
        "admission_date",
        "icu_admission_date",
        "blood_type",
        "code_status",
        "has_dnr",
        "archived",
    }
)

PRESERVE_EXISTING_FIELDS = frozenset(
    {
        "bed_number",
        "height",
        "weight",
        "bmi",
        "symptoms",
        "intubated",
        "critical_status",
        "alerts",
        "allergies",
        "is_isolated",
        "unit",
        "campus",
        "last_update",
    }
)

MIXED_FIELDS = frozenset(
    {
        "sedation",
        "analgesia",
        "nmb",
        "ventilator_days",
        "consent_status",
    }
)

REPLACE_TABLES = (
    "lab_data",
    "culture_results",
    "diagnostic_reports",
)
GLOBAL_SYNC_STATUS_KEY = "his_snapshots"
# Ring buffer size for the per-patient delta feed stored inside
# sync_status.details. Large enough to cover one full hourly tick over every
# tracked patient, small enough to keep the JSONB payload bounded.
RECENT_DELTAS_LIMIT = 50


def _serialize(val: Any) -> Any:
    if isinstance(val, (date, datetime)):
        return val
    if isinstance(val, (list, dict)):
        return json.dumps(val, ensure_ascii=False, default=str)
    return val


def _is_meaningful(field: str, value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    if isinstance(value, bool):
        return value is True
    if isinstance(value, (int, float)):
        return value != 0
    return True


def merge_patient_payload(existing: dict[str, Any] | None, incoming: dict[str, Any]) -> dict[str, Any]:
    """Merge HIS-derived patient payload with an existing DB patient row."""
    if existing is None:
        return dict(incoming)

    merged = dict(existing)

    for field in HIS_OWNED_FIELDS:
        if field in incoming:
            merged[field] = incoming[field]

    for field in MIXED_FIELDS:
        if field in incoming:
            merged[field] = incoming[field]

    for field in PRESERVE_EXISTING_FIELDS:
        if field not in incoming:
            continue
        incoming_value = incoming[field]
        if _is_meaningful(field, incoming_value):
            merged[field] = incoming_value
            continue
        merged[field] = existing.get(field)

    for field, value in incoming.items():
        if field in merged:
            continue
        merged[field] = value

    return merged


async def fetch_existing_patient(session: Any, patient_id: str) -> dict[str, Any] | None:
    row = await session.execute(
        text("SELECT * FROM patients WHERE id = :id"),
        {"id": patient_id},
    )
    mapping = row.mappings().first()
    return dict(mapping) if mapping else None


async def upsert_patient(session: Any, data: dict[str, Any]) -> None:
    row = await session.execute(
        text("SELECT id FROM patients WHERE id = :id"),
        {"id": data["id"]},
    )
    exists = row.scalar() is not None

    if exists:
        sets = []
        params = {"id": data["id"]}
        for key, value in data.items():
            if key in {"id", "created_at", "updated_at"}:
                continue
            sets.append(f"{key} = :{key}")
            params[key] = _serialize(value)
        if sets:
            sql = (
                f"UPDATE patients SET {', '.join(sets)}, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = :id"
            )
            await session.execute(text(sql), params)
        return

    cols = [key for key in data.keys() if key not in {"created_at", "updated_at"}]
    placeholders = [f":{key}" for key in cols]
    params = {key: _serialize(data[key]) for key in cols}
    sql = f"INSERT INTO patients ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
    await session.execute(text(sql), params)


async def replace_patient_records(
    session: Any,
    table: str,
    patient_id: str,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    """Replace all rows for a patient in ``table`` and return a delta summary.

    Before the DELETE+INSERT, we snapshot the existing IDs so we can compute
    which records are new (in incoming but not in DB) and which were removed
    (in DB but not in incoming). This lets the sync pipeline surface a
    "X new lab results arrived" notification without needing a separate
    audit log.
    """
    existing_rows = await session.execute(
        text(f"SELECT id FROM {table} WHERE patient_id = :patient_id"),
        {"patient_id": patient_id},
    )
    existing_ids = {row[0] for row in existing_rows}
    incoming_ids = {record["id"] for record in records if record.get("id") is not None}

    added_ids = sorted(incoming_ids - existing_ids)
    removed_ids = sorted(existing_ids - incoming_ids)

    await session.execute(
        text(f"DELETE FROM {table} WHERE patient_id = :patient_id"),
        {"patient_id": patient_id},
    )
    inserted = await insert_records(session, table, records)

    return {
        "total": inserted,
        "added": len(added_ids),
        "removed": len(removed_ids),
        "added_ids": added_ids,
        "removed_ids": removed_ids,
    }


async def insert_records(session: Any, table: str, records: list[dict[str, Any]]) -> int:
    count = 0
    for record in records:
        cols = [key for key in record.keys() if key not in {"created_at", "updated_at"}]
        placeholders = [f":{key}" for key in cols]
        params = {key: _serialize(record[key]) for key in cols}
        sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
        await session.execute(text(sql), params)
        count += 1
    return count


async def upsert_records(session: Any, table: str, records: list[dict[str, Any]]) -> int:
    count = 0
    for record in records:
        row = await session.execute(
            text(f"SELECT id FROM {table} WHERE id = :id"),
            {"id": record["id"]},
        )
        exists = row.scalar() is not None

        cols = [key for key in record.keys() if key not in {"created_at", "updated_at"}]
        params = {key: _serialize(record[key]) for key in cols}

        if exists:
            sets = [f"{key} = :{key}" for key in cols if key != "id"]
            if sets:
                sql = (
                    f"UPDATE {table} SET {', '.join(sets)}, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                )
                await session.execute(text(sql), params)
        else:
            placeholders = [f":{key}" for key in cols]
            sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
            await session.execute(text(sql), params)
        count += 1
    return count


async def reconcile_medications(
    session: Any,
    patient_id: str,
    medications: list[dict[str, Any]],
) -> dict[str, Any]:
    existing_rows = await session.execute(
        text("SELECT id FROM medications WHERE patient_id = :patient_id"),
        {"patient_id": patient_id},
    )
    existing_ids = {row[0] for row in existing_rows}
    incoming_ids = {record["id"] for record in medications}
    added_ids = sorted(incoming_ids - existing_ids)

    upserted = await upsert_records(session, "medications", medications)

    stale_ids = sorted(existing_ids - incoming_ids)
    protected_ids: list[str] = []
    deleted_ids: list[str] = []

    for medication_id in stale_ids:
        admin_row = await session.execute(
            text(
                "SELECT 1 FROM medication_administrations "
                "WHERE medication_id = :medication_id LIMIT 1"
            ),
            {"medication_id": medication_id},
        )
        has_admins = admin_row.scalar() is not None
        if has_admins:
            protected_ids.append(medication_id)
            await session.execute(
                text(
                    "UPDATE medications "
                    "SET status = :status, updated_at = CURRENT_TIMESTAMP "
                    "WHERE id = :id"
                ),
                {"status": "discontinued", "id": medication_id},
            )
            continue

        await session.execute(
            text("DELETE FROM medications WHERE id = :id"),
            {"id": medication_id},
        )
        deleted_ids.append(medication_id)

    return {
        "upserted": upserted,
        "added": len(added_ids),
        "added_ids": added_ids,
        "deleted": len(deleted_ids),
        "deleted_ids": deleted_ids,
        "protected": len(protected_ids),
        "protected_ids": protected_ids,
    }


async def sync_snapshot_into_session(session: Any, snapshot: SnapshotInfo) -> dict[str, Any]:
    converter = HISConverter(str(snapshot.snapshot_dir), pat_no=snapshot.mrn)
    result = converter.convert_all()
    if "error" in result:
        raise ValueError(result["error"])

    incoming_patient = result["patient"]
    patient_id = incoming_patient["id"]
    existing_patient = await fetch_existing_patient(session, patient_id)
    merged_patient = merge_patient_payload(existing_patient, incoming_patient)
    await upsert_patient(session, merged_patient)

    replace_counts = {}
    for table, records in (
        ("lab_data", result["lab_data"]),
        ("culture_results", result["culture_results"]),
        ("diagnostic_reports", result["diagnostic_reports"]),
    ):
        replace_counts[table] = await replace_patient_records(session, table, patient_id, records)

    medication_summary = await reconcile_medications(session, patient_id, result["medications"])

    return {
        "patient_id": patient_id,
        "patient_name": merged_patient["name"],
        "patient_mrn": snapshot.mrn,
        "snapshot_id": snapshot.snapshot_id,
        "snapshot_dir": str(snapshot.snapshot_dir),
        "normalized_hash": snapshot.normalized_hash,
        "format_type": snapshot.format_type,
        "medications": medication_summary,
        "lab_data": replace_counts["lab_data"],
        "culture_results": replace_counts["culture_results"],
        "diagnostic_reports": replace_counts["diagnostic_reports"],
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def _coerce_count(entry: Any, key: str = "added") -> int:
    """Return a single numeric counter from either the legacy int shape or
    the new ``{total, added, removed, ...}`` dict shape."""
    if isinstance(entry, dict):
        value = entry.get(key)
        return int(value) if isinstance(value, (int, float)) else 0
    if isinstance(entry, (int, float)):
        return int(entry)
    return 0


def _build_delta_event(summary: dict[str, Any]) -> dict[str, Any] | None:
    """Collapse a per-patient sync summary into a lightweight delta event for
    the frontend toast feed. Returns ``None`` when nothing actually changed so
    callers can skip appending a no-op entry to the ring buffer."""
    medications = summary.get("medications")
    med_added = _coerce_count(medications, "added") if isinstance(medications, dict) else 0
    med_deleted = _coerce_count(medications, "deleted") if isinstance(medications, dict) else 0

    lab_added = _coerce_count(summary.get("lab_data"), "added")
    cul_added = _coerce_count(summary.get("culture_results"), "added")
    diag_added = _coerce_count(summary.get("diagnostic_reports"), "added")

    total_added = med_added + lab_added + cul_added + diag_added
    if total_added == 0 and med_deleted == 0:
        return None

    return {
        "patient_id": summary["patient_id"],
        "patient_name": summary["patient_name"],
        "patient_mrn": summary["patient_mrn"],
        "snapshot_id": summary["snapshot_id"],
        "synced_at": summary["synced_at"],
        "added": {
            "medications": med_added,
            "lab_data": lab_added,
            "culture_results": cul_added,
            "diagnostic_reports": diag_added,
        },
        "removed": {
            "medications": med_deleted,
        },
    }


async def upsert_global_sync_status(session: Any, summary: dict[str, Any]) -> None:
    synced_at = datetime.fromisoformat(summary["synced_at"])

    # Pull the existing ring buffer so we can append to it instead of
    # overwriting. Because sync_status is a single-row global feed, multiple
    # patients syncing in one tick would otherwise clobber each other — the
    # ring buffer preserves every delta until the frontend has a chance to
    # poll for it.
    existing = await session.execute(
        text("SELECT details FROM sync_status WHERE key = :key"),
        {"key": GLOBAL_SYNC_STATUS_KEY},
    )
    existing_details_raw = existing.scalar_one_or_none()
    existing_details: dict[str, Any] = {}
    if isinstance(existing_details_raw, dict):
        existing_details = existing_details_raw
    elif isinstance(existing_details_raw, str):
        try:
            parsed = json.loads(existing_details_raw)
            if isinstance(parsed, dict):
                existing_details = parsed
        except json.JSONDecodeError:
            existing_details = {}

    recent_deltas = existing_details.get("recent_deltas") or []
    if not isinstance(recent_deltas, list):
        recent_deltas = []

    new_event = _build_delta_event(summary)
    if new_event is not None:
        recent_deltas = [*recent_deltas, new_event][-RECENT_DELTAS_LIMIT:]

    details = {
        "patient_id": summary["patient_id"],
        "patient_name": summary["patient_name"],
        "patient_mrn": summary["patient_mrn"],
        "snapshot_id": summary["snapshot_id"],
        "snapshot_dir": summary["snapshot_dir"],
        "normalized_hash": summary["normalized_hash"],
        "format_type": summary["format_type"],
        "medications": summary["medications"],
        "lab_data": summary["lab_data"],
        "culture_results": summary["culture_results"],
        "diagnostic_reports": summary["diagnostic_reports"],
        "recent_deltas": recent_deltas,
    }

    params = {
        "key": GLOBAL_SYNC_STATUS_KEY,
        "source": "his_snapshots",
        "version": summary["synced_at"],
        "last_synced_at": synced_at,
        "details": _serialize(details),
    }
    await session.execute(
        text(
            "INSERT INTO sync_status (key, source, version, last_synced_at, details) "
            "VALUES (:key, :source, :version, :last_synced_at, :details) "
            "ON CONFLICT(key) DO UPDATE SET "
            "source = excluded.source, "
            "version = excluded.version, "
            "last_synced_at = excluded.last_synced_at, "
            "details = excluded.details, "
            "updated_at = CURRENT_TIMESTAMP"
        ),
        params,
    )
