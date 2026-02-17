1) Summary
- 已完成 AI 鏈路驗證並修復 `/ai/chat` silent success 問題，現在降級回覆有結構化欄位。
- AI fallback 現在可 grep 到統一可觀測標籤（`[INTG][AI][API]`）。
- P04 Gate 由 INCOMPLETE 轉為 COMPLETE。

2) Findings
AI Flow Matrix（節錄）
| Feature | Entry Endpoint | Model/Service | Fallback Path | DB Write | UI Render | Observability |
|---|---|---|---|---|---|---|
| AI Chat | `POST /ai/chat` | `call_llm_multi_turn` + RAG | LLM 失敗時降級訊息 + `degradedReason` | `ai_sessions`, `ai_messages`, `audit_logs` | `src/pages/patient-detail.tsx:877-885` | `backend/app/routers/ai_chat.py:238`, `backend/app/routers/ai_chat.py:287` |
| RAG Query | `POST /api/v1/rag/query` | `evidence_client.query` | fail -> TF-IDF | None | 間接 | `backend/app/routers/ai_chat.py:238` |

Failure Mode 修復
- FM-001 (High) 修復：
  - 後端補上 `degraded`, `degradedReason`, `upstreamStatus`（`backend/app/routers/ai_chat.py:355-358`）。
  - 前端顯示降級提示，不再當作一般成功答案（`src/pages/patient-detail.tsx:877-885`）。
  - 契約測試補齊（`backend/tests/test_api/test_ai_chat.py:145-160`）。

3) Patch
- 更新 `backend/app/routers/ai_chat.py`
- 更新 `src/lib/api/ai.ts`
- 更新 `src/pages/patient-detail.tsx`
- 更新 `backend/tests/test_api/test_ai_chat.py`

4) Verification
- `backend/.venv312/bin/python -m pytest backend/tests/test_api/test_ai_chat.py -q`
  - 證據：`10 passed`。
- `rg -n "degradedReason|upstreamStatus|\[INTG\]\[AI\]\[API\]" backend/app/routers/ai_chat.py src/pages/patient-detail.tsx src/lib/api/ai.ts`
  - 證據：命中 `backend/app/routers/ai_chat.py:238,287,357,358` 與前端映射/渲染行。

5) Gate
- PROMPT-04 COMPLETE
