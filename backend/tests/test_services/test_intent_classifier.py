"""Tests for rule-based intent classifier (B01)."""

import pytest

from app.services.intent_classifier import (
    IntentResult,
    classify_intent,
    detect_drugs_from_text,
)


class TestDrugDetection:
    """Test drug name detection from text."""

    def test_detect_known_drug(self):
        drugs = detect_drugs_from_text("Propofol dose for ICU patient")
        assert "Propofol" in [d.lower().capitalize() for d in drugs] or \
               any("propofol" == d.lower() for d in drugs)

    def test_detect_multiple_drugs(self):
        drugs = detect_drugs_from_text("Warfarin and Aspirin interaction")
        lower_drugs = [d.lower() for d in drugs]
        assert "warfarin" in lower_drugs
        assert "aspirin" in lower_drugs

    def test_detect_generic_drug_pattern(self):
        drugs = detect_drugs_from_text("What about Amoxicillin?")
        lower_drugs = [d.lower() for d in drugs]
        assert "amoxicillin" in lower_drugs

    def test_detect_no_drugs_in_general_text(self):
        drugs = detect_drugs_from_text("What is the best sedation protocol?")
        assert len(drugs) == 0

    def test_detect_taiwan_brand_names(self):
        drugs = detect_drugs_from_text("Precedex 用法")
        lower_drugs = [d.lower() for d in drugs]
        assert "precedex" in lower_drugs

    def test_empty_text(self):
        assert detect_drugs_from_text("") == []
        assert detect_drugs_from_text(None) == []


class TestDoseCalculation:
    """Test dose_calculation intent classification."""

    def test_dose_with_drug_english(self):
        result = classify_intent("Propofol dose for 80kg patient")
        assert result.intent == "dose_calculation"
        assert result.confidence >= 0.80
        assert any("propofol" == d.lower() for d in result.detected_drugs)

    def test_dose_with_drug_chinese(self):
        result = classify_intent("Vancomycin 腎功能不全劑量調整")
        assert result.intent == "dose_calculation"
        assert result.confidence >= 0.80

    def test_dose_mg_kg_pattern(self):
        result = classify_intent("Fentanyl 2 mcg/kg/hr dosing")
        assert result.intent == "dose_calculation"
        assert result.confidence >= 0.80


class TestPairInteraction:
    """Test pair_interaction intent classification."""

    def test_two_drugs_interaction_explicit(self):
        result = classify_intent("Warfarin and Aspirin interaction")
        assert result.intent == "pair_interaction"
        assert result.confidence >= 0.85
        assert len(result.detected_drugs) >= 2

    def test_two_drugs_implicit(self):
        result = classify_intent("Can I combine Propofol with Midazolam?")
        assert result.intent == "pair_interaction"
        assert len(result.detected_drugs) == 2

    def test_two_drugs_default_pair(self):
        """Two drugs detected without specific keywords defaults to pair interaction."""
        result = classify_intent("Propofol Midazolam")
        assert result.intent == "pair_interaction"
        assert result.confidence >= 0.70


class TestMultiDrugRx:
    """Test multi_drug_rx intent classification."""

    def test_three_drugs(self):
        result = classify_intent(
            "Check Aspirin, Clopidogrel, and Rivaroxaban together"
        )
        assert result.intent == "multi_drug_rx"
        assert result.confidence >= 0.80
        assert len(result.detected_drugs) >= 3


class TestIVCompatibility:
    """Test iv_compatibility intent classification."""

    def test_compatibility_english(self):
        result = classify_intent("Propofol and Fentanyl Y-Site compatibility")
        assert result.intent == "iv_compatibility"
        assert result.confidence >= 0.80

    def test_compatibility_chinese(self):
        result = classify_intent("Dexmedetomidine 管路相容性")
        assert result.intent == "iv_compatibility"
        assert result.confidence >= 0.80


class TestNHIReimbursement:
    """Test nhi_reimbursement intent classification."""

    def test_nhi_chinese(self):
        result = classify_intent("Pembrolizumab 肺癌健保給付條件")
        assert result.intent == "nhi_reimbursement"
        assert result.confidence >= 0.85

    def test_nhi_english(self):
        result = classify_intent("NHI reimbursement for pembrolizumab")
        assert result.intent == "nhi_reimbursement"
        assert result.confidence >= 0.85


class TestClinicalGuideline:
    """Test clinical_guideline intent classification."""

    def test_guideline_english(self):
        result = classify_intent("PADIS guideline sedation target")
        assert result.intent == "clinical_guideline"
        assert result.confidence >= 0.75

    def test_guideline_chinese(self):
        result = classify_intent("2025 鎮靜指引建議")
        assert result.intent == "clinical_guideline"
        assert result.confidence >= 0.75


class TestPatientEducation:
    """Test patient_education intent classification."""

    def test_education_chinese(self):
        result = classify_intent("Warfarin 衛教")
        assert result.intent == "patient_education"
        assert result.confidence >= 0.75

    def test_education_explain(self):
        result = classify_intent("Aspirin 是什麼 為什麼要吃")
        assert result.intent == "patient_education"
        assert result.confidence >= 0.70


class TestDrugMonograph:
    """Test drug_monograph intent classification."""

    def test_monograph_side_effects(self):
        result = classify_intent("Propofol 副作用")
        assert result.intent == "drug_monograph"
        assert result.confidence >= 0.75

    def test_monograph_contraindications(self):
        result = classify_intent("Midazolam 禁忌")
        assert result.intent == "drug_monograph"
        assert result.confidence >= 0.75


class TestDrugComparison:
    """Test drug_comparison intent classification."""

    def test_comparison_vs(self):
        result = classify_intent("Atorvastatin vs Rosuvastatin")
        assert result.intent == "drug_comparison"
        assert result.confidence >= 0.80
        assert len(result.detected_drugs) >= 2

    def test_comparison_chinese(self):
        result = classify_intent("Propofol 和 Midazolam 比較")
        assert result.intent == "drug_comparison"
        assert result.confidence >= 0.80


class TestClinicalSummary:
    """Test clinical_summary intent classification."""

    def test_summary_english(self):
        result = classify_intent("Give me a clinical summary")
        assert result.intent == "clinical_summary"
        assert result.confidence >= 0.80

    def test_summary_chinese(self):
        result = classify_intent("病歷摘要")
        assert result.intent == "clinical_summary"
        assert result.confidence >= 0.80


class TestClinicalDecision:
    """Test clinical_decision intent classification."""

    def test_decision_should_we(self):
        result = classify_intent("Should we escalate vasopressor therapy?")
        assert result.intent == "clinical_decision"
        assert result.confidence >= 0.70

    def test_decision_chinese(self):
        result = classify_intent("該不該停用抗生素")
        assert result.intent == "clinical_decision"
        assert result.confidence >= 0.70


class TestSingleDrugInteractions:
    """Test single_drug_interactions intent classification."""

    def test_single_drug_interaction(self):
        result = classify_intent("Warfarin 交互作用")
        assert result.intent == "single_drug_interactions"
        assert result.confidence >= 0.80
        assert len(result.detected_drugs) == 1


class TestGeneralPharmacology:
    """Test general_pharmacology fallback."""

    def test_ambiguous_query(self):
        result = classify_intent("Tell me more about this topic please")
        assert result.intent == "general_pharmacology"
        assert result.confidence <= 0.50

    def test_empty_query(self):
        result = classify_intent("")
        assert result.intent == "general_pharmacology"
        assert result.confidence <= 0.20


class TestIntentResultModel:
    """Test IntentResult Pydantic model."""

    def test_valid_result(self):
        r = IntentResult(
            intent="dose_calculation",
            confidence=0.88,
            detected_drugs=["Propofol"],
            stage="rule_based",
        )
        assert r.intent == "dose_calculation"
        assert r.confidence == 0.88
        assert r.detected_drugs == ["Propofol"]
        assert r.stage == "rule_based"

    def test_default_stage(self):
        r = IntentResult(intent="dose_calculation", confidence=0.5, detected_drugs=[])
        assert r.stage == "rule_based"


class TestProvidedDrugs:
    """Test that pre-detected drugs are used correctly."""

    def test_provided_drugs_override(self):
        result = classify_intent(
            "Check dosage", detected_drugs=["Vancomycin"]
        )
        assert result.intent == "dose_calculation"
        assert "Vancomycin" in result.detected_drugs

    def test_provided_two_drugs(self):
        result = classify_intent(
            "Any problems?", detected_drugs=["Warfarin", "Amiodarone"]
        )
        assert result.intent == "pair_interaction"
        assert len(result.detected_drugs) == 2

    def test_provided_three_drugs(self):
        result = classify_intent(
            "Check these", detected_drugs=["Aspirin", "Clopidogrel", "Warfarin"]
        )
        assert result.intent == "multi_drug_rx"
        assert len(result.detected_drugs) == 3
