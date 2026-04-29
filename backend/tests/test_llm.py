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
