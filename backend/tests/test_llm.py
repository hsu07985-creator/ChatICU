"""Test LLM config in app.llm."""

from app.llm import TASK_PROMPTS, call_llm, embed_texts


def test_call_llm_exists():
    assert callable(call_llm)


def test_task_prompts_defined():
    # RAG-era keys (patient_explanation / guideline_interpretation /
    # multi_agent_decision / rag_generation / citation_summary /
    # safety_check / conversation_compress / agentic_rag_router /
    # contextual_chunk) were removed in Phase 1. Surviving keys are the
    # ones consumed by /api/v1/clinical/* (LLM-only routes) and /ai/chat.
    expected = ["clinical_summary", "clinical_polish",
                "pharmacist_polish", "icu_chat"]
    for task in expected:
        assert task in TASK_PROMPTS


def test_unknown_task_returns_error():
    result = call_llm(task="nonexistent_task", input_data={})
    assert result["status"] == "error"
    assert "Unknown task" in result["content"]


def test_medication_advice_preserves_monitoring_items():
    """Regression: the clinical_polish prompt must tell the LLM to keep draft
    monitoring/follow-up bullets (previously dropped as 'extended monitoring plans').
    """
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "PRESERVE every bullet the pharmacist wrote" in prompt
    assert "Monitor:" in prompt
    assert "Never silently drop a draft bullet." in prompt
    assert "extended monitoring plans" not in prompt


def test_medication_advice_preserves_reason_clause():
    """Regression: medication_advice polish must keep the pharmacist's stated
    rationale/reason. Earlier wording ('Concise recommendation only', 'at most ONE
    short rationale line', 'Do NOT write paragraphs of background') caused the LLM
    to drop reason clauses like 'In view of elevated blood sugar even under Trajenta
    and Glitis'. The new prompt must explicitly preserve the reason and require the
    '<reason>, please consider <action>' shape.
    """
    prompt = TASK_PROMPTS["clinical_polish"]
    # New preservation rules must be present
    assert "rationale/reason clause" in prompt
    assert "Reason FIRST" in prompt
    assert "Never drop the reason" in prompt
    # Old over-trim rules must be gone
    assert "Concise recommendation only" not in prompt
    assert "at most ONE short rationale" not in prompt
    assert "Do NOT write paragraphs of background or pharmacology" not in prompt


def test_medication_advice_route_fidelity():
    """Regression: the clinical_polish prompt must forbid inferring a route
    when the draft did not specify one (e.g. '2 bot qod' must stay as written).
    """
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "ROUTE FIDELITY" in prompt
    assert "do NOT infer IV/PO" in prompt


def test_clinical_polish_strict_fact_rule():
    """Active medications in patient JSON must NOT leak into the polished output
    unless the draft explicitly mentions them. Earlier C2 incident: nursing draft
    silent on sedation → AI auto-filled `Fresofol` from patient.medications."""
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "STRICT FACT-RULE" in prompt
    assert "active medication list is for cross-checking, not auto-fill" in prompt
    assert "never substitute a number from patient.vital_signs" in prompt


def test_clinical_polish_no_safety_warning_injection():
    """Polish is text formatting only. Earlier additions (drug-name verification
    warnings, Beers geriatric warnings, Cockcroft-Gault auto-annotation) violated
    the feature's stated contract ('AI 只修文法不增減你寫的內容') and would
    contaminate HIS records when copy-pasted. Clinical second-opinion belongs
    in the AI chat feature, not here."""
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "Polish is text formatting only" in prompt
    assert "clinical second-opinion belongs in the AI clinical-chat feature" in prompt
    # The rolled-back rule HEADERS (instruction-level) must be gone — the prompt
    # may still mention "Beers" / "Cockcroft-Gault" inside the negative rule that
    # explicitly forbids injecting those, which is intentional.
    assert "DRUG NAME VERIFICATION" not in prompt
    assert "GERIATRIC SAFETY CHECK" not in prompt
    assert "RENAL DOSE HELPER" not in prompt
    # No instruction to actually compute or emit Beers/Cockcroft-Gault content
    assert "高齡用藥提醒" not in prompt
    assert "藥名待確認" not in prompt
    assert "Cockcroft-Gault 估算" not in prompt


def test_clinical_polish_no_placeholder_fallbacks():
    """Earlier '(no numeric values available)' placeholder leaked into polished
    output. Prompt must explicitly forbid these fallback phrases."""
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "NO PLACEHOLDER FALLBACKS" in prompt
    assert "(no numeric values available)" in prompt
    assert "(尚未量測)" in prompt
    assert "Empty is fine; placeholder is not" in prompt


def test_clinical_polish_punctuation_consistency():
    """Mixed full-width + half-width punctuation in same sentence is unprofessional."""
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "PUNCTUATION CONSISTENCY" in prompt
    assert "「，。：；」" in prompt


def test_clinical_polish_language_follows_draft():
    """SOAP / medication_advice must NOT force English regardless of draft language.
    Earlier: Chinese draft + SOAP template → forced English output, unsuitable for
    Taiwan HIS where mixed Chinese/English is normal."""
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "match the dominant language of the draft" in prompt
    # nursing_record stays Chinese (intentional)
    assert "nursing_record → Traditional Chinese" in prompt
    # progress_note must NOT be unconditionally English anymore
    assert "progress_note → clean professional English (the style" not in prompt


def test_pharmacist_polish_preserves_reason_clause():
    """Regression: pharmacist_polish (used by PharmacistSoapEditor) must keep
    the pharmacist's stated rationale/reason. Earlier the PRESERVATION rule
    listed only drug/dose/lab/monitoring but omitted rationale, so descriptive
    reasons (e.g. 'In view of elevated blood sugar even under Trajenta and Glitis')
    were dropped at polish time. New rules must (a) include rationale in the
    do-not-remove list, (b) explicitly forbid dropping a written reason in the
    drug-change shape, and (c) provide a few-shot example covering the failure case.
    """
    prompt = TASK_PROMPTS["pharmacist_polish"]
    # Preservation rule must list rationale/reason
    assert "rationale/reason" in prompt
    # Explicit "never drop reason" guidance in drug-change shape
    assert "NEVER drop the reason" in prompt
    # Few-shot anchor for descriptive reasons
    assert "In view of suboptimal glycemic control" in prompt
    # SELF-CHECK list must include the reason check
    assert "reason/rationale clause" in prompt
    # Old hard cap on reason length must be gone (was the cause of trimming)
    assert "≤20 words" not in prompt
