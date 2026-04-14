"""Resolve the effective HIS snapshot directory for each patient root.

Supports both legacy flat directories:

    patient/<mrn>/getPatient.json

and the newer hourly snapshot layout:

    patient/<mrn>/latest.txt
    patient/<mrn>/20260412_010000/getPatient.json

The resolver also computes a normalized content hash that ignores known
volatile timestamp keys so repeated fetches with identical payloads can be
skipped.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


TIMESTAMP_DIR_RE = re.compile(r"^\d{8}_\d{6}$")
VOLATILE_KEYS = frozenset({"DateTime", "_RunTimestamp", "_GeneratedAt"})
PRIMARY_JSON_FILES = (
    "ALL_MERGED.json",
    "getPatient.json",
    "getLabResult.json",
    "getAllMedicine.json",
    "getAllOrder.json",
    "getIPD.json",
    "getIpd.json",
    "getOpd.json",
    "getSurgery.json",
)


@dataclass(frozen=True)
class SnapshotInfo:
    """Resolved snapshot metadata for one patient."""

    mrn: str
    patient_root: Path
    snapshot_dir: Path
    snapshot_id: str
    format_type: str
    normalized_hash: str


def discover_patient_roots(base: Path, patient_filter: str | None = None) -> list[Path]:
    """Return numeric patient directories under the given base path."""
    if not base.exists():
        raise FileNotFoundError(f"patient directory not found: {base}")

    patient_dirs = sorted(
        path for path in base.iterdir() if path.is_dir() and path.name.isdigit()
    )

    if patient_filter is None:
        return patient_dirs

    filtered = [path for path in patient_dirs if path.name == patient_filter]
    if not filtered:
        raise FileNotFoundError(f"patient {patient_filter} not found in {base}")
    return filtered


def resolve_patient_snapshot(patient_root: Path) -> SnapshotInfo:
    """Resolve the effective snapshot directory for a patient root."""
    if not patient_root.is_dir():
        raise FileNotFoundError(f"patient root not found: {patient_root}")

    snapshot_dir, snapshot_id, format_type = _select_snapshot_dir(patient_root)
    normalized_hash = compute_snapshot_hash(snapshot_dir)

    return SnapshotInfo(
        mrn=patient_root.name,
        patient_root=patient_root,
        snapshot_dir=snapshot_dir,
        snapshot_id=snapshot_id,
        format_type=format_type,
        normalized_hash=normalized_hash,
    )


def compute_snapshot_hash(snapshot_dir: Path) -> str:
    """Compute a stable hash for the effective snapshot contents."""
    payload = _build_snapshot_payload(snapshot_dir)
    normalized = _normalize_json(payload)
    serialized = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _select_snapshot_dir(patient_root: Path) -> tuple[Path, str, str]:
    latest_path = patient_root / "latest.txt"
    if latest_path.exists():
        latest_value = latest_path.read_text(encoding="utf-8").strip()
        if not TIMESTAMP_DIR_RE.fullmatch(latest_value):
            raise ValueError(f"invalid latest.txt value for {patient_root.name}: {latest_value!r}")
        snapshot_dir = patient_root / latest_value
        if not snapshot_dir.is_dir():
            raise FileNotFoundError(
                f"latest.txt points to missing snapshot for {patient_root.name}: {snapshot_dir}"
            )
        return snapshot_dir, latest_value, "hourly-latest"

    timestamp_dirs = sorted(
        path for path in patient_root.iterdir() if path.is_dir() and TIMESTAMP_DIR_RE.fullmatch(path.name)
    )
    if timestamp_dirs:
        snapshot_dir = timestamp_dirs[-1]
        return snapshot_dir, snapshot_dir.name, "hourly-max"

    return patient_root, "flat", "flat"


def _build_snapshot_payload(snapshot_dir: Path) -> Any:
    merged_path = snapshot_dir / "ALL_MERGED.json"
    if merged_path.exists():
        return _load_json_file(merged_path)

    payload: dict[str, Any] = {}
    for filename in _iter_available_primary_json(snapshot_dir):
        payload[filename] = _load_json_file(snapshot_dir / filename)
    if payload:
        return payload

    raise FileNotFoundError(f"no primary HIS JSON files found in snapshot: {snapshot_dir}")


def _iter_available_primary_json(snapshot_dir: Path) -> Iterable[str]:
    seen: set[str] = set()
    for filename in PRIMARY_JSON_FILES:
        if filename in seen:
            continue
        seen.add(filename)
        if (snapshot_dir / filename).exists():
            yield filename


def _load_json_file(path: Path) -> Any:
    # Use utf-8-sig so HIS exports that ship with a UTF-8 BOM (seen on the
    # "flat" legacy layout, e.g. patients 50911741 / 70117162) decode without
    # raising "Unexpected UTF-8 BOM". utf-8-sig is a strict superset of utf-8
    # for reading — it strips a leading BOM if present and is a no-op otherwise.
    with path.open(encoding="utf-8-sig") as handle:
        return json.load(handle)


def _normalize_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _normalize_json(val)
            for key, val in value.items()
            if key not in VOLATILE_KEYS
        }
    if isinstance(value, list):
        return [_normalize_json(item) for item in value]
    return value
