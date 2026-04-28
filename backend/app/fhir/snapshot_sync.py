"""Database sync helpers for HIS hourly snapshots."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import text

from app.fhir.his_converter import HISConverter
from app.fhir.snapshot_resolver import SnapshotInfo


class SchemaInconsistencyError(ValueError):
    """Raised when batch insert/upsert receives records with mismatched
    effective key sets (i.e. keys other than created_at / updated_at differ
    between rows). Surfaced as a fail-loud signal so an upstream HISConverter
    regression cannot silently misalign columns inside a batch INSERT VALUES
    statement. See docs/system-audit-2026-04-28.md §D.2.
    """


_TIMESTAMP_FIELDS = frozenset({"created_at", "updated_at"})
CHUNK_SIZE = 500  # well under PostgreSQL's 32767 bind-parameter ceiling


def _effective_keys(record: dict[str, Any]) -> frozenset[str]:
    """Return the record's keys with timestamp fields stripped.

    Per-row legacy code already drops created_at / updated_at before INSERT
    (server defaults fill them), so a record that happens to carry an extra
    timestamp must NOT cause batch sync to fail loud. See audit doc §D.2.
    """
    return frozenset(record.keys()) - _TIMESTAMP_FIELDS


def _assert_uniform_schema(records: list[dict[str, Any]]) -> list[str]:
    """Return the canonical column list (sans timestamps), raising
    SchemaInconsistencyError if records disagree on their effective key
    set. The returned order follows records[0]'s insertion order.
    """
    if not records:
        return []
    expected = _effective_keys(records[0])
    for i, record in enumerate(records[1:], start=1):
        if _effective_keys(record) != expected:
            raise SchemaInconsistencyError(
                f"records[{i}] effective keys differ from records[0]: "
                f"diff={sorted(_effective_keys(record) ^ expected)}"
            )
    return [k for k in records[0].keys() if k not in _TIMESTAMP_FIELDS]


def _dedupe_by_id_for_upsert(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Last-write-wins dedupe for upsert_records' batch path only.

    Mirrors per-row legacy behaviour where a later record with the same id
    UPDATEs the earlier one. Necessary because PostgreSQL rejects an
    ON CONFLICT DO UPDATE statement that touches the same conflict target
    twice within a single INSERT (``cannot affect row a second time``).

    Do NOT use this in insert_records — duplicate ids there must still
    raise IntegrityError so an upstream converter bug surfaces immediately
    (audit doc §D.6).
    """
    seen: dict[Any, dict[str, Any]] = {}
    for record in records:
        seen[record["id"]] = record
    return list(seen.values())


def _build_values_clause(cols: list[str], n_records: int) -> str:
    """Render ``(:c0_0, :c1_0, ...), (:c0_1, :c1_1, ...)`` with positional
    placeholder names so a single statement can carry many rows without
    name collisions.
    """
    rows = []
    for i in range(n_records):
        placeholders = ", ".join(f":{col}_{i}" for col in cols)
        rows.append(f"({placeholders})")
    return ", ".join(rows)


def _build_batch_params(records: list[dict[str, Any]], cols: list[str]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    for i, record in enumerate(records):
        for col in cols:
            params[f"{col}_{i}"] = _serialize(record[col])
    return params


async def _execute_batch_upsert(
    session: Any,
    table: str,
    cols: list[str],
    records: list[dict[str, Any]],
) -> None:
    """One ``INSERT ... VALUES (...), (...) ON CONFLICT (id) DO UPDATE`` round-trip.

    SET clause uses ``excluded.{col}`` for every non-id column plus
    ``updated_at = CURRENT_TIMESTAMP``. ``created_at`` is intentionally
    omitted from both the column list (server default fills it on INSERT)
    and the SET clause (so a conflict update preserves the original
    insertion timestamp). See audit doc §D.6.1 / Step 1 invariant tests.
    """
    if not records:
        return
    values_clause = _build_values_clause(cols, len(records))
    update_cols = [c for c in cols if c != "id"]
    if update_cols:
        set_clauses = [f"{c} = excluded.{c}" for c in update_cols]
        set_clauses.append("updated_at = CURRENT_TIMESTAMP")
        sql = (
            f"INSERT INTO {table} ({', '.join(cols)}) "
            f"VALUES {values_clause} "
            f"ON CONFLICT (id) DO UPDATE SET {', '.join(set_clauses)}"
        )
    else:
        # Only `id` supplied — preserve legacy "no UPDATE, no updated_at bump".
        sql = (
            f"INSERT INTO {table} ({', '.join(cols)}) "
            f"VALUES {values_clause} "
            f"ON CONFLICT (id) DO NOTHING"
        )
    await session.execute(text(sql), _build_batch_params(records, cols))


async def _execute_batch_insert(
    session: Any,
    table: str,
    cols: list[str],
    records: list[dict[str, Any]],
) -> None:
    """One ``INSERT ... VALUES (...), (...)`` round-trip — strict path,
    no ON CONFLICT clause. Same-id duplicates surface as IntegrityError
    so an upstream converter regression becomes visible immediately
    (audit doc §D.6).
    """
    if not records:
        return
    values_clause = _build_values_clause(cols, len(records))
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES {values_clause}"
    await session.execute(text(sql), _build_batch_params(records, cols))


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
        "tracheostomy",
        "tracheostomy_date",
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
    """Insert all records via multi-row ``INSERT VALUES`` batches.

    Strict path with NO dedupe — duplicate ids inside a single call surface
    as ``IntegrityError`` so a converter regression (e.g. emitting two
    lab rows with the same id) is caught immediately rather than being
    silently collapsed. Use ``upsert_records`` when the caller actually
    wants id-collision recovery. See audit doc §D.6.

    Schema is asserted uniform across all records (timestamps stripped
    before comparison) before any SQL fires.
    """
    if not records:
        return 0
    cols = _assert_uniform_schema(records)
    for offset in range(0, len(records), CHUNK_SIZE):
        chunk = records[offset : offset + CHUNK_SIZE]
        await _execute_batch_insert(session, table, cols, chunk)
    return len(records)


async def upsert_records(session: Any, table: str, records: list[dict[str, Any]]) -> int:
    """Insert all records via multi-row ``INSERT VALUES`` batches with
    ``ON CONFLICT (id) DO UPDATE`` recovery.

    Workflow:
    1. ``_assert_uniform_schema`` validates that every record carries the
       same effective key set (timestamp fields excluded from comparison).
       Mismatches raise SchemaInconsistencyError so an upstream
       HISConverter regression cannot silently misalign columns.
    2. ``_dedupe_by_id_for_upsert`` collapses same-id duplicates to a
       last-write-wins single entry. This avoids PostgreSQL's
       "cannot affect row a second time" error inside a batch
       INSERT...ON CONFLICT and matches the per-row legacy behaviour
       where successive UPDATEs let the later record win.
    3. The deduped list is chunked (``CHUNK_SIZE``) and each chunk runs
       in one ON CONFLICT round-trip.

    Returns ``len(records)`` — the *original* input length, NOT
    ``len(deduped)``. ``reconcile_medications`` writes this number into
    the user-visible ``med_upserted`` summary; leaking dedupe count would
    change the external contract (audit doc §D.6.1).

    ``created_at`` is excluded from both the INSERT column list and the
    SET clause so a conflict update never overwrites the original
    insertion timestamp. Verified by
    ``test_upsert_records_preserves_created_at_on_update``.
    """
    if not records:
        return 0

    cols = _assert_uniform_schema(records)
    deduped = _dedupe_by_id_for_upsert(records)

    for offset in range(0, len(deduped), CHUNK_SIZE):
        chunk = deduped[offset : offset + CHUNK_SIZE]
        await _execute_batch_upsert(session, table, cols, chunk)

    return len(records)


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


def compute_medication_coverage(medications: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarise ATC coverage of a patient's medications (PR-4).

    Returns counts by coding_source + top-level coverage pct.
    """
    from collections import Counter

    total = len(medications)
    by_source = Counter(m.get("coding_source") or "missing" for m in medications)
    with_atc = sum(1 for m in medications if m.get("atc_code"))
    unmapped = [
        {"order_code": m.get("order_code"), "name": m.get("name")}
        for m in medications
        if not m.get("atc_code") and m.get("order_code")
    ]
    return {
        "total": total,
        "with_atc": with_atc,
        "coverage_pct": round(100 * with_atc / total, 1) if total else 0,
        "by_source": dict(by_source),
        "unmapped_top": unmapped[:10],
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
    # PR-4: per-patient ATC coverage report written to disk for operator audit.
    coverage = compute_medication_coverage(result["medications"])
    write_coverage_report(snapshot.mrn, patient_id, snapshot.snapshot_id, coverage)

    return {
        "patient_id": patient_id,
        "patient_name": merged_patient["name"],
        "patient_mrn": snapshot.mrn,
        "snapshot_id": snapshot.snapshot_id,
        "snapshot_dir": str(snapshot.snapshot_dir),
        "normalized_hash": snapshot.normalized_hash,
        "format_type": snapshot.format_type,
        "medications": medication_summary,
        "medication_coverage": coverage,
        "lab_data": replace_counts["lab_data"],
        "culture_results": replace_counts["culture_results"],
        "diagnostic_reports": replace_counts["diagnostic_reports"],
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def write_coverage_report(
    mrn: str, patient_id: str, snapshot_id: str, coverage: dict[str, Any]
) -> None:
    """Write per-patient medication ATC coverage to backend/.logs/his_sync/."""
    from pathlib import Path

    log_dir = Path(__file__).resolve().parents[2] / ".logs" / "his_sync"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        out_path = log_dir / f"coverage_{mrn}_{snapshot_id}.json"
        out_path.write_text(
            json.dumps(
                {
                    "mrn": mrn,
                    "patient_id": patient_id,
                    "snapshot_id": snapshot_id,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    **coverage,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception:
        # Coverage report is best-effort; never fail the sync on disk errors.
        pass


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
