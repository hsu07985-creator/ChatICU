1) Summary
- 已完成 Medium/Low 修復與可觀測性補強。
- 已統一導入 `[INTG] [API] [DB] [AI] [E2E]` 標籤（核心路徑）。
- 錯誤回應已加入 `request_id/trace_id`，並補上契約測試。

2) Findings
Medium/Low Remediation
- C-005（Admin audit logs 參數漂移）修復：
  - 新增 `user/startDate/endDate`（`backend/app/routers/admin.py:42-46`）。
  - 日期格式校驗與 DB filter（`backend/app/routers/admin.py:24-33`, `backend/app/routers/admin.py:61-66`）。
- C-006（Pharmacy error reports 分頁/type 漂移）修復：
  - 新增 `page/limit/type` 參數與分頁回傳（`backend/app/routers/pharmacy.py:47-52`, `backend/app/routers/pharmacy.py:106-112`）。
  - 新增 stats 區塊（`backend/app/routers/pharmacy.py:113-117`）。
- FM-002（Evidence client 無 retry/backoff）修復：
  - 新增 env 配置 `FUNC_API_RETRY_COUNT`, `FUNC_API_RETRY_BACKOFF_SECONDS`（`backend/app/config.py:74-75`）。
  - 實作 bounded retry/backoff（`backend/app/services/evidence_client.py:31-69`）。
- FM-003（fallback 可觀測性）修復：
  - AI/API fallback 日誌標籤統一（`backend/app/routers/ai_chat.py:238,262,287`）。
  - DB/API 查詢日誌標籤補齊（`backend/app/routers/admin.py:70`, `backend/app/routers/pharmacy.py:66`）。
  - E2E 標籤（`e2e/critical-journey.spec.js:11`, `e2e/t27-extended-journeys.spec.js:10`）。
- 錯誤追蹤：
  - middleware 注入 `X-Request-ID`/`X-Trace-ID`（`backend/app/main.py:127-154`）。
  - `HTTPException/Validation/Unhandled` 回應 body 含 `request_id/trace_id`（`backend/app/main.py:174-238`）。

3) Patch
- 更新 `backend/app/config.py`
- 更新 `backend/app/services/evidence_client.py`
- 更新 `backend/app/main.py`
- 更新 `backend/app/routers/admin.py`
- 更新 `backend/app/routers/pharmacy.py`
- 更新 `backend/tests/test_api/test_contract.py`
- 更新 `e2e/critical-journey.spec.js`
- 更新 `e2e/t27-extended-journeys.spec.js`

4) Verification
- `backend/.venv312/bin/python -m pytest backend/tests/test_api/test_contract.py -q`
  - 證據：`18 passed`（含新加 audit/date/type/request_id 測試）。
- `rg -n "\[INTG\].*\[API\]|\[INTG\].*\[DB\]|\[INTG\].*\[AI\]|\[INTG\].*\[E2E\]" backend/app e2e -g '*.py' -g '*.js'`
  - 證據：命中 `backend/app/routers/admin.py:70`, `backend/app/routers/pharmacy.py:66`, `backend/app/services/evidence_client.py:51,63`, `e2e/*.spec.js`。
- `backend/.venv312/bin/python -m pytest backend/tests/test_api -q`
  - 證據：`65 passed`。

5) Gate
- PROMPT-07 COMPLETE
