"""Tests for the LLM-citation post-stream audit module."""

import pytest

from app.services.citation_audit import (
    audit_citations,
    extract_citations,
    summarize_suspects,
)


ACTIVE_ALIASES = [
    # brand names
    "Meropenem", "Tygacil", "Levophed", "Pantoloc", "Insulin", "Acetal",
    # generic names that the LLM might use instead of the brand
    "tigecycline", "norepinephrine", "pantoprazole", "tramadol",
]


# ---------------------------------------------------------------------------
# extract_citations
# ---------------------------------------------------------------------------


def test_extract_chinese_paren_citation():
    txt = "建議調整劑量（依【用藥】Meropenem 2.0 瓶 q12h IV）以避免累積。"
    cits = extract_citations(txt)
    assert len(cits) == 1
    assert cits[0]["section"] == "用藥"
    assert cits[0]["content"] == "Meropenem 2.0 瓶 q12h IV"


def test_extract_ascii_paren_tolerated():
    txt = "lab shows (依【關鍵檢驗】eGFR 7.97, 2026-04-26 22:30) renal impairment"
    cits = extract_citations(txt)
    assert len(cits) == 1
    assert cits[0]["section"] == "關鍵檢驗"
    assert "eGFR" in cits[0]["content"]


def test_extract_multiple_citations_in_order():
    txt = (
        "腎功能下降（依【關鍵檢驗】eGFR 7.97），"
        "目前抗生素為 meropenem（依【用藥】Meropenem 2.0 瓶 q12h IV）。"
    )
    cits = extract_citations(txt)
    assert [c["section"] for c in cits] == ["關鍵檢驗", "用藥"]


def test_extract_empty_reply():
    assert extract_citations("") == []
    assert extract_citations(None) == []  # type: ignore[arg-type]


def test_extract_no_citations_in_normal_text():
    assert extract_citations("這位病人需要監測 seizure 風險。") == []


# ---------------------------------------------------------------------------
# audit_citations — valid citations should not be flagged
# ---------------------------------------------------------------------------


def test_legit_drug_citation_brand_name_passes():
    reply = "繼續使用（依【用藥】Meropenem 2.0 瓶 q12h IV）"
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert result["total"] == 1
    assert result["by_section"] == {"用藥": 1}
    assert result["suspects"] == []


def test_legit_drug_citation_generic_name_passes():
    """LLM cites generic name; should pass because we feed it as an alias."""
    reply = "建議停用（依【用藥】tigecycline 1g q12h）"
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert result["suspects"] == []


def test_lab_citation_counted_but_not_flagged():
    """[關鍵檢驗] is in scope as a known section but not strictly
    validated yet — should be counted, not flagged."""
    reply = "腎功能差（依【關鍵檢驗】肌酸酐 6.52，2026-04-26 22:30）"
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert result["total"] == 1
    assert result["by_section"] == {"關鍵檢驗": 1}
    assert result["suspects"] == []


# ---------------------------------------------------------------------------
# audit_citations — fabrications must be flagged
# ---------------------------------------------------------------------------


def test_fabricated_drug_citation_flagged():
    """The motivating failure mode: LLM cites a drug that is NOT in the
    patient's active med list. This is the meropenem-class incident in
    reverse — LLM hallucinating a regimen."""
    reply = "病人正在使用（依【用藥】Vancomycin 1g IV q8h）"
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert len(result["suspects"]) == 1
    s = result["suspects"][0]
    assert s["section"] == "用藥"
    assert s["token"] == "Vancomycin"
    assert s["reason"] == "drug_not_in_active_meds"


def test_unknown_section_flagged():
    reply = "其他考量（依【病史】慢性腎衰竭）"
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert any(
        s["reason"].startswith("unknown_section:")
        for s in result["suspects"]
    )


def test_mixed_legit_and_fabricated():
    reply = (
        "建議調整（依【用藥】Meropenem 2.0 瓶 q12h IV），"
        "但避免併用（依【用藥】Imipenem 500mg q6h）。"
    )
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert result["total"] == 2
    fabricated = [s for s in result["suspects"]
                  if s["reason"] == "drug_not_in_active_meds"]
    assert len(fabricated) == 1
    assert fabricated[0]["token"] == "Imipenem"


# ---------------------------------------------------------------------------
# edge cases
# ---------------------------------------------------------------------------


def test_empty_drug_aliases():
    """Defensive: empty alias list should NOT crash. Any 用藥 citation
    becomes a suspect because nothing matches."""
    reply = "（依【用藥】Meropenem 2.0 瓶 q12h IV）"
    result = audit_citations(reply, [])
    assert len(result["suspects"]) == 1


def test_case_insensitive_drug_match():
    reply = "（依【用藥】MEROPENEM 2.0 瓶 q12h IV）"
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert result["suspects"] == []


# ---------------------------------------------------------------------------
# summarize_suspects helper
# ---------------------------------------------------------------------------


def test_summarize_suspects_one_line():
    suspects = [
        {"section": "用藥", "token": "Imipenem",
         "reason": "drug_not_in_active_meds", "content": "...", "raw": "..."},
        {"section": "病史", "token": "慢性腎衰竭",
         "reason": "unknown_section:病史", "content": "...", "raw": "..."},
    ]
    summary = summarize_suspects(suspects)
    assert summary is not None
    assert "用藥=Imipenem" in summary
    assert "病史=慢性腎衰竭" in summary


def test_summarize_suspects_empty_returns_none():
    assert summarize_suspects([]) is None
