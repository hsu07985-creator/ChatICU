1) Summary
- 已產生 10 條高價值 E2E 核心流程藍圖，覆蓋 Auth/Dashboard/Team Chat/Admin/Clinical/RAG/Pharmacy/AI Chat。
- 每條情境皆包含 4 類斷言：UI 觸發、API 契約、DB 狀態、UI 最終渲染。

2) Findings
Top 10 E2E Scenarios
1. Auth Login/Logout
- UI: 提交登入表單後進入 `/dashboard`。
- API: `POST /auth/login` 回傳 `success=true` 與 token。
- DB: `users.last_login` 更新。
- UI Render: 側邊欄與使用者資訊可見。
2. Dashboard Load
- UI: 進入儀表板。
- API: `GET /dashboard/stats` 契約欄位完整。
- DB: patients/medications/messages 統計一致。
- UI Render: 無 `undefined` 或 runtime crash。
3. Team Chat Send
- UI: 發送訊息成功。
- API: `POST /team/chat` 回傳新訊息。
- DB: `team_chat_messages` 新增。
- UI Render: 訊息列表即時出現。
4. Admin Audit Filters
- UI: 套用 user/date filter。
- API: `GET /admin/audit-logs?user&startDate&endDate`。
- DB: `audit_logs` 過濾結果正確。
- UI Render: 分頁/統計同步更新。
5. Admin User Update
- UI: 編輯用戶角色/狀態。
- API: `PATCH /admin/users/{id}`。
- DB: `users` 與 `password_history` 一致。
- UI Render: 列表與統計反映變更。
6. Clinical Summary
- UI: 病患頁觸發摘要。
- API: `POST /api/v1/clinical/summary`。
- DB: `audit_logs` 寫入。
- UI Render: 顯示摘要與安全警示。
7. RAG Status + Query
- UI: 讀取 RAG 狀態並發問。
- API: `GET /api/v1/rag/status`, `POST /api/v1/rag/query`。
- DB: 不需寫入或僅 audit。
- UI Render: 顯示可理解回覆/fallback 提示。
8. AI Chat Session Lifecycle
- UI: 發送訊息、重新載入歷史。
- API: `POST /ai/chat`, `GET /ai/sessions/{id}`。
- DB: `ai_sessions/ai_messages` 寫入與讀回一致。
- UI Render: 回覆、參考來源、降級提示正常。
9. Pharmacy Workstation Advice
- UI: 建立藥事建議。
- API: `POST /pharmacy/advice-records`。
- DB: `pharmacy_advices` + `patient_messages` 同步。
- UI Render: 建議列表與病患留言同步。
10. Pharmacy Error Report Flow
- UI: 建立 + 篩選通報。
- API: `POST /pharmacy/error-reports`, `GET /pharmacy/error-reports?page&limit&type`。
- DB: `error_reports` 與狀態統計一致。
- UI Render: 分頁、統計、篩選結果正確。

3) Patch
- 新增 `reports/prompt-P05-result.md`

4) Verification
- `npm run test:e2e -- --list`
  - 證據：列出 5 條現有 Playwright 流程，可作為藍圖落地起點。
- `rg -n "@critical|@pharmacy|@t27-extended" e2e/*.spec.js`
  - 證據：現有標記可映射到核心流程擴充。

5) Gate
- PROMPT-05 COMPLETE
