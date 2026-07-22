from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.fhir.his.converter import HISConverter, _culture_status
from app.fhir.his_lab_mapping import HIS_LAB_MAP


AUDITED_CODES = {
    "10511", "12022", "12080", "12081", "1208R", "12107", "12182",
    "1219", "12198", "12211", "218OT", "8075", "9005B", "9023",
    "9029", "9030", "9033", "904TU", "90CRE", "9134A", "BIOUR",
    "CL", "HYALI", "SPERM", "XPERT",
}


def test_snapshot_lab_codes_are_explicitly_mapped() -> None:
    assert AUDITED_CODES <= HIS_LAB_MAP.keys()


def test_lab_reports_keep_sheet_campus_and_text_results() -> None:
    base = {"REPORT_DATE": "1150722", "REPORT_TIME": "120000", "RES_SW": "N"}
    merged = {
        "getPatient": {"Data": [{
            "PAT_NO": "99999999", "PAT_NAME": "測試", "SEX": "M",
            "BIRTHDAY": "0400101",
        }]},
        "getLabResult": {"Data": [
            {**base, "SHEET_NO": "A", "LAB_CODE": "9349", "LAB_NAME": "Hemolysis",
             "ITEM_NAME": "Blood", "RESULT": "1"},
            {**base, "SHEET_NO": "B", "LAB_CODE": "9349", "LAB_NAME": "Hemolysis",
             "ITEM_NAME": "Blood", "RESULT": "0"},
        ]},
        "ExtraFactories_Factory_Q_getLabResult": {"Data": [
            {**base, "SHEET_NO": "C", "LAB_CODE": "1406A", "LAB_NAME": "Flu A",
             "ITEM_NAME": "Nasal swab", "RESULT": "Positive", "RES_COMMENT": "confirmed"},
        ]},
    }

    with tempfile.TemporaryDirectory() as tmp:
        snap = Path(tmp)
        (snap / "ALL_MERGED.json").write_text(
            json.dumps(merged, ensure_ascii=False), encoding="utf-8",
        )
        labs = HISConverter(str(snap), pat_no="99999999").convert_lab_data()

    assert len(labs) == 3
    assert len({row["id"] for row in labs}) == 3
    hemolysis = sorted(
        item["value"]
        for row in labs
        if row["other"]
        for key, item in row["other"].items()
        if key == "_Hemolysis"
    )
    assert hemolysis == [0.0, 1.0]
    flu = next(row["other"]["AG_FluA"] for row in labs if row["other"] and "AG_FluA" in row["other"])
    assert flu["value"] == "Positive"
    assert flu["sourceCampus"] == "Factory_Q"
    assert flu["sheetNumber"] == "C"
    assert flu["comment"] == "confirmed"
    assert flu["source"]["LAB_CODE"] == "1406A"


def test_culture_keeps_mic_metadata_campus_and_full_source() -> None:
    base = {
        "SHEET_NO": "CULT-1", "REPORT_DATE": "1150722",
        "SIGN_DATE": "1150721", "SIGN_TIME": "090000",
        "ITEM_NAME": "Culture", "ITEM_CODE": "SP", "HDEPT_NAME": "ICU",
    }
    main_rows = [
        {**base, "REPORT_TIME": "120000", "LAB_CODE": "3SAM1", "RESULT": "Blood"},
        {**base, "REPORT_TIME": "121000", "LAB_CODE": "XORG1", "RESULT": "E. coli"},
        {**base, "REPORT_TIME": "122000", "LAB_CODE": "3COL1", "RESULT": ":Many"},
        {**base, "REPORT_TIME": "123000", "LAB_CODE": "CIP", "RESULT": "S"},
        {**base, "REPORT_TIME": "124000", "LAB_CODE": "CIP2", "RESULT": "0.25"},
        {**base, "REPORT_TIME": "125000", "LAB_CODE": "3COM2", "RESULT": "危急 MDR"},
        {**base, "REPORT_TIME": "125500", "LAB_CODE": "13A03", "RESULT": "1+"},
    ]
    merged = {
        "getPatient": {"Data": [{
            "PAT_NO": "99999999", "PAT_NAME": "測試", "SEX": "M",
            "BIRTHDAY": "0400101",
        }]},
        "getLabResult": {"Data": main_rows},
        "ExtraFactories_Factory_Q_getLabResult": {"Data": [{
            **base, "REPORT_TIME": "130000", "LAB_CODE": "3RESU",
            "RESULT": "No growth",
        }]},
        "ExtraFactories_Factory_H_getLabResult": {"Data": [
            {**base, "SHEET_NO": "STAIN-1", "REPORT_TIME": "131000",
             "LAB_CODE": "3SAM4", "RESULT": "Sputum"},
            {**base, "SHEET_NO": "STAIN-1", "REPORT_TIME": "132000",
             "LAB_CODE": "13006", "RESULT": "No AFB seen"},
            {**base, "SHEET_NO": "META-1", "REPORT_TIME": "133000",
             "LAB_CODE": "3SAM1", "RESULT": "Urine"},
            {**base, "SHEET_NO": "META-1", "REPORT_TIME": "134000",
             "LAB_CODE": "XEOD", "RESULT": "Completed request"},
        ]},
    }

    with tempfile.TemporaryDirectory() as tmp:
        snap = Path(tmp)
        (snap / "ALL_MERGED.json").write_text(
            json.dumps(merged, ensure_ascii=False), encoding="utf-8",
        )
        converter = HISConverter(str(snap), pat_no="99999999")
        cultures = converter.convert_culture_results()
        labs = converter.convert_lab_data()

    assert len(cultures) == 3  # same sheet remains distinct; metadata-only is omitted
    main = next(row for row in cultures if row["source_campus"] == "MAIN")
    assert main["specimen"] == "Blood"
    assert main["isolates"] == [{
        "code": "XORG1", "organism": "E. coli", "colonies": "Many",
    }]
    assert main["susceptibility"] == [{
        "antibiotic": "Ciprofloxacin", "code": "CIP", "result": "S", "mic": "0.25",
    }]
    assert main["reported_at"].minute == 55  # latest raw report was 12:55 (04:55 UTC)
    assert main["source_details"]["alerts"] == ["危急 MDR"]
    assert len(main["source_details"]["items"]) == len(main_rows)
    assert main["source_details"]["record_type"] == "culture"
    assert main["source_details"]["status"] == "positive"
    assert main["source_details"]["stain_results"] == [{
        "code": "13A03", "label": "G(-) bacillus", "value": "1+",
    }]

    negative = next(row for row in cultures if row["source_campus"] == "Factory_Q")
    assert negative["source_details"]["status"] == "negative"
    stain = next(row for row in cultures if row["source_campus"] == "Factory_H")
    assert stain["source_details"]["record_type"] == "gram_stain"
    assert stain["source_details"]["status"] == "reported"
    assert stain["source_details"]["stain_results"][0]["value"] == "No AFB seen"
    assert labs
    assert all(
        key.startswith("GRAM_")
        for row in labs
        for key in (row["other"] or {})
    )  # the existing Lab Data stain view remains intact


def test_culture_status_covers_all_report_states() -> None:
    assert _culture_status([{"organism": "E. coli"}], None) == "positive"
    assert _culture_status([], "No growth to date") == "negative"
    assert _culture_status([], "Normal oral flora") == "normal_flora"
    assert _culture_status([], "Pending final report") == "indeterminate"
