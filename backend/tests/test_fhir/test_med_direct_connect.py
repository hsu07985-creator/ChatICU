"""Medication fields connected directly to HIS snapshot fields (2026-07-22 audit).

Covers: generic_name ← HIS DRUG_NAME, atc_code gap-fill ← HIS ATC_CODE (formulary
miss only, coding_source='his_atc', is_antibiotic from J-prefix), nhi_code
passthrough, and the _classify_san ATC-prefix backstop.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.fhir.his.converter import HISConverter
from app.fhir.his.drug_dictionaries import _classify_san, _combo_generic_from_his


# ---- _classify_san: name primary, ATC backstop ---------------------------

def test_san_name_pattern_is_primary() -> None:
    assert _classify_san("Propofol 1% 20ml inj", None) == "S"
    assert _classify_san("Fentanyl 0.5mg inj", None) == "A"
    assert _classify_san("Rocuronium 50mg inj", None) == "N"


def test_san_atc_backstop_when_name_misses() -> None:
    # trade names outside the curated list, recovered via ATC prefix
    assert _classify_san("Eurodin 2mg", "N05CD07") == "S"   # estazolam (benzo hypnotic)
    assert _classify_san("Ansial", "N05BA06") == "S"        # lorazepam (IV benzo → sedation)
    assert _classify_san("Celebrex 200mg cap", "M01AH01") == "A"  # celecoxib (NSAID)
    assert _classify_san("Tramacet", "N02AJ13") == "A"      # tramadol/paracetamol
    assert _classify_san("SomeBlocker", "M03AC01") == "N"   # neuromuscular blocker


def test_san_atc_backstop_excludes_maintenance_antipsychotics() -> None:
    # N05AH removed: maintenance olanzapine/clozapine must NOT be forced to S by ATC
    assert _classify_san("Zyprexa 10mg", "N05AH03") is None  # olanzapine, name misses
    # but quetiapine used for sedation is still caught by NAME (primary)
    assert _classify_san("Seroquel 25mg tab", "N05AH04") == "S"


def test_san_none_when_neither_matches() -> None:
    assert _classify_san("Aspirin 100mg", None) is None
    assert _classify_san("Aspirin 100mg", "B01AC06") is None  # antiplatelet, not S/A/N


# ---- converter medication direct-connect ---------------------------------

def _snapshot(root: Path, pat_no: str, med_rows: list) -> str:
    merged = {
        "getPatient": {"Succ": True, "Data": [{"PAT_NO": pat_no, "PAT_NAME": "測試", "SEX": "M", "BIRTHDAY": "0400101"}]},
        "getAllMedicine": {"Succ": True, "Data": med_rows},
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


def test_generic_name_from_his_drug_name() -> None:
    # ODR_CODE not in formulary/alias/exclusion → terminal else uses DRUG_NAME
    (med,) = _convert([{"ODR_CODE": "ZZTEST01", "ODR_NAME": "Seroquel 25mg tab",
                        "DRUG_NAME": "Quetiapine", "ATC_CODE": "N05AH04",
                        "NHI_CODE": "AC12345100", "DOSE": "25", "DOSE_UNIT": "mg",
                        "FREQ_CODE": "HS", "ROUTE_CODE": "PO", "ODR_SEQ": "1"}])
    assert med["generic_name"] == "Quetiapine"       # not brand "Seroquel"
    assert med["name"] == "Seroquel 25mg tab"        # display keeps trade+strength
    assert med["nhi_code"] == "AC12345100"


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
