"""Tests for B12 safety_gate service — per-intent safety thresholds."""

import pytest
from app.services.safety_gate import apply_safety_gate, SafetyGateResult


# ── 1. dose_calculation with high confidence → passed ──────────────────

def test_dose_calculation_high_confidence_passes():
    result = apply_safety_gate(
        intent="dose_calculation",
        confidence=0.80,
        evidence_count=3,
        has_graph_data=False,
    )
    assert result.passed is True
    assert result.confidence == 0.80
    assert result.requires_expert_review is False
    assert result.safety_note is None
    assert result.adjusted_answer is None


def test_dose_calculation_at_threshold_passes():
    result = apply_safety_gate(
        intent="dose_calculation",
        confidence=0.75,
        evidence_count=2,
    )
    assert result.passed is True
    assert result.requires_expert_review is False


# ── 2. dose_calculation with zero evidence → refuse ───────────────────

def test_dose_calculation_zero_evidence_refuse():
    result = apply_safety_gate(
        intent="dose_calculation",
        confidence=0.80,
        evidence_count=0,
    )
    assert result.requires_expert_review is True
    assert result.adjusted_answer is not None
    assert "⚠️" in result.adjusted_answer
    assert "劑量" in result.adjusted_answer


def test_dose_calculation_zero_evidence_safety_note_set():
    result = apply_safety_gate(
        intent="dose_calculation",
        confidence=0.80,
        evidence_count=0,
    )
    assert result.safety_note is not None
    assert "藥師" in result.safety_note


# ── 3. iv_compatibility without graph → refuse ────────────────────────

def test_iv_compatibility_without_graph_fails():
    result = apply_safety_gate(
        intent="iv_compatibility",
        confidence=0.95,
        evidence_count=5,
        has_graph_data=False,
    )
    assert result.passed is False
    assert result.requires_expert_review is True
    assert result.safety_note is not None
    assert "相容性" in result.safety_note
    assert result.adjusted_answer is not None
    assert "⚠️" in result.adjusted_answer


# ── 4. iv_compatibility with graph → passed (if confidence meets threshold) ──

def test_iv_compatibility_with_graph_high_confidence_passes():
    result = apply_safety_gate(
        intent="iv_compatibility",
        confidence=0.92,
        evidence_count=3,
        has_graph_data=True,
    )
    assert result.passed is True
    assert result.requires_expert_review is False


def test_iv_compatibility_with_graph_below_threshold_fails():
    # Threshold is 0.90 for iv_compatibility
    result = apply_safety_gate(
        intent="iv_compatibility",
        confidence=0.85,
        evidence_count=3,
        has_graph_data=True,
    )
    assert result.passed is False
    assert result.requires_expert_review is True


# ── 5. Below threshold → requires_expert_review ───────────────────────

def test_below_threshold_requires_review():
    result = apply_safety_gate(
        intent="clinical_decision",
        confidence=0.55,  # threshold is 0.60
        evidence_count=2,
    )
    assert result.requires_expert_review is True
    assert result.passed is False
    assert result.safety_note is not None
    assert "低於" in result.safety_note


def test_below_threshold_safety_note_contains_percentages():
    result = apply_safety_gate(
        intent="drug_monograph",
        confidence=0.40,  # threshold is 0.55
        evidence_count=1,
    )
    assert result.requires_expert_review is True
    assert "40%" in result.safety_note or "40" in result.safety_note


# ── 6. Very low confidence (<0.35) → refuse ───────────────────────────

def test_very_low_confidence_requires_review():
    result = apply_safety_gate(
        intent="clinical_guideline",
        confidence=0.20,
        evidence_count=1,
    )
    assert result.requires_expert_review is True
    assert result.safety_note is not None


def test_confidence_zero_requires_review():
    result = apply_safety_gate(
        intent="drug_comparison",
        confidence=0.0,
        evidence_count=0,
    )
    assert result.requires_expert_review is True
    assert result.passed is False


def test_confidence_below_035_triggers_rule1():
    result = apply_safety_gate(
        intent="clinical_summary",
        confidence=0.30,
        evidence_count=2,  # has evidence, but very low confidence
    )
    assert result.requires_expert_review is True
    assert result.safety_note is not None


# ── 7. Contradiction → always requires_review ─────────────────────────

def test_contradiction_always_flags_expert_review():
    result = apply_safety_gate(
        intent="pair_interaction",
        confidence=0.80,  # above threshold
        evidence_count=3,
        has_contradiction=True,
    )
    assert result.requires_expert_review is True
    assert result.safety_note is not None
    assert "分歧" in result.safety_note or "矛盾" in result.safety_note or "多個來源" in result.safety_note


def test_contradiction_with_high_confidence_still_flags():
    result = apply_safety_gate(
        intent="clinical_decision",
        confidence=0.95,
        evidence_count=5,
        has_contradiction=True,
    )
    assert result.requires_expert_review is True


# ── 8. patient_education with low threshold → passed at 0.45 ──────────

def test_patient_education_passes_at_threshold():
    result = apply_safety_gate(
        intent="patient_education",
        confidence=0.45,
        evidence_count=2,
    )
    assert result.passed is True
    assert result.requires_expert_review is False


def test_patient_education_below_threshold():
    result = apply_safety_gate(
        intent="patient_education",
        confidence=0.40,
        evidence_count=2,
    )
    assert result.requires_expert_review is True


# ── 9. general_pharmacology → lenient (threshold 0.45, zero evidence ok) ──

def test_general_pharmacology_zero_evidence_allowed():
    """general_pharmacology with zero evidence should NOT trigger Rule 1 refuse."""
    result = apply_safety_gate(
        intent="general_pharmacology",
        confidence=0.50,
        evidence_count=0,
    )
    # Zero evidence is allowed for general_pharmacology (exception in Rule 1)
    assert result.requires_expert_review is False


def test_general_pharmacology_low_confidence_still_flags():
    result = apply_safety_gate(
        intent="general_pharmacology",
        confidence=0.30,  # below 0.35 triggers very-low-confidence rule
        evidence_count=0,
    )
    assert result.requires_expert_review is True


# ── 10. Unknown intent → default threshold 0.55 ───────────────────────

def test_unknown_intent_uses_default_threshold():
    result = apply_safety_gate(
        intent="some_unknown_intent",
        confidence=0.60,
        evidence_count=2,
    )
    # 0.60 >= 0.55 (default) → should pass
    assert result.passed is True
    assert result.requires_expert_review is False


def test_unknown_intent_below_default_threshold():
    result = apply_safety_gate(
        intent="completely_new_intent",
        confidence=0.50,  # below default 0.55
        evidence_count=2,
    )
    assert result.passed is False
    assert result.requires_expert_review is True


# ── 11. SafetyGateResult model fields ─────────────────────────────────

def test_safety_gate_result_fields():
    result = apply_safety_gate(
        intent="clinical_guideline",
        confidence=0.70,
        evidence_count=3,
    )
    assert isinstance(result, SafetyGateResult)
    assert hasattr(result, "passed")
    assert hasattr(result, "confidence")
    assert hasattr(result, "requires_expert_review")
    assert hasattr(result, "safety_note")
    assert hasattr(result, "adjusted_answer")
    assert result.confidence == 0.70


def test_safety_gate_result_default_fields():
    result = SafetyGateResult(passed=True, confidence=0.8)
    assert result.requires_expert_review is False
    assert result.safety_note is None
    assert result.adjusted_answer is None


# ── 12. Combined: below threshold + contradiction → both flags set ──────

def test_below_threshold_and_contradiction_both_flags():
    result = apply_safety_gate(
        intent="nhi_reimbursement",
        confidence=0.55,  # threshold is 0.65
        evidence_count=2,
        has_contradiction=True,
    )
    assert result.passed is False
    assert result.requires_expert_review is True
    # Safety note should mention both threshold issue and contradiction
    assert result.safety_note is not None
    assert len(result.safety_note) > 0


def test_below_threshold_note_includes_threshold_percent():
    result = apply_safety_gate(
        intent="dose_calculation",
        confidence=0.60,  # threshold is 0.75
        evidence_count=2,
    )
    assert result.requires_expert_review is True
    # Note should mention both actual confidence and threshold
    note = result.safety_note or ""
    assert "60%" in note or "75%" in note


# ── Additional edge case tests ─────────────────────────────────────────

def test_clinical_summary_at_threshold():
    result = apply_safety_gate(
        intent="clinical_summary",
        confidence=0.45,
        evidence_count=1,
    )
    assert result.passed is True
    assert result.requires_expert_review is False


def test_iv_compat_zero_evidence_no_graph():
    """iv_compatibility with no evidence AND no graph → refuse with IV note."""
    result = apply_safety_gate(
        intent="iv_compatibility",
        confidence=0.0,
        evidence_count=0,
        has_graph_data=False,
    )
    assert result.passed is False
    assert result.requires_expert_review is True
    assert result.adjusted_answer is not None


def test_detected_drugs_parameter_accepted():
    """detected_drugs is accepted without error (currently informational)."""
    result = apply_safety_gate(
        intent="pair_interaction",
        confidence=0.70,
        evidence_count=2,
        detected_drugs=["Warfarin", "Aspirin"],
    )
    assert isinstance(result, SafetyGateResult)


def test_nhi_reimbursement_above_threshold():
    result = apply_safety_gate(
        intent="nhi_reimbursement",
        confidence=0.70,
        evidence_count=3,
    )
    assert result.passed is True
    assert result.requires_expert_review is False
