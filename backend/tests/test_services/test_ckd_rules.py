"""Test CKD staging rule engine."""

from app.services.rule_engine.ckd_rules import classify_ckd_stage


def test_stage_g1():
    result = classify_ckd_stage(egfr=95)
    assert result["stage"] == "G1"


def test_stage_g2():
    result = classify_ckd_stage(egfr=75)
    assert result["stage"] == "G2"


def test_stage_g3a():
    result = classify_ckd_stage(egfr=50)
    assert result["stage"] == "G3a"


def test_stage_g3b():
    result = classify_ckd_stage(egfr=35)
    assert result["stage"] == "G3b"


def test_stage_g4():
    result = classify_ckd_stage(egfr=20)
    assert result["stage"] == "G4"


def test_stage_g5():
    result = classify_ckd_stage(egfr=10)
    assert result["stage"] == "G5"


def test_proteinuria_adds_recommendation():
    result = classify_ckd_stage(egfr=50, has_proteinuria=True)
    assert result["stage"] == "G3a"
    assert "Proteinuria" in result["recommendations"][0]


def test_patient_p001_egfr_45():
    result = classify_ckd_stage(egfr=45)
    assert result["stage"] == "G3a"
