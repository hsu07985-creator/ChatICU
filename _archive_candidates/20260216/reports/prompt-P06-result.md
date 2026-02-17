1) Summary
- 已修復 P02~P04 的 Critical/High 問題，並補齊對應測試。
- 本批修復重點：契約對齊、AI 降級語義、Dashboard runtime 防呆。
- Gate 條件「Critical/High 未修復數量 = 0」已達成。

2) Findings
Critical/High Remediation Matrix
| ID | Severity | Fix | Evidence | Rollback Plan |
|---|---|---|---|---|
| C-001 | High | 擴充前端 `messageType` union 對齊後端 | `src/lib/api/messages.ts:10,31` | 還原 `src/lib/api/messages.ts` 兩處 union 變更 |
| C-002 | High | 放寬 `gender/consentStatus` 為 `string` | `src/lib/api/patients.ts:10,20` | 還原 `src/lib/api/patients.ts` 型別欄位 |
| C-003 | High | Checkbox 與陣列欄位防呆（`checked===true`、`?? []`） | `src/pages/patients.tsx:629,639,652,665,697` | 還原 `src/pages/patients.tsx` 指定行 |
| C-004 / FM-001 | High | `/ai/chat` 回傳 `degraded/degradedReason/upstreamStatus` + 前端提示 | `backend/app/routers/ai_chat.py:355-358`, `src/pages/patient-detail.tsx:542-546,877-885`, `backend/tests/test_api/test_ai_chat.py:145-160` | 還原上述檔案並移除新增欄位斷言 |
| CH-005 | High | Dashboard stats 防止 undefined crash（normalize + optional chaining） | `src/lib/api/dashboard.ts:36-58`, `src/pages/dashboard.tsx:184-250` | 還原 dashboard API 正規化與 UI optional chaining |

3) Patch
- 更新 `src/lib/api/messages.ts`
- 更新 `src/lib/api/patients.ts`
- 更新 `src/pages/patients.tsx`
- 更新 `backend/app/routers/ai_chat.py`
- 更新 `src/lib/api/ai.ts`
- 更新 `src/pages/patient-detail.tsx`
- 更新 `backend/tests/test_api/test_ai_chat.py`
- 更新 `src/lib/api/dashboard.ts`
- 更新 `src/pages/dashboard.tsx`

4) Verification
- `npm run typecheck`
  - 證據：PASS（無 TS 錯誤）。
- `backend/.venv312/bin/python -m pytest backend/tests/test_api/test_ai_chat.py -q`
  - 證據：`10 passed`。
- `backend/.venv312/bin/python -m pytest backend/tests/test_api -q`
  - 證據：`65 passed`。
- `npm run test:e2e -- --project=chromium --grep "@critical"`
  - 證據：`1 passed`（critical flow 通過）。

5) Gate
- PROMPT-06 COMPLETE
