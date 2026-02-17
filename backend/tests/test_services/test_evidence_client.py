"""Evidence client tests."""

from unittest.mock import MagicMock, patch

from app.services.evidence_client import EvidenceClient


def _mock_http_response(payload):
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


def test_query_sends_trace_headers():
    client = EvidenceClient(base_url="http://func:8001")
    with patch("app.services.evidence_client.httpx.post") as mock_post:
        mock_post.return_value = _mock_http_response({"status": "ok"})
        result = client.query(
            "sedation target",
            request_id="req-evi-001",
            trace_id="trace-evi-001",
        )

    assert result["status"] == "ok"
    kwargs = mock_post.call_args.kwargs
    assert kwargs["headers"]["X-Request-ID"] == "req-evi-001"
    assert kwargs["headers"]["X-Trace-ID"] == "trace-evi-001"


def test_health_uses_request_id_when_trace_id_missing():
    client = EvidenceClient(base_url="http://func:8001")
    with patch("app.services.evidence_client.httpx.get") as mock_get:
        mock_get.return_value = _mock_http_response({"status": "healthy"})
        result = client.health(request_id="req-evi-002")

    assert result["status"] == "healthy"
    kwargs = mock_get.call_args.kwargs
    assert kwargs["headers"]["X-Request-ID"] == "req-evi-002"
    assert kwargs["headers"]["X-Trace-ID"] == "req-evi-002"
