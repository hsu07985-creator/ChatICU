"""Test AI Chat endpoints — multi-turn conversation history + compression (P2-1)."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException


def _mock_evidence_query_ok(*_args, **_kwargs):
    return {
        "answer": "RAG evidence context",
        "citations": [
            {
                "citation_id": "cite_1",
                "source_file": "guidelines/padis.md",
                "topic": "sedation",
                "score": 0.91,
            }
        ],
        "confidence": 0.91,
    }


# ── Patient context injection tests (Phase 2, updated for multi-turn) ──


@pytest.mark.asyncio
async def test_ai_chat_with_patient_context(client):
    """When patientId is provided, the last message should include patient data."""
    captured = {}

    def mock_call_llm_multi(task, messages, **kwargs):
        captured["task"] = task
        captured["messages"] = messages
        return {"status": "success", "content": "AI response", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post(
            "/ai/chat",
            json={"message": "What is the patient status?", "patientId": "pat_001"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    # Last message should be user's current question with patient context
    last_msg = captured["messages"][-1]
    assert last_msg["role"] == "user"
    assert "病患資料" in last_msg["content"]
    assert "pat_001" in last_msg["content"]
    assert "許先生" in last_msg["content"]
    assert "What is the patient status?" in last_msg["content"]


@pytest.mark.asyncio
async def test_ai_chat_response_includes_data_freshness_metadata(client):
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "AI response", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post(
            "/ai/chat",
            json={"message": "Need latest ICU overview", "patientId": "pat_001"},
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        msg = payload["message"]
        assert "dataFreshness" in msg
        assert msg["dataFreshness"] is not None
        assert msg["dataFreshness"]["mode"] in {"json", "db"}
        assert isinstance(msg["dataFreshness"]["missing_fields"], list)
        assert isinstance(msg["dataFreshness"]["hints"], list)

        session_id = payload["sessionId"]
        detail = await client.get(f"/ai/sessions/{session_id}")
        assert detail.status_code == 200
        detail_messages = detail.json()["data"]["messages"]
        assistant = [m for m in detail_messages if m["role"] == "assistant"][-1]
        assert assistant["dataFreshness"] is not None
        assert isinstance(assistant["dataFreshness"]["hints"], list)


@pytest.mark.asyncio
async def test_ai_chat_citations_include_page_and_snippet(client):
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "AI response", "metadata": {}}

    with patch(
        "app.routers.ai_chat.evidence_client.query",
        return_value={
            "answer": "RAG evidence context",
            "citations": [
                {
                    "citation_id": "cite_001",
                    "chunk_id": "chunk_001",
                    "source_file": "guidelines/padis.md",
                    "topic": "sedation",
                    "score": 0.88,
                    "snippet": "fallback snippet",
                }
            ],
            "confidence": 0.88,
        },
    ), patch(
        "app.routers.ai_chat.evidence_client.source_by_chunk_id",
        return_value={
            "chunk_id": "chunk_001",
            "source_file": "guidelines/padis.md",
            "page": 12,
            "topic": "sedation",
            "text": "PADIS 原文段落內容",
            "metadata": {},
        },
    ), patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post(
            "/ai/chat",
            json={"message": "請說明鎮靜策略"},
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        msg = payload["message"]
        assert msg["citations"]
        citation = msg["citations"][0]
        assert citation["chunkId"] == "chunk_001"
        assert citation["sourceFile"] == "guidelines/padis.md"
        assert citation["title"] == "padis.md"
        assert citation["page"] == 12
        assert citation["snippet"] == "PADIS 原文段落內容"

        session_id = payload["sessionId"]
        detail = await client.get(f"/ai/sessions/{session_id}")
        assert detail.status_code == 200
        detail_messages = detail.json()["data"]["messages"]
        assistant = [m for m in detail_messages if m["role"] == "assistant"][-1]
        history_citation = assistant["citations"][0]
        assert history_citation["page"] == 12
        assert history_citation["snippet"] == "PADIS 原文段落內容"


@pytest.mark.asyncio
async def test_ai_chat_response_splits_main_and_explanation_sections(client):
    with patch(
        "app.routers.ai_chat.evidence_client.query",
        side_effect=_mock_evidence_query_ok,
    ), patch(
        "app.routers.ai_chat.call_llm_multi_turn",
        return_value={
            "status": "success",
            "content": (
                "【主回答】C。考慮以 dexmedetomidine 取代 midazolam。\n"
                "【說明/補充】\n"
                "- 目標為 light sedation 並降低譫妄風險。\n"
                "- benzodiazepines 與譫妄風險上升相關。"
            ),
            "metadata": {},
        },
    ):
        response = await client.post(
            "/ai/chat",
            json={"message": "下列何者最適合作為鎮靜策略？A. midazolam B. fentanyl C. dexmedetomidine D. ketamine"},
        )
        assert response.status_code == 200
        payload = response.json()["data"]
        message = payload["message"]
        assert message["content"] == "C。考慮以 dexmedetomidine 取代 midazolam。"
        assert isinstance(message["explanation"], str)
        assert "light sedation" in message["explanation"]

        session_id = payload["sessionId"]
        detail = await client.get(f"/ai/sessions/{session_id}")
        assert detail.status_code == 200
        detail_messages = detail.json()["data"]["messages"]
        assistant = [m for m in detail_messages if m["role"] == "assistant"][-1]
        assert assistant["content"] == "C。考慮以 dexmedetomidine 取代 midazolam。"
        assert isinstance(assistant["explanation"], str)
        assert "benzodiazepines" in assistant["explanation"]


@pytest.mark.asyncio
async def test_ai_chat_removes_option_prefix_for_non_mcq_questions(client):
    with patch(
        "app.routers.ai_chat.evidence_client.query",
        side_effect=_mock_evidence_query_ok,
    ), patch(
        "app.routers.ai_chat.call_llm_multi_turn",
        return_value={
            "status": "success",
            "content": (
                "【主回答】C。建議先維持現行止痛策略並持續監測。\n"
                "【說明/補充】\n"
                "- 病人目前痛分數偏低。\n"
                "- 若痛分數上升再調整。"
            ),
            "metadata": {},
        },
    ):
        response = await client.post("/ai/chat", json={"message": "患者在痛我要如何給止痛藥物"})
        assert response.status_code == 200
        message = response.json()["data"]["message"]
        assert message["content"] == "建議先維持現行止痛策略並持續監測。"


@pytest.mark.asyncio
async def test_ai_chat_response_fallback_splits_first_sentence_when_no_markers(client):
    with patch(
        "app.routers.ai_chat.evidence_client.query",
        side_effect=_mock_evidence_query_ok,
    ), patch(
        "app.routers.ai_chat.call_llm_multi_turn",
        return_value={
            "status": "success",
            "content": (
                "建議優先調整疼痛控制與呼吸器適應策略。"
                "若仍有嚴重焦慮，再考慮短期低劑量鎮靜藥物。"
            ),
            "metadata": {},
        },
    ):
        response = await client.post("/ai/chat", json={"message": "現在要直接上 BZD 嗎？"})
        assert response.status_code == 200
        message = response.json()["data"]["message"]
        assert message["content"] == "建議優先調整疼痛控制與呼吸器適應策略。"
        assert isinstance(message["explanation"], str)
        assert "短期低劑量鎮靜藥物" in message["explanation"]


@pytest.mark.asyncio
async def test_ai_chat_without_patient_id(client):
    """When patientId is not provided, no patient context in messages."""
    captured = {}

    def mock_call_llm_multi(task, messages, **kwargs):
        captured["messages"] = messages
        return {"status": "success", "content": "AI response", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post(
            "/ai/chat",
            json={"message": "General medical question"},
        )
        assert response.status_code == 200

    last_msg = captured["messages"][-1]
    assert "病患資料" not in last_msg["content"]
    assert "General medical question" in last_msg["content"]


@pytest.mark.asyncio
async def test_ai_chat_with_invalid_patient_id(client):
    """When patientId doesn't exist, should not crash — no patient context."""
    captured = {}

    def mock_call_llm_multi(task, messages, **kwargs):
        captured["messages"] = messages
        return {"status": "success", "content": "AI response", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post(
            "/ai/chat",
            json={"message": "Question about nonexistent patient", "patientId": "NONEXIST"},
        )
        assert response.status_code == 200

    last_msg = captured["messages"][-1]
    assert "病患資料" not in last_msg["content"]


@pytest.mark.asyncio
async def test_ai_chat_forwards_request_trace_ids_to_evidence(client):
    captured = {}

    def mock_query(question, top_k=8, topic_filter=None, **kwargs):
        captured["kwargs"] = kwargs
        return {"answer": "mock rag answer", "citations": []}

    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "AI response", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=mock_query), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post(
            "/ai/chat",
            json={"message": "Need sedation suggestion"},
            headers={
                "X-Request-ID": "p1-chat-req-001",
                "X-Trace-ID": "p1-chat-trace-001",
            },
        )
        assert response.status_code == 200

    assert captured["kwargs"]["request_id"] == "p1-chat-req-001"
    assert captured["kwargs"]["trace_id"] == "p1-chat-trace-001"


# ── Multi-turn conversation history tests ──────────────────────────────


@pytest.mark.asyncio
async def test_ai_chat_sends_history_on_follow_up(client):
    """Second message in the same session should include the first turn."""
    call_count = {"n": 0}
    captured_all = []

    def mock_call_llm_multi(task, messages, **kwargs):
        call_count["n"] += 1
        captured_all.append(messages)
        return {"status": "success", "content": f"AI response {call_count['n']}", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        # First message — creates session
        r1 = await client.post(
            "/ai/chat",
            json={"message": "What are the latest labs?", "patientId": "pat_001"},
        )
        assert r1.status_code == 200
        session_id = r1.json()["data"]["sessionId"]

        # Second message — same session, should include first turn's history
        r2 = await client.post(
            "/ai/chat",
            json={
                "message": "What about the potassium level?",
                "sessionId": session_id,
                "patientId": "pat_001",
            },
        )
        assert r2.status_code == 200

    # First call: only the current message (no history)
    first_call_msgs = captured_all[0]
    assert len(first_call_msgs) == 1  # just the current user message

    # Second call: history (user + assistant from turn 1) + current message
    second_call_msgs = captured_all[1]
    # Should have at least 3 messages: user1, assistant1, user2(current)
    assert len(second_call_msgs) >= 3
    assert second_call_msgs[0]["role"] == "user"
    assert "latest labs" in second_call_msgs[0]["content"]
    assert second_call_msgs[1]["role"] == "assistant"
    assert "AI response 1" in second_call_msgs[1]["content"]
    assert second_call_msgs[-1]["role"] == "user"
    assert "potassium level" in second_call_msgs[-1]["content"]


@pytest.mark.asyncio
async def test_ai_chat_returns_session_id(client):
    """Chat should return a sessionId that can be reused."""
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "OK", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        r = await client.post("/ai/chat", json={"message": "Hello"})
        assert r.status_code == 200
        data = r.json()["data"]
        assert "sessionId" in data
        assert data["sessionId"].startswith("session_")


@pytest.mark.asyncio
async def test_ai_chat_marks_degraded_response_when_llm_unavailable(client):
    """LLM failure path must be observable to frontend via degraded metadata."""
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "error", "content": "upstream timeout", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post("/ai/chat", json={"message": "Need quick med summary"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        msg = data["data"]["message"]
        assert msg["degraded"] is True
        assert msg["degradedReason"] == "llm_unavailable"
        assert msg["upstreamStatus"] == "error"
        assert isinstance(msg["content"], str)
        assert len(msg["content"]) > 0


@pytest.mark.asyncio
async def test_ai_chat_blocks_when_evidence_below_threshold(client):
    llm_called = {"called": False}

    def mock_call_llm_multi(task, messages, **kwargs):
        llm_called["called"] = True
        return {"status": "success", "content": "should not happen", "metadata": {}}

    with patch(
        "app.routers.ai_chat.evidence_client.query",
        return_value={"answer": "weak evidence", "citations": [], "confidence": 0.1},
    ), patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post("/ai/chat", json={"message": "Need recommendation"})
        assert response.status_code == 200
        data = response.json()["data"]["message"]
        assert data["degraded"] is True
        assert data["degradedReason"] == "insufficient_evidence"
        assert data["upstreamStatus"] == "blocked_by_evidence_gate"
        assert data["evidenceGate"]["passed"] is False
        assert data["evidenceGate"]["reason_code"] in {
            "EVIDENCE_NOT_FOUND",
            "INSUFFICIENT_CITATIONS",
            "LOW_CONFIDENCE",
        }
        assert "證據不足" in data["content"]
        assert data["safetyWarnings"] is None

    assert llm_called["called"] is False


@pytest.mark.asyncio
async def test_ai_chat_uses_evidence_snippets_when_citations_missing(client):
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "建議維持目前止痛策略。", "metadata": {}}

    with patch(
        "app.routers.ai_chat.evidence_client.query",
        return_value={
            "answer": "RAG evidence context",
            "citations": [],
            "confidence": 0.82,
            "evidence_snippets": [
                {
                    "chunk_id": "chunk_snippet_1",
                    "source_file": "guidelines/pain.md",
                    "page": 7,
                    "topic": "analgesia",
                    "text": "疼痛控制應先評估疼痛分數與呼吸抑制風險。",
                    "score": 0.81,
                }
            ],
        },
    ), patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post("/ai/chat", json={"message": "患者在痛我要如何給止痛藥物"})
        assert response.status_code == 200
        message = response.json()["data"]["message"]
        assert len(message["citations"]) == 1
        citation = message["citations"][0]
        assert citation["chunkId"] == "chunk_snippet_1"
        assert citation["sourceFile"] == "guidelines/pain.md"
        assert citation["page"] == 7
        assert "疼痛控制" in citation["snippet"]


@pytest.mark.asyncio
async def test_ai_chat_merges_duplicate_citations_from_same_source(client):
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "建議維持現行止痛策略。", "metadata": {}}

    with patch(
        "app.routers.ai_chat.evidence_client.query",
        return_value={
            "answer": "RAG evidence context",
            "citations": [
                {
                    "citation_id": "cite_1",
                    "source_file": "1_analgesic/Taiwan PAD (pain) 1140131.pdf",
                    "topic": "analgesia",
                    "score": 0.71,
                    "snippet": "[Page 5]\n鴉片類藥物可作為非神經病變性疼痛首選。",
                },
                {
                    "citation_id": "cite_2",
                    "source_file": "1_analgesic/Taiwan PAD (pain) 1140131.pdf",
                    "topic": "analgesia",
                    "score": 0.65,
                    "page": 6,
                    "snippet": "非鴉片類藥物可作為輔助。",
                },
                {
                    "citation_id": "cite_3",
                    "source_file": "1_analgesic/Taiwan PAD (pain) 1140131.pdf",
                    "topic": "analgesia",
                    "score": 0.55,
                    "snippet": "",
                },
            ],
            "confidence": 0.84,
        },
    ), patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post("/ai/chat", json={"message": "他適合什麼樣的方式止痛"})
        assert response.status_code == 200
        citations = response.json()["data"]["message"]["citations"]
        assert len(citations) == 1
        merged = citations[0]
        assert merged["sourceFile"] == "1_analgesic/Taiwan PAD (pain) 1140131.pdf"
        assert merged["page"] == 5
        assert merged["pages"] == [5, 6]
        assert merged["snippetCount"] >= 2


@pytest.mark.asyncio
async def test_ai_chat_merges_duplicate_citations_from_same_source(client):
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "建議維持現行止痛策略。", "metadata": {}}

    with patch(
        "app.routers.ai_chat.evidence_client.query",
        return_value={
            "answer": "RAG evidence context",
            "confidence": 0.9,
            "citations": [
                {
                    "citation_id": "cite_1",
                    "source_file": "guidelines/pain.md",
                    "topic": "analgesia",
                    "score": 0.82,
                    "page": 5,
                    "snippet": "[Page 5]\n所有適用的靜脈注射型鴉片類藥物可作為第一線止痛。",
                },
                {
                    "citation_id": "cite_2",
                    "source_file": "guidelines/pain.md",
                    "topic": "analgesia",
                    "score": 0.79,
                    "page": 6,
                    "snippet": "[Page 6]\n非鴉片類藥物可作為輔助以降低鴉片劑量。",
                },
                {
                    "citation_id": "cite_3",
                    "source_file": "guidelines/pain.md",
                    "topic": "analgesia",
                    "score": 0.7,
                    "page": 5,
                    "snippet": "[Page 5]\n所有適用的靜脈注射型鴉片類藥物可作為第一線止痛。",
                },
            ],
            "evidence_snippets": [],
        },
    ), patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post("/ai/chat", json={"message": "他適合什麼樣的方式止痛"})
        assert response.status_code == 200
        message = response.json()["data"]["message"]
        assert len(message["citations"]) == 1
        citation = message["citations"][0]
        assert citation["sourceFile"] == "guidelines/pain.md"
        assert citation["page"] == 5
        assert citation["pages"] == [5, 6]
        assert citation["snippetCount"] == 2
        assert "[Page" not in citation["snippet"]


@pytest.mark.asyncio
async def test_ai_chat_medication_fact_allows_weak_evidence(client):
    llm_called = {"called": False}

    def mock_call_llm_multi(task, messages, **kwargs):
        llm_called["called"] = True
        return {
            "status": "success",
            "content": "目前可確認：病患現有用藥資料已彙整。",
            "metadata": {},
        }

    with patch(
        "app.routers.ai_chat.evidence_client.query",
        return_value={"answer": "weak evidence", "citations": [], "confidence": 0.1},
    ), patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        response = await client.post("/ai/chat", json={"message": "他用什麼藥物？", "patientId": "pat_001"})
        assert response.status_code == 200
        data = response.json()["data"]["message"]
        assert data["degraded"] is False
        assert data["upstreamStatus"] == "success"
        assert data["evidenceGate"]["passed"] is True
        assert data["evidenceGate"]["thresholds"]["min_citations"] == 0
        assert data["evidenceGate"]["thresholds"]["min_confidence"] == 0.0

    assert llm_called["called"] is True


@pytest.mark.asyncio
async def test_ai_chat_stability_question_returns_partial_when_vitals_missing(client):
    llm_multi_called = {"called": False}

    def mock_call_llm_multi(task, messages, **kwargs):
        llm_multi_called["called"] = True
        return {"status": "success", "content": "should not run", "metadata": {}}

    def mock_call_llm(task, input_data, **kwargs):
        assert task == "chat_partial_response"
        assert "missing_reason" in input_data
        return {
            "status": "success",
            "content": "目前可確認：已有部分病歷資料。\n目前無法確認：缺少生命徵象。\n建議補充資料：請補抓最新 vital signs。",
            "metadata": {},
        }

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi), \
         patch("app.routers.ai_chat.call_llm", side_effect=mock_call_llm):
        response = await client.post("/ai/chat", json={"message": "他還好嗎？", "patientId": "pat_001"})
        assert response.status_code == 200
        data = response.json()["data"]["message"]
        assert data["degraded"] is True
        assert data["degradedReason"] == "insufficient_patient_data"
        assert data["upstreamStatus"] == "partial_due_to_patient_data"
        assert "生命徵象" in data["content"]

    assert llm_multi_called["called"] is False


@pytest.mark.asyncio
async def test_ai_chat_stream_emits_delta_and_done_events(client):
    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch(
             "app.routers.ai_chat.call_llm_multi_turn",
             return_value={"status": "success", "content": "這是一段串流測試回覆。", "metadata": {}},
         ):
        response = await client.post("/ai/chat/stream", json={"message": "stream test"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = response.text
        assert "event: start" in body
        assert "event: delta" in body
        assert "event: done" in body
        assert "串流測試回覆" in body


@pytest.mark.asyncio
async def test_ai_chat_stream_returns_error_event_on_http_exception(client):
    async def raise_http_exception(*args, **kwargs):
        raise HTTPException(status_code=503, detail="stream unavailable")

    with patch("app.routers.ai_chat.ai_chat", side_effect=raise_http_exception):
        response = await client.post("/ai/chat/stream", json={"message": "stream error test"})
        assert response.status_code == 200
        body = response.text
        assert "event: error" in body
        assert "stream unavailable" in body


@pytest.mark.asyncio
async def test_ai_chat_can_update_session_title(client):
    """Session titles are editable via PATCH /ai/sessions/{id}."""
    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "OK", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        r = await client.post("/ai/chat", json={"message": "Hello"})
        assert r.status_code == 200
        session_id = r.json()["data"]["sessionId"]

        r2 = await client.patch(
            f"/ai/sessions/{session_id}",
            json={"title": "我的對話標題"},
        )
        assert r2.status_code == 200
        assert r2.json()["data"]["title"] == "我的對話標題"

        r3 = await client.get("/ai/sessions")
        assert r3.status_code == 200
        sessions = r3.json()["data"]["sessions"]
        assert any(s["id"] == session_id and s["title"] == "我的對話標題" for s in sessions)


@pytest.mark.asyncio
async def test_ai_chat_history_includes_guardrail_metadata(client):
    """Guardrail warnings/flags should be available when loading session history."""
    def mock_call_llm_multi(task, messages, **kwargs):
        # High-alert med + dosage should trigger warnings in guardrail
        return {"status": "success", "content": "建議給予 heparin 5000 unit IV bolus", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi):
        r = await client.post("/ai/chat", json={"message": "Dose suggestion"})
        assert r.status_code == 200
        session_id = r.json()["data"]["sessionId"]

    r2 = await client.get(f"/ai/sessions/{session_id}")
    assert r2.status_code == 200
    msgs = r2.json()["data"]["messages"]
    assert len(msgs) >= 2

    assistant = [m for m in msgs if m["role"] == "assistant"][-1]
    assert assistant.get("requiresExpertReview") is True
    assert assistant.get("safetyWarnings"), "Expected safety warnings in history"
    assert "免責聲明" not in assistant["content"], "Chat should not inline-disclaim every message"


# ── Compression tests ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ai_chat_compression_triggers_above_threshold(client):
    """When message count exceeds COMPRESS_THRESHOLD, compression should fire."""
    compress_captured = {}

    def mock_call_llm_multi(task, messages, **kwargs):
        return {"status": "success", "content": "AI reply", "metadata": {}}

    def mock_call_llm(task, input_data, **kwargs):
        if task == "conversation_compress":
            compress_captured["called"] = True
            compress_captured["input"] = input_data
            return {"status": "success", "content": "Compressed summary of conversation", "metadata": {}}
        return {"status": "success", "content": "OK", "metadata": {}}

    # Use low thresholds: compress when >= 4 messages, keep last 2 verbatim
    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi), \
         patch("app.routers.ai_chat.call_llm", side_effect=mock_call_llm), \
         patch("app.routers.ai_chat.COMPRESS_THRESHOLD", 4), \
         patch("app.routers.ai_chat.RECENT_MSG_WINDOW", 2):
        r1 = await client.post("/ai/chat", json={"message": "Message 1"})
        session_id = r1.json()["data"]["sessionId"]

        # Send more messages to exceed threshold (4 = 2 turns × 2 messages each)
        for i in range(2, 5):
            await client.post(
                "/ai/chat",
                json={"message": f"Message {i}", "sessionId": session_id},
            )

    # Compression should have been called
    assert compress_captured.get("called") is True
    assert "conversation" in compress_captured["input"]


@pytest.mark.asyncio
async def test_ai_chat_summary_used_in_history(client):
    """When session has a summary, it should be injected into LLM messages."""
    from sqlalchemy import select as sa_select

    from app.database import get_db
    from app.main import app as fastapi_app
    from app.models.ai_session import AISession

    captured_all = []

    def mock_call_llm_multi(task, messages, **kwargs):
        captured_all.append(messages)
        return {"status": "success", "content": "AI reply", "metadata": {}}

    def mock_call_llm(task, input_data, **kwargs):
        return {"status": "success", "content": "Summary text", "metadata": {}}

    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi), \
         patch("app.routers.ai_chat.call_llm", side_effect=mock_call_llm):
        # Create a session first
        r1 = await client.post("/ai/chat", json={"message": "Initial question"})
        session_id = r1.json()["data"]["sessionId"]

    # Manually set a summary on the session to simulate post-compression state
    override_fn = fastapi_app.dependency_overrides.get(get_db)
    if override_fn:
        gen = override_fn()
        db_session = await gen.__anext__()
        result = await db_session.execute(
            sa_select(AISession).where(AISession.id == session_id)
        )
        session_obj = result.scalar_one()
        session_obj.summary = "先前討論了病患的肺炎治療方案和抗生素調整。"
        session_obj.summary_up_to = 2
        await db_session.commit()
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass

    # Now send another message — should include summary
    captured_all.clear()
    with patch("app.routers.ai_chat.evidence_client.query", side_effect=_mock_evidence_query_ok), \
         patch("app.routers.ai_chat.call_llm_multi_turn", side_effect=mock_call_llm_multi), \
         patch("app.routers.ai_chat.call_llm", side_effect=mock_call_llm):
        r2 = await client.post(
            "/ai/chat",
            json={"message": "Follow-up question", "sessionId": session_id},
        )
        assert r2.status_code == 200

    # The messages sent to LLM should start with summary context
    msgs = captured_all[0]
    assert msgs[0]["role"] == "user"
    assert "先前對話摘要" in msgs[0]["content"]
    assert "肺炎治療方案" in msgs[0]["content"]
    # Second message is the summary acknowledgment
    assert msgs[1]["role"] == "assistant"
    # Last message is the current question
    assert msgs[-1]["role"] == "user"
    assert "Follow-up question" in msgs[-1]["content"]
