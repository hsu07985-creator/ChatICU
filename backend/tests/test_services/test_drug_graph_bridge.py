from app.services.drug_graph_bridge import DrugGraphBridge


def test_build_query_candidates_extracts_parenthesis_generics():
    candidates = DrugGraphBridge._build_query_candidates(
        "Xigduo XR 10/1000mg tab (Dapagliflozin/Metformin)"
    )
    lowered = {c.lower() for c in candidates}
    assert "dapagliflozin" in lowered
    assert "metformin" in lowered


def test_build_query_candidates_expands_common_aliases():
    candidates = DrugGraphBridge._build_query_candidates(
        "KCl【#】15% 20mEq/10ml(Pot. chloride)"
    )
    assert any(c.lower() == "potassium chloride" for c in candidates)

    candidates_ns = DrugGraphBridge._build_query_candidates(
        "N.S.0.9% 500ML<BAG>[點滴] (軟袋500ML)"
    )
    assert any(c.lower() == "sodium chloride" for c in candidates_ns)


def test_build_query_candidates_handles_brand_combo_aliases():
    candidates = DrugGraphBridge._build_query_candidates(
        "Amaryl M【#】2/500(Glimepiride/Metformin)"
    )
    lowered = {c.lower() for c in candidates}
    assert "glimepiride" in lowered
    assert "metformin" in lowered


def test_high_confidence_fuzzy_guard():
    assert DrugGraphBridge._is_high_confidence_fuzzy_match(
        "Neostigmine",
        "Neostigmine (Systemic)",
        0.9,
    )
    assert not DrugGraphBridge._is_high_confidence_fuzzy_match(
        "Pirenoxine",
        "Pirfenidone",
        0.72,
    )


def test_tmpsmx_aliases_expand():
    """M3: TMP/SMX, Bactrim, Baktar, 撲菌特 all expand to Trimethoprim + Sulfamethoxazole."""
    for name in ["TMP/SMX", "TMP-SMX", "Bactrim", "Septrin", "Baktar", "撲菌特"]:
        candidates = DrugGraphBridge._build_query_candidates(name)
        lowered = {c.lower() for c in candidates}
        assert "trimethoprim" in lowered, f"{name} should expand to Trimethoprim"
        assert "sulfamethoxazole" in lowered, f"{name} should expand to Sulfamethoxazole"
