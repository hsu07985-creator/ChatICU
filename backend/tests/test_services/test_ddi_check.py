"""Tests for app.utils.ddi_check — DDI auto-check utility."""

from unittest.mock import patch, MagicMock

from app.utils.ddi_check import extract_ddi_warnings, format_ddi_metadata


def _mock_patient_context(med_names):
    return {
        "medications": [
            {"name": n, "genericName": n} for n in med_names
        ],
    }


class TestExtractDdiWarnings:
    def test_returns_empty_when_no_context(self):
        assert extract_ddi_warnings(None) == []

    def test_returns_empty_when_no_medications(self):
        assert extract_ddi_warnings({"medications": []}) == []

    def test_returns_empty_when_single_med(self):
        ctx = _mock_patient_context(["Aspirin"])
        assert extract_ddi_warnings(ctx) == []

    @patch("app.utils.ddi_check.drug_graph_bridge")
    def test_returns_empty_when_bridge_not_ready(self, mock_bridge):
        mock_bridge.is_ready.return_value = False
        ctx = _mock_patient_context(["Aspirin", "Warfarin"])
        assert extract_ddi_warnings(ctx) == []

    @patch("app.utils.ddi_check.drug_graph_bridge")
    def test_returns_high_risk_interactions(self, mock_bridge):
        mock_bridge.is_ready.return_value = True
        mock_bridge.search_interactions.return_value = [
            {"riskLevel": "X", "drug1": "Aspirin", "drug2": "Warfarin",
             "severity": "contraindicated", "management": "Avoid combination"},
        ]
        ctx = _mock_patient_context(["Aspirin", "Warfarin"])
        result = extract_ddi_warnings(ctx)
        assert len(result) == 1
        assert result[0]["riskLevel"] == "X"
        mock_bridge.search_interactions.assert_called_once_with(
            drug_a="Aspirin", drug_b="Warfarin", page=1, limit=3,
        )

    @patch("app.utils.ddi_check.drug_graph_bridge")
    def test_filters_low_risk(self, mock_bridge):
        mock_bridge.is_ready.return_value = True
        mock_bridge.search_interactions.return_value = [
            {"riskLevel": "B", "drug1": "A", "drug2": "B", "severity": "minor"},
        ]
        ctx = _mock_patient_context(["DrugA", "DrugB"])
        result = extract_ddi_warnings(ctx)
        assert len(result) == 0

    @patch("app.utils.ddi_check.drug_graph_bridge")
    def test_deduplicates_drug_names(self, mock_bridge):
        mock_bridge.is_ready.return_value = True
        mock_bridge.search_interactions.return_value = []
        ctx = _mock_patient_context(["Aspirin", "aspirin", "ASPIRIN", "Warfarin"])
        extract_ddi_warnings(ctx)
        # Should only check one pair (Aspirin, Warfarin), not 3
        assert mock_bridge.search_interactions.call_count == 1

    @patch("app.utils.ddi_check.drug_graph_bridge")
    def test_handles_search_exception(self, mock_bridge):
        mock_bridge.is_ready.return_value = True
        mock_bridge.search_interactions.side_effect = RuntimeError("graph error")
        ctx = _mock_patient_context(["DrugA", "DrugB"])
        result = extract_ddi_warnings(ctx)
        assert result == []

    @patch("app.utils.ddi_check.drug_graph_bridge")
    def test_prefers_generic_name(self, mock_bridge):
        mock_bridge.is_ready.return_value = True
        mock_bridge.search_interactions.return_value = []
        ctx = {
            "medications": [
                {"name": "BrandA", "genericName": "GenericA"},
                {"name": "BrandB", "genericName": "GenericB"},
            ],
        }
        extract_ddi_warnings(ctx)
        mock_bridge.search_interactions.assert_called_once_with(
            drug_a="GenericA", drug_b="GenericB", page=1, limit=3,
        )


class TestFormatDdiMetadata:
    def test_empty_warnings(self):
        assert format_ddi_metadata([]) == ""

    def test_formats_warnings(self):
        warnings = [
            {"riskLevel": "X", "drug1": "A", "drug2": "B",
             "severity": "contraindicated", "management": "Stop A"},
        ]
        result = format_ddi_metadata(warnings)
        assert "[藥物交互作用警示]" in result
        assert "共 1 筆高風險" in result
        assert "[X] A ↔ B" in result
        assert "Stop A" in result
