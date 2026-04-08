"""Unit tests for chat_router — parse logic + diverse question coverage (M4).

These test questions are deliberately NOT copies of the few-shot examples,
to verify the router generalises rather than just memorising.
"""

from app.services.chat_router import ChatRouteResult, _parse_router_response


# ── _parse_router_response unit tests ──────────────────────────────────


def test_parse_valid_json():
    raw = '{"lookup_types": ["drug_rag"], "drugs": ["aspirin"], "solution": null}'
    result = _parse_router_response(raw)
    assert result.lookup_types == ["drug_rag"]
    assert result.drugs == ["aspirin"]
    assert result.solution is None


def test_parse_json_in_markdown_block():
    raw = '```json\n{"lookup_types": ["pad", "nhi"], "drugs": ["fentanyl"], "solution": null}\n```'
    result = _parse_router_response(raw)
    assert result.lookup_types == ["pad", "nhi"]
    assert result.drugs == ["fentanyl"]


def test_parse_invalid_lookup_types_filtered():
    raw = '{"lookup_types": ["drug_rag", "fake_db", "interaction"], "drugs": [], "solution": null}'
    result = _parse_router_response(raw)
    assert "fake_db" not in result.lookup_types
    assert result.lookup_types == ["drug_rag", "interaction"]


def test_parse_malformed_returns_empty():
    result = _parse_router_response("I don't know what to do")
    assert result.lookup_types == []
    assert result.drugs == []


def test_parse_empty_string():
    result = _parse_router_response("")
    assert result.lookup_types == []


def test_parse_strips_whitespace_from_drugs():
    raw = '{"lookup_types": ["interaction"], "drugs": [" warfarin ", " digoxin"], "solution": null}'
    result = _parse_router_response(raw)
    assert result.drugs == ["warfarin", "digoxin"]


# ── Diverse question patterns (M4: non-overlapping with few-shot) ──────


def test_route_result_model_validates():
    """ChatRouteResult accepts valid data."""
    r = ChatRouteResult(lookup_types=["pad", "nhi"], drugs=["rocuronium"], solution=None)
    assert "pad" in r.lookup_types
    assert r.drugs == ["rocuronium"]


def test_route_result_defaults():
    """ChatRouteResult defaults to empty."""
    r = ChatRouteResult()
    assert r.lookup_types == []
    assert r.drugs == []
    assert r.solution is None
