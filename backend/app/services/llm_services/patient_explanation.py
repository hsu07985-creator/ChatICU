"""Patient explanation service — LLM-powered via app.llm."""

from app.llm import call_llm


def generate_patient_explanation(patient_data: dict, topic: str = "") -> dict:
    """Rewrite clinical info in patient-friendly language.

    Args:
        patient_data: Patient dict with diagnoses, medications, etc.
        topic: Optional focus area (e.g., "medications", "diagnosis").

    Returns:
        {"explanation": str, "metadata": dict}
    """
    input_data = {**patient_data}
    if topic:
        input_data["focus_topic"] = topic

    result = call_llm(task="patient_explanation", input_data=input_data)
    if result["status"] != "success":
        raise RuntimeError(f"LLM call failed: {result['content']}")
    return {
        "explanation": result["content"],
        "metadata": result["metadata"],
    }
