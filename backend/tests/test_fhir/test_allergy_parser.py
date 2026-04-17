"""Tests for allergy extraction from getSO SUBJECTIVE text.

Covers:
  - Negative (NKA) patterns: Chinese + English
  - Positive patterns: single/multiple substances, with reactions
  - No mention → unknown
  - Edge cases: multi-visit, dedup, case sensitivity, empty data
  - Integration with real patient data (requires patient/ directory)
"""
from typing import List

import pytest
from pathlib import Path

from app.fhir.allergy_parser import parse_allergy_text, parse_allergy_texts


# ======================================================================
# Unit tests — pure regex, no file I/O
# ======================================================================


class TestNegativePatterns:
    """否定模式 → allergies=[], status='nka'"""

    @pytest.mark.parametrize("text,description", [
        # English patterns
        ("Drug allergy(-),煙(-)", "括號否定"),
        ("Drug allergy -", "空格 dash"),
        ("drug allergy-, smoking-, alcohol-", "dash 緊接"),
        ("Allergy NKA", "NKA 關鍵字"),
        ("p/h NKA, HT(+), DM(-)", "NKA 混在其他病史"),
        ("ALLERGIC HX TO MEDICIN: NIL", "NIL 關鍵字"),
        ("ALLERGIC HX TO MEDICINE: NIL", "NIL + medicine 拼法"),
        ("no allergy to egg & vaccine", "no allergy 自然語言"),
        ("serious ADR to previous vaccination(-)", "ADR 否定"),
        ("No known drug allergy", "NKDA 描述"),
        ("NKDA", "NKDA 縮寫"),
        # Chinese patterns
        ("無已知過敏", "中文 無已知過敏"),
        ("無藥物過敏", "中文 無藥物過敏"),
        ("無過敏", "中文 無過敏"),
        ("藥物過敏(-)", "中文括號否定"),
        ("藥物過敏: 無", "中文冒號無"),
        ("過敏: 否認", "中文否認"),
        ("藥物過敏: nil", "中文冒號 nil"),
        ("過敏: none", "中文冒號 none"),
    ])
    def test_negative_returns_nka(self, text, description):
        result = parse_allergy_text(text)
        assert result["allergies"] == [], f"應為空: {description}"
        assert result["status"] == "nka", f"應為 nka: {description}"


class TestPositivePatterns:
    """陽性模式 → 正確提取藥物名稱"""

    @pytest.mark.parametrize("text,expected_substances,description", [
        (
            "Drug allergy(+): Penicillin",
            ["Penicillin"],
            "括號陽性 + 冒號",
        ),
        (
            "Drug allergy: Penicillin, Sulfa",
            ["Penicillin", "Sulfa"],
            "多藥物逗號分隔",
        ),
        (
            "Allergy: PCN",
            ["PCN"],
            "簡寫 Allergy",
        ),
        (
            "ALLERGIC HX TO MEDICIN: Penicillin",
            ["Penicillin"],
            "ALLERGIC HX 陽性",
        ),
        (
            "過敏: Penicillin",
            ["Penicillin"],
            "中文冒號",
        ),
        (
            "藥物過敏: Aspirin, Morphine",
            ["Aspirin", "Morphine"],
            "中文多藥物",
        ),
        (
            "對 Vancomycin 過敏",
            ["Vancomycin"],
            "中文「對...過敏」",
        ),
        (
            "Drug allergy: Cefazolin",
            ["Cefazolin"],
            "單一抗生素",
        ),
        (
            "Drug allergy(+): Aspirin, Ibuprofen, Naproxen",
            ["Aspirin", "Ibuprofen", "Naproxen"],
            "三個藥物",
        ),
    ])
    def test_positive_extracts_substances(self, text, expected_substances, description):
        result = parse_allergy_text(text)
        assert result["status"] == "has_allergies", f"應為 has_allergies: {description}"
        extracted = [a["substance"] for a in result["allergies"]]
        for sub in expected_substances:
            assert sub in extracted, f"缺少 {sub}: {description}"
        assert len(extracted) == len(expected_substances), f"數量不符: {description}"


class TestNoMention:
    """完全沒有過敏相關文字 → unknown"""

    @pytest.mark.parametrize("text", [
        "Chief complaint: fever for 3 days",
        "主訴：咳嗽兩天",
        "",
        "HT(+), DM(+), CAD",
        "Voiding: OK. Nocturia 2/N.",
        "stable, for drug refill",
    ])
    def test_no_mention_returns_unknown(self, text):
        result = parse_allergy_text(text)
        assert result["allergies"] == []
        assert result["status"] == "unknown"


class TestReactionParsing:
    """反應描述解析"""

    @pytest.mark.parametrize("text,substance,reaction", [
        ("Drug allergy(+): Penicillin (rash)", "Penicillin", "rash"),
        ("Drug allergy: Morphine (噁心嘔吐)", "Morphine", "噁心嘔吐"),
        ("Drug allergy(+): Penicillin - skin rash", "Penicillin", "skin rash"),
        ("藥物過敏: Aspirin（皮疹）", "Aspirin", "皮疹"),
    ])
    def test_reaction_parsed(self, text, substance, reaction):
        result = parse_allergy_text(text)
        assert result["status"] == "has_allergies"
        match = [a for a in result["allergies"] if a["substance"] == substance]
        assert len(match) == 1
        assert match[0]["reaction"] == reaction


class TestEdgeCases:
    """邊界情況"""

    def test_empty_text(self):
        result = parse_allergy_text("")
        assert result["status"] == "unknown"
        assert result["allergies"] == []

    def test_none_like_text(self):
        result = parse_allergy_text("   ")
        assert result["status"] == "unknown"

    def test_case_insensitive(self):
        result = parse_allergy_text("DRUG ALLERGY: PENICILLIN")
        assert result["status"] == "has_allergies"
        assert result["allergies"][0]["substance"] == "PENICILLIN"

    def test_multiline_with_positive(self):
        """多行文字，其中一行有陽性 allergy"""
        text = "S: HTN history\nDrug allergy: Penicillin\nDM(-)"
        result = parse_allergy_text(text)
        assert result["status"] == "has_allergies"
        assert result["allergies"][0]["substance"] == "Penicillin"

    def test_multiline_with_negative(self):
        """多行文字，其中一行有否定 allergy"""
        text = "S: HTN history\nDrug allergy(-)\nDM(-)"
        result = parse_allergy_text(text)
        assert result["status"] == "nka"

    def test_positive_in_same_text_overrides_negative(self):
        """同一段文字既有否定又有陽性 → 陽性優先"""
        text = "Drug allergy(-)\nDrug allergy: Morphine"
        result = parse_allergy_text(text)
        assert result["status"] == "has_allergies"

    def test_extracted_text_preserved(self):
        """原始文字被保留"""
        text = "Drug allergy: Penicillin"
        result = parse_allergy_text(text)
        assert result["allergies"][0]["extracted_text"] == "Drug allergy: Penicillin"


class TestMultiVisit:
    """多筆就診合併"""

    def test_all_negative(self):
        texts = [
            "Drug allergy(-)",
            "NKA",
            "ALLERGIC HX TO MEDICIN: NIL",
        ]
        result = parse_allergy_texts(texts)
        assert result["status"] == "nka"
        assert result["allergies"] == []

    def test_all_unknown(self):
        texts = [
            "Voiding: OK",
            "Chief complaint: fever",
        ]
        result = parse_allergy_texts(texts)
        assert result["status"] == "unknown"

    def test_one_positive_among_negatives(self):
        """多筆就診中有一筆陽性 → 取陽性"""
        texts = [
            "Drug allergy(-)",
            "Drug allergy: Penicillin",
            "NKA",
        ]
        result = parse_allergy_texts(texts)
        assert result["status"] == "has_allergies"
        assert len(result["allergies"]) == 1
        assert result["allergies"][0]["substance"] == "Penicillin"

    def test_dedup_across_visits(self):
        """多筆就診重複提到同藥物 → 去重"""
        texts = [
            "Drug allergy: Penicillin",
            "Allergy: Penicillin, Sulfa",
        ]
        result = parse_allergy_texts(texts)
        substances = [a["substance"] for a in result["allergies"]]
        assert substances.count("Penicillin") == 1
        assert "Sulfa" in substances
        assert len(substances) == 2

    def test_dedup_case_insensitive(self):
        """去重不區分大小寫"""
        texts = [
            "Drug allergy: Penicillin",
            "Drug allergy: PENICILLIN",
        ]
        result = parse_allergy_texts(texts)
        assert len(result["allergies"]) == 1

    def test_empty_list(self):
        result = parse_allergy_texts([])
        assert result["status"] == "unknown"
        assert result["allergies"] == []

    def test_mixed_with_empty_strings(self):
        texts = ["", "Drug allergy(-)", ""]
        result = parse_allergy_texts(texts)
        assert result["status"] == "nka"


# ======================================================================
# Integration tests — real patient data
# ======================================================================

PATIENT_DIR = Path(__file__).resolve().parents[3] / "patient"
SNAPSHOT = "20260415_152444"


def _load_so_texts(pat_no: str) -> List[str]:
    """Load all SUBJECTIVE texts from a patient's getSO_AllPatientSeq.json."""
    import json
    so_path = PATIENT_DIR / pat_no / SNAPSHOT / "getSO_AllPatientSeq.json"
    if not so_path.exists():
        return []
    with open(so_path) as f:
        data = json.load(f)
    texts = []
    for resp in data.get("Responses", []):
        for item in resp.get("Data", []):
            subj = item.get("SUBJECTIVE", "")
            if subj:
                texts.append(subj)
    return texts


@pytest.mark.skipif(
    not PATIENT_DIR.exists(),
    reason="patient/ directory not found",
)
class TestRealPatientData:
    """用真實病人資料測試"""

    @pytest.mark.parametrize("pat_no,expected_status", [
        ("41113230", "nka"),       # Drug allergy(-)
        ("50559866", "nka"),       # Allergy NKA
        ("50617996", "nka"),       # Drug allergy -
        ("61497143", "nka"),       # ALLERGIC HX TO MEDICIN: NIL
        ("50076763", "nka"),       # no allergy to egg & vaccine / ADR(-)
    ])
    def test_known_nka_patients(self, pat_no, expected_status):
        texts = _load_so_texts(pat_no)
        assert len(texts) > 0, f"No SO data for {pat_no}"
        result = parse_allergy_texts(texts)
        assert result["status"] == expected_status, (
            f"pat {pat_no}: expected {expected_status}, got {result}"
        )

    @pytest.mark.parametrize("pat_no", [
        "35876842", "50045203", "50106179", "50161769", "50758576",
    ])
    def test_patients_with_so_but_no_allergy_mention(self, pat_no):
        """有 SO 但無過敏描述 → unknown"""
        texts = _load_so_texts(pat_no)
        if not texts:
            pytest.skip(f"No SO data for {pat_no}")
        result = parse_allergy_texts(texts)
        assert result["status"] == "unknown", (
            f"pat {pat_no}: expected unknown, got {result}"
        )

    @pytest.mark.parametrize("pat_no", [
        "13826137", "16312169", "50067505", "50669055", "50911741", "70117162",
    ])
    def test_patients_without_so_file(self, pat_no):
        """無 SO 檔案 → 空 texts → unknown"""
        texts = _load_so_texts(pat_no)
        assert texts == [], f"{pat_no} unexpectedly has SO data"
        result = parse_allergy_texts(texts)
        assert result["status"] == "unknown"

    def test_all_16_patients_no_crash(self):
        """16 位病人全跑一遍不 crash"""
        count = 0
        for pat_dir in sorted(PATIENT_DIR.iterdir()):
            snap = pat_dir / SNAPSHOT
            if not snap.exists():
                continue
            texts = _load_so_texts(pat_dir.name)
            result = parse_allergy_texts(texts)
            assert result["status"] in ("nka", "unknown", "has_allergies")
            assert isinstance(result["allergies"], list)
            count += 1
        assert count >= 16
