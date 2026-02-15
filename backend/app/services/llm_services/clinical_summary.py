"""Clinical summary service — LLM-powered via app.llm."""

from app.llm import call_llm


def generate_clinical_summary(patient_data: dict) -> dict:
    """Generate a clinical summary for a patient using LLM.

    Args:
        patient_data: Full patient dict including diagnoses, medications, lab_results.

    Returns:
        {"summary": str, "metadata": dict}
    """
    result = call_llm(task="clinical_summary", input_data=patient_data)
    if result["status"] != "success":
        raise RuntimeError(f"LLM call failed: {result['content']}")
    return {
        "summary": result["content"],
        "metadata": result["metadata"],
    }
