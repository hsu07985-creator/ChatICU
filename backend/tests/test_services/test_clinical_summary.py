"""Test clinical summary service."""

from unittest.mock import patch


def test_generate_clinical_summary_success():
    mock_response = {
        "status": "success",
        "content": "Clinical summary for test patient.",
        "metadata": {"model": "gpt-4o"},
    }
    with patch("app.services.llm_services.clinical_summary.call_llm", return_value=mock_response):
        from app.services.llm_services.clinical_summary import generate_clinical_summary
        result = generate_clinical_summary({"id": "pat_001", "name": "Test"})
        assert "summary" in result
        assert result["summary"] == "Clinical summary for test patient."


def test_generate_clinical_summary_failure():
    mock_response = {"status": "error", "content": "API error", "metadata": {}}
    with patch("app.services.llm_services.clinical_summary.call_llm", return_value=mock_response):
        from app.services.llm_services.clinical_summary import generate_clinical_summary
        try:
            generate_clinical_summary({"id": "pat_001"})
            assert False, "Should have raised RuntimeError"
        except RuntimeError:
            pass
