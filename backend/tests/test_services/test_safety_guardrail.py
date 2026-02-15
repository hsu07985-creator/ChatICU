"""Tests for the medical safety guardrail (T30)."""

from app.services.safety_guardrail import apply_safety_guardrail, MEDICAL_DISCLAIMER


def test_disclaimer_always_appended():
    result = apply_safety_guardrail("Normal AI response about patient care.")
    assert "免責聲明" in result["content"]
    assert result["flagged"] is False
    assert result["warnings"] == []


def test_high_alert_medication_flagged():
    content = "建議給予 heparin 5000 unit IV bolus"
    result = apply_safety_guardrail(content)
    assert result["flagged"] is True
    assert any("高警訊藥物" in w for w in result["warnings"])


def test_definitive_claim_flagged():
    content = "確定診斷為肺栓塞，建議立即抗凝治療"
    result = apply_safety_guardrail(content)
    assert result["flagged"] is True
    assert any("確定性診斷" in w for w in result["warnings"])


def test_safe_content_not_flagged():
    content = "依據臨床指引，建議評估患者呼吸功能並考慮調整呼吸器設定。"
    result = apply_safety_guardrail(content)
    assert result["flagged"] is False
    assert "免責聲明" in result["content"]


def test_multiple_warnings():
    content = "確定診斷為心房顫動，建議給予 heparin 10000 unit"
    result = apply_safety_guardrail(content)
    assert result["flagged"] is True
    assert len(result["warnings"]) >= 2
