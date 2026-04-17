"""Test LLM config in app.llm."""

from app.llm import TASK_PROMPTS, call_llm, embed_texts


def test_call_llm_exists():
    assert callable(call_llm)


def test_task_prompts_defined():
    expected = ["clinical_summary", "patient_explanation", "guideline_interpretation",
                "multi_agent_decision", "rag_generation"]
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
    assert "Do NOT write paragraphs of background or pharmacology." in prompt
    assert "extended monitoring plans" not in prompt


def test_medication_advice_route_fidelity():
    """Regression: the clinical_polish prompt must forbid inferring a route
    when the draft did not specify one (e.g. '2 bot qod' must stay as written).
    """
    prompt = TASK_PROMPTS["clinical_polish"]
    assert "ROUTE FIDELITY" in prompt
    assert "do NOT infer IV/PO" in prompt
