"""HISConverter on the 2026-07-21 nested snapshot layout.

Covers the ALL_MERGED.json loader fallback (no flat per-source files) and the
SMARTBED-derived patient fields wired on top of it: bed_number, anthropometrics,
airway status, and structured food allergy.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from app.fhir.his.converter import HISConverter


def _write_nested_snapshot(root: Path, pat_no: str, all_merged: dict) -> str:
    snap = root / pat_no / "20260721_204616"
    snap.mkdir(parents=True)
    (root / pat_no / "latest.txt").write_text("20260721_204616")
    (snap / "ALL_MERGED.json").write_text(
        json.dumps(all_merged, ensure_ascii=False), encoding="utf-8"
    )
    return str(snap)


def _rest(rows: list) -> dict:
    return {"Succ": True, "Code": "0000", "Data": rows}


def _base_merged(pat_no: str) -> dict:
    """Minimal ALL_MERGED with no flat files — everything lives here."""
    return {
        "getPatient": _rest([{"PAT_NO": pat_no, "PAT_NAME": "測試", "SEX": "M",
                              "BIRTHDAY": "0400101"}]),
        "getICUbed": _rest([
            {"PAT_NO": "99999999", "BED_CODE": "MICU01"},  # someone else's bed
            {"PAT_NO": pat_no, "BED_CODE": "MICU11"},
        ]),
        "Smartbed": {"M": {
            "sbNutrition": {"M01311": [
                {"BODY_HEIGHT": "165", "BODY_WEIGHT": "42.7", "BMI": "15.7"}
            ]},
            "sbTube": {"M01311": [
                {"PIPE_ALIASES": "Endo_1", "PUT_DATE": "1150701"},
                {"PIPE_ALIASES": "NG_1", "PUT_DATE": "1150701"},
            ]},
            "sbDisease": {"M01311": [
                {"FOOD_ALLERGY": "海鮮類, 花生", "PAST_HISTORY": "高血壓"}
            ]},
        }},
    }


def test_all_merged_fallback_reads_core_sources() -> None:
    """No flat getPatient.json — the loader must fall back to ALL_MERGED."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "30546132", _base_merged("30546132"))
        patient = HISConverter(snap, pat_no="30546132").convert_patient()

    assert patient is not None
    assert patient["name"] == "測試"
    assert patient["medical_record_number"] == "30546132"


def test_bed_number_filters_by_pat_no() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "30546132", _base_merged("30546132"))
        patient = HISConverter(snap, pat_no="30546132").convert_patient()

    assert patient["bed_number"] == "MICU11"  # not the 99999999 roster row


def test_anthropometrics_and_airway() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "30546132", _base_merged("30546132"))
        patient = HISConverter(snap, pat_no="30546132").convert_patient()

    assert patient["height"] == 165.0
    assert patient["weight"] == 42.7
    assert patient["bmi"] == 15.7
    assert patient["intubated"] is True          # Endo_1
    assert patient["tracheostomy"] is False       # no Tr tube
    assert patient["tracheostomy_date"] is None


def test_tracheostomy_from_tr_tube() -> None:
    import tempfile

    merged = _base_merged("50669055")
    merged["Smartbed"]["M"]["sbTube"] = {"M01311": [
        {"PIPE_ALIASES": "Tr_1", "PUT_DATE": "1150706", "END_DATE": "1150805"},
    ]}
    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "50669055", merged)
        patient = HISConverter(snap, pat_no="50669055").convert_patient()

    assert patient["intubated"] is False
    assert patient["tracheostomy"] is True
    assert patient["tracheostomy_date"] == date(2026, 7, 6)


def test_removed_tube_is_ignored() -> None:
    """A tube whose END_DATE is already past must not count as in-place."""
    import tempfile

    merged = _base_merged("50669055")
    merged["Smartbed"]["M"]["sbTube"] = {"M01311": [
        {"PIPE_ALIASES": "Endo_1", "PUT_DATE": "1100101", "END_DATE": "1100201"},
    ]}
    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "50669055", merged)
        patient = HISConverter(snap, pat_no="50669055").convert_patient()

    assert patient["intubated"] is False


def test_food_allergy_merged_into_allergies() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "30546132", _base_merged("30546132"))
        result = HISConverter(snap, pat_no="30546132").convert_all()

    assert result["patient"]["allergies"] == ["海鮮類", "花生"]


def _tpr_seq(pat_no: str, rows: list) -> dict:
    return {"Tool": "getTPR", "PatientId": pat_no, "HospId": "M",
            "IncludedPatientSeqList": ["M01311"],
            "Responses": [{"Succ": True, "Data": rows}]}


def test_vital_signs_from_gettpr() -> None:
    import tempfile

    merged = _base_merged("30546132")
    merged["getTPR_AllPatientSeq"] = _tpr_seq("30546132", [
        {"CREATEDATE": "1150721", "CREATETIME": "1900", "TEMPERATURE": "37",
         "PULSE": "107", "RESPIRATIONRATE": "24", "SYSTOLICBP": "99", "DIASTOLICBP": "48"},
        # identical duplicate of the same timestamp → collapsed to one row
        {"CREATEDATE": "1150721", "CREATETIME": "1900", "TEMPERATURE": "37",
         "PULSE": "107", "RESPIRATIONRATE": "24", "SYSTOLICBP": "99", "DIASTOLICBP": "48"},
        # all-null row → skipped
        {"CREATEDATE": "1150721", "CREATETIME": "1800", "TEMPERATURE": None,
         "PULSE": None, "RESPIRATIONRATE": None, "SYSTOLICBP": None, "DIASTOLICBP": None},
    ])
    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "30546132", merged)
        vitals = HISConverter(snap, pat_no="30546132").convert_vital_signs()

    assert len(vitals) == 1
    v = vitals[0]
    assert v["heart_rate"] == 107
    assert v["systolic_bp"] == 99 and v["diastolic_bp"] == 48
    assert v["mean_bp"] == 65.0  # (99 + 2*48) / 3
    assert v["respiratory_rate"] == 24
    assert v["temperature"] == 37.0
    assert v["patient_id"] == vitals[0]["patient_id"]
    assert v["timestamp"].tzinfo is not None  # tz-aware (Taipei→UTC)
    # spo2 / invasive pressures are HIS-absent → not emitted
    assert "spo2" not in v


def test_vital_signs_absent_when_no_gettpr() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "30546132", _base_merged("30546132"))
        result = HISConverter(snap, pat_no="30546132").convert_all()

    assert result["vital_signs"] == []
    assert result["summary"]["vital_signs_count"] == 0


def test_absent_smartbed_keeps_placeholders() -> None:
    """No SMARTBED block → empty/placeholder values so the merge keeps manual."""
    import tempfile

    merged = {"getPatient": _rest([{"PAT_NO": "111", "PAT_NAME": "X", "SEX": "F",
                                    "BIRTHDAY": "0400101"}])}
    with tempfile.TemporaryDirectory() as tmp:
        snap = _write_nested_snapshot(Path(tmp), "111", merged)
        patient = HISConverter(snap, pat_no="111").convert_patient()

    assert patient["bed_number"] == ""
    assert patient["height"] is None
    assert patient["intubated"] is False
    assert patient["tracheostomy"] is False
