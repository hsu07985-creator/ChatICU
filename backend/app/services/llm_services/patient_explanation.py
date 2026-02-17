"""Patient explanation service — LLM-powered via app.llm."""

from typing import Optional

from app.llm import call_llm


_READING_LEVEL_MAP = {
    "simple": "用最簡單的日常用語，避免所有醫學術語，如同對小學六年級學生解釋。",
    "moderate": "用一般大眾能理解的語言，必要時簡短解釋醫學名詞。",
    "detailed": "提供詳細完整的說明，可使用醫學術語但附帶中文解釋，適合有醫學背景的家屬。",
}


def generate_patient_explanation(
    patient_data: dict,
    topic: str = "",
    reading_level: Optional[str] = None,
) -> dict:
    """Rewrite clinical info in patient-friendly language.

    Args:
        patient_data: Patient dict with diagnoses, medications, etc.
        topic: Optional focus area (e.g., "medications", "diagnosis").
        reading_level: Optional "simple"|"moderate"|"detailed".

    Returns:
        {"explanation": str, "metadata": dict}
    """
    input_data = {**patient_data}
    if topic:
        input_data["focus_topic"] = topic
    if reading_level and reading_level in _READING_LEVEL_MAP:
        input_data["reading_level_instruction"] = _READING_LEVEL_MAP[reading_level]

    result = call_llm(task="patient_explanation", input_data=input_data)
    if result["status"] != "success":
        raise RuntimeError(f"LLM call failed: {result['content']}")
    return {
        "explanation": result["content"],
        "metadata": result["metadata"],
    }
