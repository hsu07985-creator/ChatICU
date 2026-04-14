from __future__ import annotations

import json
from pathlib import Path

from app.fhir.his_converter import HISConverter
from app.fhir.snapshot_resolver import (
    compute_snapshot_hash,
    discover_patient_roots,
    resolve_patient_snapshot,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_discover_patient_roots_filters_numeric_dirs(tmp_path: Path) -> None:
    (tmp_path / "16312169").mkdir()
    (tmp_path / "not-a-patient").mkdir()
    (tmp_path / "20260412_tmp").mkdir()

    roots = discover_patient_roots(tmp_path)

    assert [root.name for root in roots] == ["16312169"]


def test_resolve_patient_snapshot_prefers_latest_txt(tmp_path: Path) -> None:
    patient_root = tmp_path / "16312169"
    _write_json(
        patient_root / "20260412_000000" / "ALL_MERGED.json",
        {"Data": [{"PAT_NO": "16312169", "DateTime": "older"}]},
    )
    _write_json(
        patient_root / "20260412_010000" / "ALL_MERGED.json",
        {"Data": [{"PAT_NO": "16312169", "DateTime": "newer"}]},
    )
    (patient_root / "latest.txt").write_text("20260412_010000\n", encoding="utf-8")

    snapshot = resolve_patient_snapshot(patient_root)

    assert snapshot.snapshot_id == "20260412_010000"
    assert snapshot.snapshot_dir == patient_root / "20260412_010000"
    assert snapshot.format_type == "hourly-latest"


def test_resolve_patient_snapshot_uses_newest_timestamp_dir_when_latest_missing(
    tmp_path: Path,
) -> None:
    patient_root = tmp_path / "16312169"
    _write_json(
        patient_root / "20260412_000000" / "ALL_MERGED.json",
        {"Data": [{"PAT_NO": "16312169"}]},
    )
    _write_json(
        patient_root / "20260412_010000" / "ALL_MERGED.json",
        {"Data": [{"PAT_NO": "16312169"}]},
    )

    snapshot = resolve_patient_snapshot(patient_root)

    assert snapshot.snapshot_id == "20260412_010000"
    assert snapshot.format_type == "hourly-max"


def test_resolve_patient_snapshot_falls_back_to_flat_layout(tmp_path: Path) -> None:
    patient_root = tmp_path / "16312169"
    _write_json(patient_root / "getPatient.json", {"Data": [{"PAT_NO": "16312169"}]})

    snapshot = resolve_patient_snapshot(patient_root)

    assert snapshot.snapshot_id == "flat"
    assert snapshot.snapshot_dir == patient_root
    assert snapshot.format_type == "flat"


def test_normalized_hash_ignores_volatile_timestamp_fields(tmp_path: Path) -> None:
    snapshot_a_dir = tmp_path / "20260412_000000"
    snapshot_b_dir = tmp_path / "20260412_010000"
    payload_base = {
        "Data": [
            {
                "PAT_NO": "16312169",
                "Name": "王測試",
                "Nested": {"Value": 1},
            }
        ]
    }
    payload_a = {
        **payload_base,
        "DateTime": "2026-04-12T00:00:00+08:00",
        "_RunTimestamp": "20260412_000000",
        "_GeneratedAt": "2026-04-12T00:00:01+08:00",
    }
    payload_b = {
        **payload_base,
        "DateTime": "2026-04-12T01:00:00+08:00",
        "_RunTimestamp": "20260412_010000",
        "_GeneratedAt": "2026-04-12T01:00:01+08:00",
    }
    _write_json(snapshot_a_dir / "ALL_MERGED.json", payload_a)
    _write_json(snapshot_b_dir / "ALL_MERGED.json", payload_b)

    assert compute_snapshot_hash(snapshot_a_dir) == compute_snapshot_hash(snapshot_b_dir)


def test_his_converter_load_supports_getipd_alias(tmp_path: Path) -> None:
    patient_root = tmp_path / "16312169"
    _write_json(
        patient_root / "getIpd.json",
        {"Data": [{"DR_NAME": "陳醫師", "HDEPT_NAME": "內科"}]},
    )

    converter = HISConverter(str(patient_root))
    rows = converter._load("getIPD.json")

    assert rows == [{"DR_NAME": "陳醫師", "HDEPT_NAME": "內科"}]


def test_his_converter_can_override_patient_number_for_snapshot_dirs(tmp_path: Path) -> None:
    snapshot_dir = tmp_path / "16312169" / "20260412_010000"
    _write_json(
        snapshot_dir / "getPatient.json",
        {"Data": [{"PAT_NAME": "王測試", "SEX": "M"}]},
    )

    converter = HISConverter(str(snapshot_dir), pat_no="16312169")
    patient = converter.convert_patient()

    assert patient is not None
    assert patient["medical_record_number"] == "16312169"
