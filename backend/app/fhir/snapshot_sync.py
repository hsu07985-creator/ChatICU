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
) -> int:
    await session.execute(
        text(f"DELETE FROM {table} WHERE patient_id = :patient_id"),
        {"patient_id": patient_id},
    )
    return await insert_records(session, table, records)


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


async def upsert_global_sync_status(session: Any, summary: dict[str, Any]) -> None:
    synced_at = datetime.fromisoformat(summary["synced_at"])
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
    }

    row = await session.execute(
        text("SELECT key FROM sync_status WHERE key = :key"),
        {"key": GLOBAL_SYNC_STATUS_KEY},
    )
    exists = row.scalar() is not None
    params = {
        "key": GLOBAL_SYNC_STATUS_KEY,
        "source": "his_snapshots",
        "version": summary["synced_at"],
        "last_synced_at": synced_at,
        "details": _serialize(details),
    }
    if exists:
        await session.execute(
            text(
                "UPDATE sync_status "
                "SET source = :source, version = :version, last_synced_at = :last_synced_at, "
                "details = :details, updated_at = CURRENT_TIMESTAMP "
                "WHERE key = :key"
            ),
            params,
        )
        return

    await session.execute(
        text(
            "INSERT INTO sync_status (key, source, version, last_synced_at, details) "
            "VALUES (:key, :source, :version, :last_synced_at, :details)"
        ),
        params,
    )
