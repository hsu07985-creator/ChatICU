"""Eval suite for the pharmacist_polish LLM task.

Two modes:

(a) **Hermetic** (always runs, no API key needed):
    Unit tests for the scoring helpers in `pharmacist_polish_runner`.
    Covers sentence count, entity recall synonym table, report rendering.

(b) **Live** (opt-in):
    Set `RUN_PHARMACIST_POLISH_EVALS=1` and provide an LLM API key.
    Runs every case from `pharmacist_polish_cases.yaml` against the real
    `pharmacist_polish` task via `call_llm`, then scores each output with
    the 3-layer rubric and writes a timestamped markdown report to
    `backend/tests/evals/reports/{timestamp}.md`.

Run hermetic subset:
    cd backend && python3 -m pytest tests/evals/test_pharmacist_polish.py -v

Run live baseline:
    RUN_PHARMACIST_POLISH_EVALS=1 \\
    cd backend && python3 -m pytest tests/evals/test_pharmacist_polish.py -v -s
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict

import pytest

from app.config import settings

from tests.evals.pharmacist_polish_runner import (
    check_format_flags,
    count_sentences,
    entity_recall,
    load_cases,
    load_real_samples,
    load_rubric,
    render_report,
    sentence_count_preserved,
    write_report,
)


# ─── Hermetic unit tests (always run) ──────────────────────────────────────

class TestSentenceCount:
    def test_empty_is_zero(self):
        assert count_sentences("") == 0
        assert count_sentences("   \n\n ") == 0

    def test_period_split(self):
        assert count_sentences("One. Two. Three.") == 3

    def test_bullets_count_per_line(self):
        text = "- First bullet\n- Second bullet\n- Third bullet"
        assert count_sentences(text) == 3

    def test_mixed_bullets_and_periods(self):
        text = "- Due to renal impairment, please consider d/c morphine.\n- Monitor: RR."
        # Two bullets, second bullet has one sentence after colon.
        assert count_sentences(text) >= 2

    def test_preserved_within_tolerance(self):
        inp = {"s": "", "o": "", "a": "", "p": "sug D/C morphine. monitor RR."}
        out = {"s": "", "o": "", "a": "", "p": "- Please consider discontinuing Morphine. Monitor: respiratory rate."}
        ok, per = sentence_count_preserved(inp, out, tolerance=1)
        assert ok
        assert per["p"][0] > 0 and per["p"][1] > 0

    def test_preserved_rejects_large_expansion(self):
        inp = {"s": "", "o": "", "a": "", "p": "sug D/C morphine."}
        # Output expands to 5 sentences — exceeds tolerance=1.
        out = {
            "s": "", "o": "", "a": "",
            "p": "- Reason one. - Reason two. - Reason three. - Reason four. - Reason five.",
        }
        ok, _ = sentence_count_preserved(inp, out, tolerance=1)
        assert not ok


class TestEntityRecall:
    def test_all_drugs_present(self):
        expected = {"drugs": ["morphine", "fentanyl"]}
        out = {"s": "", "o": "", "a": "", "p": "Please consider discontinuing Morphine and switching to Fentanyl."}
        score, missing = entity_recall(expected, out)
        assert score == 1.0
        assert missing == []

    def test_missing_drug(self):
        expected = {"drugs": ["morphine", "fentanyl"]}
        out = {"s": "", "o": "", "a": "", "p": "Please consider discontinuing Morphine."}
        score, missing = entity_recall(expected, out)
        assert score == 0.5
        assert any("fentanyl" in m for m in missing)

    def test_rr_synonym_match(self):
        expected = {"monitors": ["RR"]}
        out = {"s": "", "o": "", "a": "", "p": "Monitor: respiratory rate."}
        score, _ = entity_recall(expected, out)
        assert score == 1.0

    def test_hh_synonym_match(self):
        expected = {"monitors": ["H&H"]}
        out = {"s": "", "o": "", "a": "", "p": "Monitor: hemoglobin and hematocrit q6h."}
        score, _ = entity_recall(expected, out)
        assert score == 1.0

    def test_lab_parens_preserved(self):
        expected = {"lab_values": ["Cr 1.8 (0.6-1.2)"]}
        out = {"s": "", "o": "Labs: Cr 1.8 (0.6-1.2), K 5.8.", "a": "", "p": ""}
        score, _ = entity_recall(expected, out)
        assert score == 1.0

    def test_abbrev_correctly_resolved_map(self):
        expected = {
            "abbreviations_correctly_resolved": {
                "d/c": "discontinue",
                "bcz": "because",
            },
        }
        out = {"s": "", "o": "", "a": "", "p": "Please consider discontinuing Aspirin because of GI bleeding."}
        score, missing = entity_recall(expected, out)
        assert score == 1.0
        assert missing == []

    def test_abbrev_d_c_must_not_be_discharge(self):
        """Regression guard: 'discharge' in output does NOT satisfy 'd/c → discontinue'."""
        expected = {"abbreviations_correctly_resolved": {"d/c": "discontinue"}}
        out = {"s": "", "o": "", "a": "", "p": "Please plan for discharge tomorrow."}
        score, _ = entity_recall(expected, out)
        assert score == 0.0


class TestFormatFlags:
    def test_numbered_bullet_pass(self):
        out = {"s": "", "o": "", "a": "", "p": "1. Please consider X.\n2. Continue to monitor Y."}
        ok, failed = check_format_flags(out, {"p_uses_numbered_bullets": True})
        assert ok and not failed

    def test_numbered_bullet_fail_when_plain_sentences(self):
        out = {"s": "", "o": "", "a": "", "p": "Please consider X. Monitor Y."}
        ok, failed = check_format_flags(out, {"p_uses_numbered_bullets": True})
        assert not ok and "p_uses_numbered_bullets" in failed

    def test_polite_phrase_and_monitor(self):
        out = {"s": "", "o": "", "a": "", "p": "1. Please consider adding X.\n2. Continue to monitor Y."}
        ok, _ = check_format_flags(
            out, {"p_has_polite_phrase": True, "p_has_monitor_line": True}
        )
        assert ok

    def test_brand_generic_in_parens(self):
        out = {"s": "", "o": "", "a": "", "p": "1. Adjust Tazocin inj (piperacillin 2 g) from q8h to q6h."}
        ok, _ = check_format_flags(out, {"drug_brand_with_generic_in_parens": True})
        assert ok

    def test_a_cites_guideline(self):
        out = {"s": "", "o": "", "a": "According to the 2026 Surviving Sepsis Campaign, vasopressors...", "p": ""}
        ok, _ = check_format_flags(out, {"a_cites_guideline": True})
        assert ok

    def test_s_o_verbatim_pass(self):
        inp = {"s": "abc", "o": "def", "a": "x", "p": "y"}
        out = {"s": "abc", "o": "def", "a": "x-polished", "p": "y-polished"}
        ok, failed = check_format_flags(out, {"s_o_verbatim": True}, input_sections=inp)
        assert ok and not failed

    def test_s_o_verbatim_fails_when_o_changed(self):
        inp = {"s": "abc", "o": "def", "a": "", "p": ""}
        out = {"s": "abc", "o": "def polished", "a": "", "p": ""}
        ok, failed = check_format_flags(out, {"s_o_verbatim": True}, input_sections=inp)
        assert not ok
        assert any("o_differs" in f for f in failed)


class TestReportRendering:
    def test_render_smoke(self, tmp_path, monkeypatch):
        # Redirect REPORTS_DIR so the real repo dir isn't touched.
        from tests.evals import pharmacist_polish_runner as r
        monkeypatch.setattr(r, "REPORTS_DIR", tmp_path)
        rubric = {"sentence_count_tolerance": 1, "entity_recall_threshold": 1.0}
        results = [
            {
                "id": "case_1",
                "name": "smoke",
                "polish_mode": "full",
                "sentence_pass": True,
                "sentence_per_section": {"p": (2, 2)},
                "recall": 1.0,
                "recall_pass": True,
                "missing_entities": [],
                "judge_pass_str": "PASS",
                "overall_pass": True,
            },
        ]
        md = render_report(run_id="20260417T000000Z", rubric=rubric, results=results)
        assert "Pharmacist Polish Eval" in md
        assert "case_1" in md
        path = write_report(md, run_id="20260417T000000Z")
        assert path.exists()
        assert path.read_text(encoding="utf-8").startswith("# Pharmacist Polish Eval")


# ─── Cases file integrity ──────────────────────────────────────────────────

class TestCasesFile:
    def test_loads_nine_seed_cases(self):
        cases = load_cases()
        assert len(cases) == 9
        ids = [c["id"] for c in cases]
        assert ids == [f"case_{i}" for i in range(1, 10)]

    def test_rubric_has_required_keys(self):
        rubric = load_rubric()
        assert "sentence_count_tolerance" in rubric
        assert "entity_recall_threshold" in rubric
        assert "judge_rubric_questions" in rubric
        assert rubric["entity_recall_threshold"] == 1.0


class TestRealSamples:
    """Validate P0.4 real pharmacist samples load cleanly and have required shape."""

    def test_three_real_samples_load(self):
        samples = load_real_samples()
        assert len(samples) == 3
        assert [s["id"] for s in samples] == ["case_10", "case_11", "case_12"]

    def test_each_real_sample_has_ground_truth_and_entities(self):
        for s in load_real_samples():
            assert s["status"] == "real", f"{s['id']} not marked real"
            gt = s.get("ground_truth_output") or {}
            for section in ("s", "o", "a", "p"):
                assert section in gt, f"{s['id']} missing ground_truth_output.{section}"
                assert isinstance(gt[section], str)
            # P section must have at least one numbered bullet
            assert gt["p"].strip(), f"{s['id']} has empty P"
            entities = s.get("entities") or {}
            assert entities.get("drugs"), f"{s['id']} has no drugs listed"

    def test_real_samples_pass_own_format_flags(self):
        """Self-consistency: ground_truth_output must satisfy its own format_flags.

        This validates that the format checkers (and the sample YAML) agree
        with each other, so the live idempotency test has a meaningful baseline.
        """
        for s in load_real_samples():
            gt = s["ground_truth_output"]
            flags = s.get("format_flags") or {}
            passes, failed = check_format_flags(gt, flags, input_sections=gt)
            assert passes, f"{s['id']} ground_truth_output fails own flags: {failed}"


# ─── Live eval (opt-in; hits real LLM) ─────────────────────────────────────

_LIVE_ENABLED = (
    os.getenv("RUN_PHARMACIST_POLISH_EVALS") == "1"
    and bool(settings.OPENAI_API_KEY)
)
_LIVE_SKIP_REASON = (
    "Set RUN_PHARMACIST_POLISH_EVALS=1 and OPENAI_API_KEY to run live baseline."
)


@pytest.mark.skipif(not _LIVE_ENABLED, reason=_LIVE_SKIP_REASON)
@pytest.mark.parametrize("case", load_cases(), ids=lambda c: c["id"])
def test_live_case(case: Dict[str, Any], request):
    """Run one pharmacist_polish case against the real LLM and record the result."""
    from app.llm import call_llm

    # Build input_data mirroring the router's pharmacist branch.
    input_data: Dict[str, Any] = {
        "patient": {},  # no patient context in hermetic-ish eval
        "polish_type": "medication_advice",
        "polish_mode": case.get("polish_mode", "full"),
        "soap_sections": case.get("input_soap_sections", {}),
        "target_section": "a_and_p",
        "format_constraints": {},
        "user_role": "pharmacist",
    }
    if case.get("polish_mode") == "refinement":
        input_data["previous_polished"] = case.get("previous_polished", "")
        input_data["user_instruction"] = case.get("user_instruction", "")

    result = call_llm(task="pharmacist_polish", input_data=input_data)
    assert result.get("status") == "success", f"LLM failed: {result.get('content', '')[:200]}"

    raw = (result.get("content") or "").strip()
    # Strip optional markdown fence.
    if raw.startswith("```"):
        raw = raw.strip("`")
        nl = raw.find("\n")
        if nl != -1 and raw[:nl].strip().isalpha():
            raw = raw[nl + 1 :]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    try:
        output_sections = json.loads(raw)
        if not isinstance(output_sections, dict):
            output_sections = {"s": "", "o": "", "a": "", "p": raw}
    except json.JSONDecodeError:
        output_sections = {"s": "", "o": "", "a": "", "p": raw}

    input_sections = case.get("input_soap_sections", {}) or {}
    # For refinement mode, baseline for sentence-count is previous_polished.
    refinement_baseline = None
    if case.get("polish_mode") == "refinement" and case.get("previous_polished"):
        refinement_baseline = {"s": "", "o": "", "a": "", "p": case["previous_polished"]}
    sentence_pass, per_section = sentence_count_preserved(
        input_sections, output_sections, tolerance=1,
        refinement_baseline=refinement_baseline,
    )
    recall, missing = entity_recall(case.get("expected_entities") or {}, output_sections)
    recall_pass = recall >= load_rubric().get("entity_recall_threshold", 1.0)

    # Stash per-case result on the session for the summary hook.
    bucket = request.config.stash.setdefault("pharmacist_polish_results", [])  # type: ignore[attr-defined]
    bucket.append({
        "id": case["id"],
        "name": case.get("name", ""),
        "polish_mode": case.get("polish_mode", "full"),
        "sentence_pass": sentence_pass,
        "sentence_per_section": per_section,
        "recall": recall,
        "recall_pass": recall_pass,
        "missing_entities": missing,
        "judge_pass_str": "not-run",
        "overall_pass": sentence_pass and recall_pass,
        "input_sections": input_sections,
        "output_sections": output_sections,
    })

    # Soft assertion: we want the full report even on failure.
    assert sentence_pass, f"Sentence count exceeded tolerance: {per_section}"
    assert recall_pass, f"Entity recall {recall:.2%} below threshold; missing={missing}"


# ─── Live idempotency eval for P0.4 real samples ──────────────────────────

@pytest.mark.skipif(not _LIVE_ENABLED, reason=_LIVE_SKIP_REASON)
@pytest.mark.parametrize("case", load_real_samples(), ids=lambda c: c["id"])
def test_live_real_sample_idempotency(case: Dict[str, Any], request):
    """Feed a pharmacist ground-truth output back through polish and verify
    entities + format_flags survive (near-identity / idempotency check).

    This tests that the polish prompt does not *degrade* already-clean input.
    """
    from app.llm import call_llm

    gt = case["ground_truth_output"]
    input_sections = {k: gt.get(k, "") for k in ("s", "o", "a", "p")}
    input_data: Dict[str, Any] = {
        "patient": {},
        "polish_type": "medication_advice",
        "polish_mode": "full",
        "soap_sections": input_sections,
        "target_section": "a_and_p",
        "format_constraints": {},
        "user_role": "pharmacist",
    }

    result = call_llm(task="pharmacist_polish", input_data=input_data)
    assert result.get("status") == "success", f"LLM failed: {result.get('content', '')[:200]}"

    raw = (result.get("content") or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        nl = raw.find("\n")
        if nl != -1 and raw[:nl].strip().isalpha():
            raw = raw[nl + 1 :]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    try:
        output_sections = json.loads(raw)
        if not isinstance(output_sections, dict):
            output_sections = {"s": "", "o": "", "a": "", "p": raw}
    except json.JSONDecodeError:
        output_sections = {"s": "", "o": "", "a": "", "p": raw}

    # Layer 1: sentence count — clean input should not balloon.
    sentence_pass, per_section = sentence_count_preserved(
        input_sections, output_sections, tolerance=1
    )
    # Layer 2: entity recall against `entities` bucket.
    recall, missing = entity_recall(case.get("entities") or {}, output_sections)
    recall_pass = recall >= load_rubric().get("entity_recall_threshold", 1.0)
    # Layer 2b: format flags declared on the sample.
    format_pass, failed_flags = check_format_flags(
        output_sections,
        case.get("format_flags") or {},
        input_sections=input_sections,
    )

    overall = sentence_pass and recall_pass and format_pass

    bucket = request.config.stash.setdefault("pharmacist_polish_results", [])  # type: ignore[attr-defined]
    bucket.append({
        "id": case["id"],
        "name": case.get("name", ""),
        "polish_mode": "full(idempotency)",
        "sentence_pass": sentence_pass,
        "sentence_per_section": per_section,
        "recall": recall,
        "recall_pass": recall_pass,
        "missing_entities": missing,
        "judge_pass_str": "n/a",
        "overall_pass": overall,
        "input_sections": input_sections,
        "output_sections": output_sections,
        "failed_format_flags": failed_flags,
    })

    assert sentence_pass, f"Sentence count drift: {per_section}"
    assert recall_pass, f"Entity recall {recall:.2%} below threshold; missing={missing}"
    assert format_pass, f"Format flags violated: {failed_flags}"


# ─── Report hook: dump aggregate at end of live run ────────────────────────

if _LIVE_ENABLED:
    @pytest.fixture(scope="session", autouse=True)
    def _dump_report(request):
        yield
        results = request.config.stash.get("pharmacist_polish_results", [])  # type: ignore[attr-defined]
        if not results:
            return
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        md = render_report(run_id=run_id, rubric=load_rubric(), results=results)
        path = write_report(md, run_id=run_id)
        print(f"\n[pharmacist_polish] report written → {path}\n")
