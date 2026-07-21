"""Left-ICU census flag: converter derivation + merge semantics.

getICUbed lists the whole in-bed ICU unit. A patient whose PAT_NO is absent has
left the ICU (transfer/discharge). See
docs/his-sync/census-left-unit-detection-design-2026-07-21.md
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.fhir.his.converter import HISConverter
from app.fhir.snapshot_sync import merge_patient_payload


def _rest(rows: list) -> dict:
    return {"Succ": True, "Code": "0000", "Data": rows}


def _snapshot_with_roster(root: Path, pat_no: str, roster_pat_nos: list) -> str:
    merged = {
        "getPatient": _rest([{"PAT_NO": pat_no, "PAT_NAME": "測試", "SEX": "M",
                              "BIRTHDAY": "0400101"}]),
        "getICUbed": _rest([
            {"PAT_NO": pn, "BED_CODE": f"GICU{i:02d}"}
            for i, pn in enumerate(roster_pat_nos, start=1)
        ]),
    }
    snap = root / pat_no / "20260721_204616"
    snap.mkdir(parents=True)
    (root / pat_no / "latest.txt").write_text("20260721_204616")
    (snap / "ALL_MERGED.json").write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    return str(snap)


def _left_unit(pat_no: str, roster_pat_nos: list):
    with tempfile.TemporaryDirectory() as tmp:
        snap = _snapshot_with_roster(Path(tmp), pat_no, roster_pat_nos)
        return HISConverter(snap, pat_no=pat_no).convert_patient()["left_unit"]


# ---- converter derivation ------------------------------------------------

def test_present_in_roster_is_false() -> None:
    assert _left_unit("30546132", ["11111111", "22222222", "30546132"]) is False


def test_absent_from_roster_is_true() -> None:
    # transferred out: our MRN is not among the current ICU beds
    assert _left_unit("30546132", ["11111111", "22222222", "33333333"]) is True


def test_small_roster_is_untrusted_none() -> None:
    # degraded snapshot (demographics-only) → don't flag the whole unit as gone
    assert _left_unit("30546132", ["11111111", "30546132"]) is None
    assert _left_unit("30546132", []) is None


# ---- merge semantics -----------------------------------------------------

def test_merge_none_keeps_existing_flag() -> None:
    # untrusted roster (None) must not clear a previously-set flag
    merged = merge_patient_payload({"id": "pat_x", "left_unit": True}, {"id": "pat_x", "left_unit": None})
    assert merged["left_unit"] is True


def test_merge_false_clears_flag_self_heal() -> None:
    # patient re-enters the roster → flag must clear (False can't ride PRESERVE)
    merged = merge_patient_payload({"id": "pat_x", "left_unit": True}, {"id": "pat_x", "left_unit": False})
    assert merged["left_unit"] is False


def test_merge_true_sets_flag() -> None:
    merged = merge_patient_payload({"id": "pat_x", "left_unit": False}, {"id": "pat_x", "left_unit": True})
    assert merged["left_unit"] is True


def test_merge_new_patient_coerces_none_to_false() -> None:
    # NOT NULL column: a roster-less first sync must insert False, not None
    merged = merge_patient_payload(None, {"id": "pat_new", "left_unit": None})
    assert merged["left_unit"] is False
