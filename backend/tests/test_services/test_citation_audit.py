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


def test_snapshot_section_citations_not_flagged():
    """T2 regression (2026-07-10 audit): 【患者基本】/【用藥安全摘要】 are
    real snapshot sections the LLM sees every turn — citing them was
    being written to audit_logs as fabrication_suspected."""
    reply = (
        "病人 65 歲（依【患者基本】吳佳旺，65 歲男性）。"
        "已知 4 條警示（依【用藥安全摘要】carbapenem 類重複）。"
        "腎功能極差（依【腎功能/給藥摘要】eGFR 7.97）。"
        "尚未插管（依【呼吸器】無資料）。"
        "評分中等（依【臨床評分】SOFA 9）。"
        "檢驗停在四月底（依【資料狀態】最新檢驗 2026-04-26）。"
    )
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert result["suspects"] == []
    assert result["total"] == 6


def test_parameterized_prefetch_section_citations_not_flagged():
    """Prefetch context blocks carry parameterized titles —
    【微生物培養 最近14天】,【最近72小時用藥變更】 etc. Citing them
    (with or without the qualifier) must not be flagged."""
    reply = (
        "血液培養陰性（依【微生物培養 最近14天】2026-04-20 blood）。"
        "近期無異動（依【最近72小時用藥變更】無資料）。"
        "報告見前（依【診斷/影像報告 最近14天】胸部X光）。"
        "藥師已建議（依【藥師建議歷史 最近30天】renal dosing）。"
        "影像如前述（依【影像/報告 最近3筆】2026-04-26 胸腔檢查）。"
    )
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert result["suspects"] == []


def test_whitelist_covers_every_emitted_section_title():
    """Anti-drift: every 【title】 literal emitted by the three context
    builders must be recognised by the audit whitelist, so a newly added
    snapshot section can never re-open the T2 false-positive hole."""
    import re
    from pathlib import Path

    from app.services.citation_audit import _section_is_known
    import app.services.patient_context_builder.formatters as formatters
    import app.services.patient_context_builder.safety as safety
    import app.services.ai_question_prefetch as prefetch

    title_re = re.compile(r"【([^】{}\[\]()\\^|+*?]+?)】")
    for mod in (formatters, safety, prefetch):
        src = Path(mod.__file__).read_text(encoding="utf-8")
        for title in title_re.findall(src):
            rendered = title.replace("{days}", "14").replace("{hours}", "72")
            assert _section_is_known(rendered), (
                f"{mod.__name__} emits 【{rendered}】 "
                "but citation-audit whitelist does not recognise it"
            )


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


def test_lab_citation_without_any_value_flagged():
    """T5 (llm-2, safe subset): 關鍵檢驗/生命徵象 citations must carry a
    verifiable number (the prompt's citation format always includes the
    value). A digit-less citation is the LLM sounding grounded without
    saying anything checkable. Full value-vs-snapshot validation stays
    deferred until we have a lab-alias glossary (see module docstring)."""
    reply = "腎功能不佳（依【關鍵檢驗】腎功能指標異常）"
    result = audit_citations(reply, ACTIVE_ALIASES)
    assert len(result["suspects"]) == 1
    assert result["suspects"][0]["reason"] == "no_value_in_citation"

    reply2 = "血壓偏低（依【生命徵象】血壓持續下降）"
    result2 = audit_citations(reply2, ACTIVE_ALIASES)
    assert result2["suspects"][0]["reason"] == "no_value_in_citation"


def test_lab_citation_with_value_still_passes():
    reply = "腎功能差（依【關鍵檢驗】肌酸酐 6.52，2026-04-26 22:30）"
    assert audit_citations(reply, ACTIVE_ALIASES)["suspects"] == []
    reply2 = "心搏過速（依【生命徵象】心率 121 次/分）"
    assert audit_citations(reply2, ACTIVE_ALIASES)["suspects"] == []


def test_report_and_snapshot_sections_stay_count_only():
    """影像/報告 and the other snapshot sections are free text — no value
    requirement there."""
    reply = (
        "影像顯示浸潤（依【影像/報告】胸腔檢查顯示雙側浸潤）。"
        "病人臥床（依【患者基本】長期臥床）。"
    )
    assert audit_citations(reply, ACTIVE_ALIASES)["suspects"] == []


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
