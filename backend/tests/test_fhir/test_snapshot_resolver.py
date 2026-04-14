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


def test_resolve_patient_snapshot_tolerates_utf8_bom(tmp_path: Path) -> None:
    """HIS legacy flat-layout exports sometimes ship with a UTF-8 BOM.

    Regression coverage for the 2026-04-14 incident where patients 50911741
    and 70117162 failed every launchd run with:
        Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)
    because _load_json_file opened files with strict utf-8 encoding.
    """
    patient_root = tmp_path / "50911741"
    patient_root.mkdir()
    payload = {"Data": [{"PAT_NO": "50911741", "Name": "BOM測試"}]}
    # Write the same JSON a real HIS export would produce — with a BOM prefix.
    (patient_root / "getPatient.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8-sig",
    )

    snapshot = resolve_patient_snapshot(patient_root)

    assert snapshot.format_type == "flat"
    # Hash must be stable and non-empty — proves _load_json_file actually
    # parsed the BOM-prefixed file instead of raising.
    assert snapshot.normalized_hash
    assert len(snapshot.normalized_hash) == 64  # sha256 hex length


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


def test_his_converter_load_tolerates_utf8_bom(tmp_path: Path) -> None:
    """HISConverter._load must tolerate UTF-8 BOM in HIS exports.

    Regression coverage for the 2026-04-14 incident where patients 50911741
    and 70117162 passed snapshot_resolver (after its BOM fix) but then failed
    the sync stage with the same "Unexpected UTF-8 BOM" error because
    HISConverter._load still opened files with strict utf-8 encoding.
    """
    patient_root = tmp_path / "70117162"
    patient_root.mkdir()
    payload = {"Data": [{"PAT_NO": "70117162", "PAT_NAME": "BOM測試"}]}
    (patient_root / "getPatient.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8-sig",
    )

    converter = HISConverter(str(patient_root))
    rows = converter._load("getPatient.json")

    assert rows == [{"PAT_NO": "70117162", "PAT_NAME": "BOM測試"}]


def test_his_converter_load_falls_back_to_extra_factories(tmp_path: Path) -> None:
    """HISConverter._load must fall back to ExtraFactories/Factory_*/.

    Regression coverage for the 2026-04-14 incident where patient 70117162
    showed 0 labs in the frontend despite having 28 lab results, because
    the HIS fetcher stored them under ExtraFactories/Factory_F/ (since the
    patient's primary admission was at HospId=M but lab results lived at
    HospId=F) and HISConverter._load only read top-level files.
    """
    patient_root = tmp_path / "70117162"
    patient_root.mkdir()

    # Top-level has getPatient/getAllMedicine but NO getLabResult.
    _write_json(
        patient_root / "getPatient.json",
        {"Data": [{"PAT_NO": "70117162", "PAT_NAME": "蔡鴻儀"}]},
    )
    _write_json(
        patient_root / "getAllMedicine.json",
        {"Data": [{"ODR_CODE": "DRUG1"}]},
    )

    # Lab data lives only in ExtraFactories/Factory_F.
    factory_f = patient_root / "ExtraFactories" / "Factory_F"
    _write_json(
        factory_f / "getLabResult.json",
        {"Data": [{"LAB_CODE": "NA", "LAB_VALUE": "140"}, {"LAB_CODE": "K", "LAB_VALUE": "4.0"}]},
    )

    converter = HISConverter(str(patient_root))

    # Top-level files still win when present.
    assert converter._load("getPatient.json") == [
        {"PAT_NO": "70117162", "PAT_NAME": "蔡鴻儀"}
    ]
    assert converter._load("getAllMedicine.json") == [{"ODR_CODE": "DRUG1"}]

    # Lab data is pulled from Factory_F as the top-level fallback.
    lab_rows = converter._load("getLabResult.json")
    assert lab_rows == [
        {"LAB_CODE": "NA", "LAB_VALUE": "140"},
        {"LAB_CODE": "K", "LAB_VALUE": "4.0"},
    ]


def test_his_converter_load_prefers_top_level_when_both_exist(tmp_path: Path) -> None:
    """Top-level files must win even when ExtraFactories has the same file.

    Guards against regressing patients 35876842..50911741 whose top-level
    getLabResult.json is the correct source — we must not accidentally
    overwrite them with Factory_F data.
    """
    patient_root = tmp_path / "50911741"
    patient_root.mkdir()
    _write_json(
        patient_root / "getLabResult.json",
        {"Data": [{"LAB_CODE": "TOP", "LAB_VALUE": "correct"}]},
    )
    _write_json(
        patient_root / "ExtraFactories" / "Factory_F" / "getLabResult.json",
        {"Data": [{"LAB_CODE": "STALE", "LAB_VALUE": "wrong"}]},
    )

    converter = HISConverter(str(patient_root))
    rows = converter._load("getLabResult.json")

    assert rows == [{"LAB_CODE": "TOP", "LAB_VALUE": "correct"}]


def test_his_converter_load_skips_empty_factory_dirs(tmp_path: Path) -> None:
    """Fallback must walk multiple factories and use the first non-empty one."""
    patient_root = tmp_path / "70117162"
    patient_root.mkdir()
    # top level missing, Factory_F has empty Data, Factory_G has real data
    _write_json(patient_root / "ExtraFactories" / "Factory_F" / "getLabResult.json", {"Data": []})
    _write_json(
        patient_root / "ExtraFactories" / "Factory_G" / "getLabResult.json",
        {"Data": [{"LAB_CODE": "G"}]},
    )

    converter = HISConverter(str(patient_root))
    rows = converter._load("getLabResult.json")

    assert rows == [{"LAB_CODE": "G"}]


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
