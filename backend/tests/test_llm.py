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
