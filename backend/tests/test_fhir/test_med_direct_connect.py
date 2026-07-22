"""Medication fields connected directly to HIS snapshot fields."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.fhir.his.converter import HISConverter
from app.fhir.his.drug_dictionaries import (
    _classify_category,
    _classify_san,
    _combo_generic_from_his,
)


# ---- ATC-only labels -----------------------------------------------------

def test_san_uses_only_atc() -> None:
    assert _classify_san("N05CD07") == "S"
    assert _classify_san("N05BA06") == "S"
    assert _classify_san("N01AH01") == "A"
    assert _classify_san("N02AJ13") == "A"
    assert _classify_san("M01AH01") == "A"
    assert _classify_san("M03AC01") == "N"
    assert _classify_san("N05AH04") is None
    assert _classify_san("Seroquel 25mg tab") is None
    assert _classify_san(None) is None


def test_therapeutic_category_uses_only_atc() -> None:
    cases = {
        "J01DH02": "antibiotic", "J04AB02": "antibiotic",
        "P01AB01": "antibiotic", "D06AX01": "antibiotic",
        "S01AA01": "antibiotic", "A07AA09": "antibiotic",
        "A07AA02": "antifungal", "J02AC01": "antifungal",
        "D01AC01": "antifungal", "J05AB01": "antiviral",
        "D06BB03": "antiviral", "S01AD03": "antiviral",
        "C01CA03": "vasopressor", "B01AF01": "anticoagulant",
        "D07AA02": "steroid", "A02BC02": "ppi",
        "A02BA03": "h2_blocker", "C03CA01": "diuretic",
        "A10AB01": "insulin", "B05XA03": "electrolyte",
        "R03AC02": "bronchodilator", "C01BD01": "antiarrhythmic",
        "N03AX14": "antiepileptic", "A06AD02": "laxative",
        "A03FA09": "antiemetic", "A04AA01": "antiemetic",
    }
    assert {code: _classify_category(code) for code in cases} == cases
    assert _classify_category("Hydrocortisone") is None
    assert _classify_category("A07BC05") is None
    assert _classify_category(None) is None


# ---- converter medication direct-connect ---------------------------------

def _snapshot(root: Path, pat_no: str, med_rows: list, seq_rows: list | None = None) -> str:
    merged = {
        "getPatient": {"Succ": True, "Data": [{"PAT_NO": pat_no, "PAT_NAME": "測試", "SEX": "M", "BIRTHDAY": "0400101"}]},
        "getAllMedicine": {"Succ": True, "Data": med_rows},
    }
    if seq_rows is not None:
        merged["getMedicine_AllPatientSeq"] = {
            "Responses": [{"Succ": True, "Data": seq_rows}],
        }
    snap = root / pat_no / "20260722_000000"
    snap.mkdir(parents=True)
    (root / pat_no / "latest.txt").write_text("20260722_000000")
    (snap / "ALL_MERGED.json").write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    return str(snap)


def _convert(med_rows: list) -> list:
    with tempfile.TemporaryDirectory() as tmp:
        snap = _snapshot(Path(tmp), "99999999", med_rows)
        return HISConverter(snap, pat_no="99999999").convert_medications()


def test_primary_seq_is_merged_with_all_campuses() -> None:
    shared = {
        "PAT_SEQ": "M001", "ODR_SEQ": "1", "ODR_CODE": "MAIN1",
        "ODR_NAME": "Main drug", "DRUG_NAME": "Main generic",
        "ATC_CODE": "A01AA01", "HDEPT_NAME": "ICU",
    }
    extra = {
        "PAT_SEQ": "Q001", "ODR_SEQ": "2", "ODR_CODE": "EXTRA1",
        "ODR_NAME": "Extra drug", "DRUG_NAME": "Extra generic",
        "ATC_CODE": "A01AA02", "_source_factory": "Factory_Q",
    }
    seq_only = {
        "PAT_SEQ": "M001", "ODR_SEQ": "3", "ODR_CODE": "SEQ1",
        "ODR_NAME": "Seq drug", "DRUG_NAME": "Seq generic",
        "ATC_CODE": "A01AA03",
    }
    with tempfile.TemporaryDirectory() as tmp:
        snap = _snapshot(Path(tmp), "99999999", [shared, extra], [shared, seq_only])
        meds = HISConverter(snap, pat_no="99999999").convert_medications()

    assert {m["order_code"] for m in meds} == {"MAIN1", "EXTRA1", "SEQ1"}
    by_code = {m["order_code"]: m for m in meds}
    assert by_code["MAIN1"]["prescribing_department"] == "ICU"
    assert by_code["MAIN1"]["source_campus"] == "陽明院區"
    assert by_code["MAIN1"]["source_details"]["HDEPT_NAME"] == "ICU"
    assert by_code["MAIN1"]["source_details"]["DRUG_NAME"] == "Main generic"
    assert by_code["SEQ1"]["source_details"]["ODR_CODE"] == "SEQ1"
    assert by_code["EXTRA1"]["source_campus"] == "忠孝院區"
    assert by_code["EXTRA1"]["source_details"]["_source_factory"] == "Factory_Q"


def test_generic_name_from_his_drug_name() -> None:
    # ODR_CODE not in formulary/alias/exclusion → terminal else uses DRUG_NAME
    (med,) = _convert([{"ODR_CODE": "ZZTEST01", "ODR_NAME": "Seroquel 25mg tab",
                        "DRUG_NAME": "Quetiapine", "ATC_CODE": "N05AH04",
                        "NHI_CODE": "AC12345100", "DOSE": "25", "DOSE_UNIT": "mg",
                        "FREQ_CODE": "HS", "ROUTE_CODE": "PO", "ODR_SEQ": "1"}])
    assert med["generic_name"] == "Quetiapine"       # not brand "Seroquel"
    assert med["name"] == "Seroquel 25mg tab"        # display keeps trade+strength
    assert med["nhi_code"] == "AC12345100"


def test_his_generic_and_atc_are_not_overwritten_by_ddi_or_formulary() -> None:
    (med,) = _convert([{
        "ODR_CODE": "IAMIN9", "ODR_NAME": "Amikacin inj",
        "DRUG_NAME": "Amikacin", "ATC_CODE": "J01GB06",
        "ODR_SEQ": "9",
    }])
    assert med["generic_name"] == "Amikacin"
    assert med["atc_code"] == "J01GB06"
    assert med["coding_source"] == "his_atc"


def test_fallback_atc_never_drives_source_owned_labels() -> None:
    (med,) = _convert([{
        "ODR_CODE": "IAMIN9", "ODR_NAME": "Amikacin inj",
        "DRUG_NAME": "Amikacin", "ATC_CODE": "", "ODR_SEQ": "10",
    }])
    assert med["atc_code"] == "J01GB06"  # retained for non-label consumers
    assert med["coding_source"] == "formulary+abx"
    assert med["category"] is None
    assert med["san_category"] is None
    assert med["is_antibiotic"] is False


def test_generic_name_combo_splits_on_comma() -> None:
    (med,) = _convert([{"ODR_CODE": "ZZTEST02", "ODR_NAME": "Tazocin inj",
                        "DRUG_NAME": "Piperacillin, Tazobactam", "ATC_CODE": "J01CR05",
                        "DOSE": "4.5", "DOSE_UNIT": "gm", "FREQ_CODE": "Q8H",
                        "ROUTE_CODE": "IV", "ODR_SEQ": "2"}])
    assert med["generic_name"] == "Piperacillin / Tazobactam"


def test_combo_generic_helper() -> None:
    # comma + strength stripping
    assert _combo_generic_from_his("Amlodipine 5mg, Telmisartan 80mg") == "Amlodipine / Telmisartan"
    # slash as component separator (drug names on both sides)
    assert _combo_generic_from_his("Tiotropium/Olodaterol") == "Tiotropium / Olodaterol"
    assert _combo_generic_from_his("Empagliflozin 12.5mg / Metformin 850mg") == "Empagliflozin / Metformin"
    # plus and semicolon separators
    assert _combo_generic_from_his("Neomycin+Nystatin+Gramicidin") == "Neomycin / Nystatin / Gramicidin"
    assert _combo_generic_from_his("Acetylsalicylic acid; Aspirin") == "Acetylsalicylic acid / Aspirin"
    # THE TRAP: slash inside a strength ratio is NOT a component separator
    assert _combo_generic_from_his("Acyclovir 50mg/gm 5gm Cream") == "Acyclovir"
    # name-numbers (no unit) must survive
    assert _combo_generic_from_his("Silymarin, Vit B1, Vit B2, Vit B6") == "Silymarin / Vit B1 / Vit B2 / Vit B6"
    # single clean generic unchanged; empty → None
    assert _combo_generic_from_his("Quetiapine") == "Quetiapine"
    assert _combo_generic_from_his("") is None


def test_atc_gapfill_from_his_when_formulary_misses() -> None:
    (med,) = _convert([{"ODR_CODE": "ZZTEST03", "ODR_NAME": "Meropenem inj",
                        "DRUG_NAME": "Meropenem", "ATC_CODE": "J01DH02",
                        "NHI_CODE": "BC99999100", "DOSE": "1", "DOSE_UNIT": "gm",
                        "FREQ_CODE": "Q8H", "ROUTE_CODE": "IV", "ODR_SEQ": "3"}])
    assert med["atc_code"] == "J01DH02"
    assert med["coding_source"] == "his_atc"
    assert med["is_antibiotic"] is True              # J01 prefix
    assert med["nhi_code"] == "BC99999100"


def test_atc_gapfill_non_j_antimicrobials_are_antibiotic() -> None:
    # metronidazole (P01AB) and oral non-absorbed antibacterials (A07AA) must flag
    (metro,) = _convert([{"ODR_CODE": "ZZTEST05", "ODR_NAME": "Flagyl 500mg inj",
                          "DRUG_NAME": "Metronidazole", "ATC_CODE": "P01AB01",
                          "DOSE": "500", "DOSE_UNIT": "mg", "FREQ_CODE": "Q8H",
                          "ROUTE_CODE": "IV", "ODR_SEQ": "5"}])
    assert metro["is_antibiotic"] is True and metro["coding_source"] == "his_atc"
    (vanco,) = _convert([{"ODR_CODE": "ZZTEST06", "ODR_NAME": "Vancomycin 250mg cap",
                          "DRUG_NAME": "Vancomycin", "ATC_CODE": "A07AA09",
                          "DOSE": "250", "DOSE_UNIT": "mg", "FREQ_CODE": "QID",
                          "ROUTE_CODE": "PO", "ODR_SEQ": "6"}])
    assert vanco["is_antibiotic"] is True


def test_atc_gapfill_non_antibiotic_stays_false() -> None:
    (med,) = _convert([{"ODR_CODE": "ZZTEST04", "ODR_NAME": "Rostan 20mg cap",
                        "DRUG_NAME": "Aesculus", "ATC_CODE": "C05CX91",
                        "DOSE": "20", "DOSE_UNIT": "mg", "FREQ_CODE": "BID",
                        "ROUTE_CODE": "PO", "ODR_SEQ": "4"}])
    assert med["atc_code"] == "C05CX91"
    assert med["coding_source"] == "his_atc"
    assert med["is_antibiotic"] is False             # C05 not J0*
