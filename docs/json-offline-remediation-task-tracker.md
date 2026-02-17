# ChatICU JSON 離線開發修復 — 任務管理與驗收追蹤

**版本**: v1.1  
**建立日期**: 2026-02-16  
**適用情境**: 尚未連接醫院內網，先以 JSON/seed 資料來源開發與驗證  
**目標**: 在不破壞現有功能前提下，完成核心品質修復並建立可追蹤的驗收流程

---

## 1) 執行原則（固定）

1. 前端只呼叫 API，不直接讀取 mock JSON 檔。  
2. JSON 僅作為 backend 資料來源（seed/provider），不與 UI 直接耦合。  
3. 每個任務必須有：
   - 明確 DoD（Definition of Done）
   - 驗收命令（可重跑）
   - 證據（檔案路徑/測試輸出/commit）
4. 高風險任務（Auth、Contract、核心路由）優先。  
5. 任何任務 FAIL，先記錄 Blocker，再處理下一項。

---

## 2) 進度儀表板

| 指標 | 數值 |
|---|---|
| 總任務數 | 10 個階段（P0-P9） + 9 個 AI 優化任務（AO-00~AO-08） |
| 已完成 | 19（P0, P1, P2, P3, P4, P5, P6, P7, P8, P9, AO-00, AO-01, AO-02, AO-03, AO-04, AO-05, AO-06, AO-07, AO-08） |
| 進行中 | 0 |
| 阻塞 | 0 |
| 最後更新 | 2026-02-17 |

**狀態圖例**
- `[ ]` Not Started
- `[~]` In Progress
- `[x]` Completed
- `[!]` Blocked

---

## 3) 任務看板（Task Board）

### Backlog
- 無

### In Progress
- 無

### Done
- [x] P1 JSON 資料層標準化
- [x] P2 契約防呆與前端崩潰防護
- [x] P3 Auth/權限真實測試補強
- [x] P4 Team Chat 契約一致化
- [x] P5 病患建立流程一次完成
- [x] P6 大型檔案拆分重構
- [x] P7 可觀測性與文件補齊
- [x] P8 CI Gate 固化
- [x] P9 阻塞解除（E2E pass rate >= 95%）
- [x] P0 基線與任務框架建立
- [x] AO-00 Key 佈署與明文移除（config.py -> backend/.env）
- [x] AO-01 AI Readiness Gate（前端按鈕前置檢查）
- [x] AO-02 AI 輸出結構化（summary/explanation/decision schema）
- [x] AO-03 RAG 證據門檻（最小 citations/confidence）
- [x] AO-04 Chat 真串流化（SSE/WebSocket）
- [x] AO-05 clinical-query intent 失效降級策略
- [x] AO-06 JSON 離線模式資料新鮮度/缺值提示
- [x] AO-07 AI Golden Set + 回歸評測
- [x] AO-08 Admin Vectors 真上傳 API 串接（移除模擬上傳）

### Blocked
- 無

---

## 4) 階段執行順序與 DoD

## P0 基線與任務框架

**狀態**: `[x]`  
**優先級**: Critical  
**目的**: 建立可持續追蹤與驗收的管理骨架

### 任務
- [x] 建立本追蹤檔（本文件）
- [x] 定義狀態、DoD、驗收命令、證據欄位
- [x] 建立驗收紀錄區塊（第 6 節）
- [x] 建立對應 issue/分支命名規則（若使用）

### DoD
- 有單一追蹤檔可管理 P0-P9
- 每一階段都有可執行驗收命令與證據欄位

### 驗收命令
```bash
test -f /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/json-offline-remediation-task-tracker.md
```

### 證據
- 文件路徑：`/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/json-offline-remediation-task-tracker.md`
- 命名規則：`/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/operations/issue-branch-naming-convention.md`

### Blocker / 風險
- 暫無

---

## P1 JSON 資料層標準化（離線模式）

**狀態**: `[x]`  
**優先級**: Critical

### 任務
- [x] backend 新增資料來源切換（`DATA_SOURCE_MODE=json|db`）
- [x] JSON seed/provider 單一路徑，移除分散式讀檔
- [x] 啟動前 JSON schema 驗證腳本
- [x] 文件化離線啟動流程

### DoD
- 前端不直接使用 mock 資料
- backend 可在 `json` 模式完整提供核心 API

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api -q
```

### 證據
- 變更檔案：
  - `backend/app/config.py`
  - `backend/seeds/seed_data.py`
  - `backend/seeds/seed_if_empty.py`
  - （新增）JSON schema 驗證腳本

### Blocker / 風險
- JSON 欄位與 API schema 不一致

---

## P2 契約防呆與前端崩潰防護

**狀態**: `[x]`  
**優先級**: Critical

### 任務
- [x] API client 新增 `ensureSuccess/ensureData` guard
- [x] 移除 `response.data.data!` 高風險寫法
- [x] 優先修補頁面：
  - `src/pages/pharmacy/error-report.tsx`
  - `src/pages/admin/placeholder.tsx`
  - `src/pages/admin/users.tsx`

### DoD
- 缺欄位回應時不發生白屏
- 可顯示可理解錯誤訊息

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && npm run typecheck && npm run build
```

### 證據
- 變更檔案：
  - `src/lib/api-client.ts`
  - `src/lib/api/*.ts`
  - `src/pages/pharmacy/error-report.tsx`
  - `src/pages/admin/placeholder.tsx`
  - `src/pages/admin/users.tsx`

### Blocker / 風險
- 部分 API 回應格式歷史包袱過多

---

## P3 Auth/權限真實測試補強

**狀態**: `[x]`  
**優先級**: High

### 任務
- [x] 測試 fixture 分離（mock-auth / real-auth）
- [x] 新增 login/refresh/logout 測試
- [x] 新增 role 403 與 session idle timeout 測試

### DoD
- Auth 關鍵流程有真實測試覆蓋

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api/test_auth* -q
```

### 證據
- 變更檔案：
  - `backend/tests/conftest.py`
  - `backend/tests/test_api/test_auth_*.py`

---

## P4 Team Chat 契約一致化

**狀態**: `[x]`  
**優先級**: High

### 任務
- [x] 統一訊息排序語意（oldest -> newest）
- [x] 修正前端多餘 `reverse()`（若確認不需要）
- [x] 補 API + E2E 驗證

### DoD
- API/UI/E2E 顯示順序一致

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api/test_contract.py -q
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && npm run test:e2e -- --project=chromium --grep "@t27-extended"
```

### 證據
- 變更檔案：
  - `src/pages/chat.tsx`
  - `backend/app/routers/team_chat.py`
  - `backend/tests/test_api/test_contract.py`
  - `e2e/t27-extended-journeys.spec.js`

---

## P5 病患建立流程一次完成

**狀態**: `[x]`  
**優先級**: High

### 任務
- [x] 擴充 `PatientCreate` 支援 UI 建立所需欄位
- [x] 後端 create 一次寫完整資料
- [x] 前端移除 create 後補 patch 邏輯

### DoD
- 病患建立單次 API 完成，無補丁流程

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api -q
```

### 證據
- 變更檔案：
  - `backend/app/schemas/patient.py`
  - `backend/app/routers/patients.py`
  - `src/lib/api/patients.ts`
  - `src/pages/patients.tsx`

---

## P6 大型檔案拆分重構

**狀態**: `[x]`  
**優先級**: Medium

### 任務
- [x] 拆 `src/pages/patient-detail.tsx`
- [x] 拆 `src/pages/pharmacy/workstation.tsx`
- [x] 拆 `backend/app/routers/pharmacy.py`
- [x] 每批拆分後都跑回歸測試

### DoD
- 核心大檔案降到可維護範圍
- 功能與契約不變

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && npm run typecheck && npm run build
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api -q
```

### 證據
- 新增模組與 hooks 路徑
- 對應 import 調整 diff

---

## P7 可觀測性與文件補齊

**狀態**: `[x]`  
**優先級**: Medium

### 任務
- [x] 統一 log tag：`[INTG] [API] [DB] [AI] [E2E]`
- [x] request_id / trace_id 前後端錯誤鏈路確認
- [x] 更新 README（離線模式、啟動、排錯）

### DoD
- 常見錯誤可用單一關鍵字快速追蹤
- 新成員可依 README 獨立啟動

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && rg -n "\\[INTG\\]|\\[API\\]|\\[DB\\]|\\[AI\\]|\\[E2E\\]" backend src e2e
```

### 證據
- 變更檔案：
  - `backend/app/**/*.py`
  - `README.md`

---

## P8 CI Gate 固化

**狀態**: `[x]`  
**優先級**: High

### 任務
- [x] CI 增加 JSON schema validation
- [x] 固定跑 contract + integration + frontend + e2e smoke
- [x] 靜態規則防回歸（except-pass / 危險 CORS / suspicious secrets / 非空斷言策略）

### DoD
- PR 未通過 Gate 不可合併

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && nl -ba .github/workflows/ci.yml | sed -n '1,260p'
```

### 證據
- 變更檔案：
  - `.github/workflows/ci.yml`

---

## P9 阻塞解除（E2E 通過率 >= 95%）

**狀態**: `[x]`  
**優先級**: Critical

### 任務
- [x] 建立受控 E2E 執行器（隔離埠、隔離 Postgres DB、seed、health check、清理）
- [x] `npm run test:e2e` 接管為受控模式，保留 raw 模式
- [x] 全量 E2E 通過率達標（>= 95%）
- [x] 同步 README / Runbook，明確避免埠衝突流程

### DoD
- `npm run test:e2e -- --project=chromium --workers=1` 在本機可重現通過
- E2E pass rate >= 95%
- 可證明不受 8000/4173 既有外部程序污染

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && npm run test:e2e -- --project=chromium --workers=1
```

### 證據
- 變更檔案：
  - `scripts/e2e/run_managed_e2e.sh`
  - `package.json`
  - `README.md`
  - `docs/operations/json-offline-dev-runbook.md`

---

## P0/P1 Follow-up（2026-02-16）密鑰衛生 + Trace 鏈路補強

**狀態**: `[x]`  
**優先級**: Critical

### 任務
- [x] P0：清除本機 `backend/.env` 明文 `OPENAI_API_KEY`
- [x] P0：重跑 tracked files secret pattern scan（不得命中）
- [x] P1：Evidence client 支援 `X-Request-ID`/`X-Trace-ID` 傳遞到 func 服務
- [x] P1：`clinical`/`rag`/`ai_chat` 路由呼叫 evidence service 時帶入 request/trace IDs
- [x] P1：新增 API + service 測試鎖住鏈路，避免回歸

### DoD
- func 服務呼叫具備 request/trace 可追蹤性
- 本機敏感金鑰不以明文存放於 `backend/.env`
- 相關測試通過，無既有功能回歸

### 驗收命令
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend && ./.venv312/bin/pytest tests/test_api/test_clinical.py tests/test_api/test_ai_chat.py tests/test_api/test_rag.py tests/test_services/test_evidence_client.py -q
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu && rg -n -I --no-messages '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z\-_]{35}|sk-[A-Za-z0-9]{20,})' $(git ls-files) || true
```

### 證據
- 變更檔案：
  - `backend/app/services/evidence_client.py`
  - `backend/app/utils/request_context.py`
  - `backend/app/routers/clinical.py`
  - `backend/app/routers/rag.py`
  - `backend/app/routers/ai_chat.py`
  - `backend/tests/test_api/test_clinical.py`
  - `backend/tests/test_api/test_ai_chat.py`
  - `backend/tests/test_api/test_rag.py`
  - `backend/tests/test_services/test_evidence_client.py`

---

## 4.1) AI 優化專案追蹤（同一份檔案）

> 說明：此區塊承接「AI 功能優化」需求，與 P0-P9 同檔追蹤，採 AO 編號管理。  
> 原則：每個 AO 任務需有 DoD、驗收命令、證據路徑。

| 任務 ID | 主題 | 優先級 | 狀態 | DoD（摘要） | 驗收命令（摘要） |
|---|---|---|---|---|---|
| AO-00 | Key 佈署與明文移除（`config.py -> backend/.env`） | Critical | `[x]` | backend LLM key 可用；`config.py` 無明文 export key | `python -m py_compile config.py`；`python check key present` |
| AO-01 | AI Readiness Gate | Critical | `[x]` | AI 功能按鈕會依 key/func/rag 狀態阻擋並顯示原因 | `npm run typecheck && npm run build` + e2e readiness case |
| AO-02 | AI 輸出結構化 | High | `[x]` | summary/explanation/decision 回傳結構化 schema + contract tests | `pytest tests/test_api/test_contract.py -q` |
| AO-03 | RAG 證據門檻 | High | `[x]` | citations/confidence 未達門檻時拒答且前端明確提示 | `pytest tests/test_api/test_ai_chat.py tests/test_api/test_rag.py -q` |
| AO-04 | Chat 真串流化 | Medium | `[x]` | SSE/WebSocket token streaming 可運作，錯誤可恢復 | `npm run test:e2e -- --grep \"chat stream\"` |
| AO-05 | intent 路由降級策略 | High | `[x]` | intent router 失效時 deterministic fallback，可觀測 | `pytest backend/tests/test_api/test_clinical.py -q` |
| AO-06 | JSON 離線資料新鮮度提示 | Medium | `[x]` | AI 回覆附資料時間戳與缺值提示 | `pytest + e2e` |
| AO-07 | AI Golden Set 回歸 | High | `[x]` | 建立可重跑 golden set 與品質閥值 | `scripts/golden/run_clinical_golden.sh` |
| AO-08 | Admin Vectors 真上傳串接 | Medium | `[x]` | 移除前端模擬上傳，改真 API 流程 | `npm run build && cd backend && pytest tests/test_api/test_admin_vectors.py tests/test_api/test_contract.py -q` |

### AO-00 完成證據（本次）
- [x] `backend/.env` 已寫入可用 `OPENAI_API_KEY`（不回顯明文）
- [x] `config.py` 內 legacy `export OPENAI_API_KEY='...'` 已移除並改為安全註記
- [x] `config.py` 可成功編譯（語法正常）

### AO-01 完成證據（本次）
- [x] 後端新增 `GET /api/v1/ai/readiness`，輸出 `llm/evidence/rag/feature_gates/blocking_reasons/display_reasons`
- [x] 前端 AI 主要入口（chat、summary、clinical polish）已接 readiness gate 並顯示阻擋原因
- [x] 新增 AO-01 API 測試與 E2E readiness case（禁用聊天輸入）
- [x] managed E2E 腳本預設關閉 `RAG_DOCS_PATH` 自動索引，避免 readiness case 被啟動時間拖垮

### AO-02 完成證據（本次）
- [x] `clinical` 三支端點新增結構化回傳欄位（`summary_structured` / `explanation_structured` / `decision_structured`）
- [x] 保留既有字串欄位（`summary` / `explanation` / `recommendation`）以維持前端相容
- [x] 新增 contract + API 測試驗證 schema（AO-02）

### AO-03 完成證據（本次）
- [x] 新增 evidence gate（最小 citations + confidence）與門檻設定（`RAG_MIN_CITATIONS`、`RAG_MIN_CONFIDENCE`）
- [x] `POST /ai/chat` 未達門檻時拒答，不呼叫 LLM，回傳明確 `degradedReason=insufficient_evidence`
- [x] `POST /api/v1/rag/query` 未達門檻時拒答，回傳 `rejected/rejectedReason/displayReason/evidence_gate`
- [x] 前端聊天降級原因文案加入證據門檻對應說明

### AO-04 完成證據（本次）
- [x] 後端新增 `POST /ai/chat/stream`（SSE），事件型別含 `start/delta/done/error`
- [x] 前端 `streamChatMessage` 改為真 SSE 串流解析（含 CRLF 正規化、錯誤處理、初始失敗 fallback）
- [x] 病患詳情聊天頁改為增量渲染 assistant 回覆（token chunk 持續顯示）
- [x] 補齊 AO-04 測試：backend stream API 測試 + E2E chat stream case

### AO-05 完成證據（本次）
- [x] `clinical-query` 對 intent router/evidence service 失效新增 deterministic fallback
- [x] fallback 回傳補上可觀測欄位（`fallback.applied/strategy/reason/resolved_intent`）
- [x] fallback 支援 dose / interaction / knowledge_qa 三路徑，維持回應 schema 穩定
- [x] 補齊 AO-05 測試：router 失效、HTTP error、router down 三情境

### AO-06 完成證據（本次）
- [x] 後端新增共用 `dataFreshness` 計算器（含 `as_of`、sections staleness、`missing_fields`、`hints`）
- [x] AI 回覆已附 `dataFreshness`：`/ai/chat`、`/ai/sessions/{id}`、`/api/v1/clinical/*`（summary/explanation/guideline/decision/polish）
- [x] 前端聊天與病患摘要頁顯示「資料新鮮度/缺值提示」訊息（使用 `dataFreshness.hints`）
- [x] 補齊 AO-06 測試：backend API 測試 + e2e chat stream 顯示驗證

### AO-07 完成證據（本次）
- [x] 新增 golden regression 可執行腳本：`scripts/golden/run_clinical_golden.sh`、`scripts/golden/run_regression_gate.sh`
- [x] `func/scripts/run_clinical_golden.py` 新增品質閥值 gate（overall/dose/interaction）與 `quality_gate` 輸出
- [x] 實跑 golden regression 通過（60/60，threshold=1.0）

### AO-08 完成證據（本次）
- [x] 後端新增 `POST /admin/vectors/upload`（multipart/form-data）並接入實體檔案儲存 + reindex + audit log
- [x] 前端移除模擬上傳，改為真實 multipart 上傳與 progress callback
- [x] 補齊 AO-08 測試：`test_admin_vectors.py` + `test_contract.py` multipart surface contract

---

## 5) 每日更新規範（Task Management SOP）

每日收工前更新以下 5 項：

1. `進度儀表板` 的 completed/in-progress/blocked 數字  
2. `Task Board`（Backlog/In Progress/Done/Blocked）  
3. 當日完成任務的 DoD 勾選結果  
4. `驗收紀錄`（命令、PASS/FAIL、關鍵輸出）  
5. `Blocker 日誌`（若有）

---

## 6) 驗收紀錄（Execution Log）

| 日期 | 階段 | 命令 | 結果 | 關鍵輸出摘要 | 證據路徑 |
|---|---|---|---|---|---|
| 2026-02-16 | Baseline | `npm run typecheck` | PASS | TypeScript check 無錯誤 | CLI output |
| 2026-02-16 | Baseline | `npm run build` | PASS | Build 完成；有 chunk size 警告（非阻斷） | CLI output |
| 2026-02-16 | Baseline | `pytest tests/test_api/test_contract.py tests/test_api/test_ai_chat.py tests/test_api/test_pharmacy_advice.py tests/test_api/test_cors.py -q` | PASS | `43 passed, 1 warning` | CLI output |
| 2026-02-16 | P1-1 | 設定 `DATA_SOURCE_MODE` 與啟動模式觀測 | PASS | 新增 `DATA_SOURCE_MODE`/`DATAMOCK_DIR` 設定與啟動日誌輸出 | `backend/app/config.py`, `backend/app/main.py`, `backend/.env.example`, `backend/docker-compose.yml` |
| 2026-02-16 | P1-2 | datamock 單一路徑讀取模組化 | PASS | 新增共享載入模組，`seed_data.py` 改由單一來源讀取 | `backend/seeds/datamock_source.py`, `backend/seeds/seed_data.py` |
| 2026-02-16 | P1-3 | 啟動前 JSON schema 驗證 | PASS | 新增 datamock 驗證腳本，並接入 `seed_data`、`json mode` 啟動流程、docker compose 啟動鏈 | `backend/seeds/validate_datamock.py`, `backend/seeds/seed_data.py`, `backend/app/main.py`, `backend/docker-compose.yml` |
| 2026-02-16 | P1-4 | 離線 JSON 模式 runbook | PASS | 新增離線模式啟動/驗證/排錯文件 | `docs/operations/json-offline-dev-runbook.md` |
| 2026-02-16 | P1-Verify | `python -m seeds.validate_datamock` | PASS | datamock 結構驗證通過（users/patients/medications/labData/messages/interactions） | CLI output |
| 2026-02-16 | P1-Verify | `pytest tests/test_api/test_contract.py tests/test_api/test_ai_chat.py tests/test_api/test_pharmacy_advice.py tests/test_api/test_cors.py -q` | PASS | `43 passed, 1 warning in 42.90s` | CLI output |
| 2026-02-16 | P1-Reverify | `./.venv312/bin/python -m seeds.validate_datamock` | PASS | `Datamock validation passed`（counts: users=4, patients=4, medications=11, labData=4, patientMessages=10, teamChatMessages=5） | CLI output |
| 2026-02-16 | P1-Reverify | `./.venv312/bin/pytest tests/test_api/test_contract.py tests/test_api/test_ai_chat.py tests/test_api/test_pharmacy_advice.py tests/test_api/test_cors.py -q` | PASS | `43 passed, 1 warning in 42.31s` | CLI output |
| 2026-02-16 | P2-1 | API client 契約 guard | PASS | 新增 `ensureSuccess`/`ensureData`/`getApiErrorMessage`，refresh token 流程改為 guard 驗證 | `src/lib/api-client.ts` |
| 2026-02-16 | P2-2 | 移除高風險 `response.data.data!` | PASS | `src/lib/api/*.ts` 已無 `response.data.data!`（以 `ensureData(...)` 取代） | `src/lib/api/*.ts` |
| 2026-02-16 | P2-3 | 優先頁面錯誤防呆 | PASS | `error-report`/`admin placeholder`/`admin users` 改為顯示可理解錯誤訊息 | `src/pages/pharmacy/error-report.tsx`, `src/pages/admin/placeholder.tsx`, `src/pages/admin/users.tsx` |
| 2026-02-16 | P2-Verify | `npm run typecheck` | PASS | TypeScript strict 檢查通過 | CLI output |
| 2026-02-16 | P2-Verify | `npm run build` | PASS | 前端 production build 成功（僅 chunk size warning，非阻斷） | CLI output |
| 2026-02-16 | P2-Verify | `rg -n "response\\.data\\.data!" src/lib/api src/pages` | PASS | 無匹配結果（高風險寫法已移除） | CLI output |
| 2026-02-16 | P2-3b | `admin/users` 載入失敗訊息一致化 | PASS | `loadData()` 改為 `getApiErrorMessage`，避免僅顯示固定網路錯誤 | `src/pages/admin/users.tsx` |
| 2026-02-16 | P2-Reverify | `npm run typecheck` | PASS | 補修後 TypeScript strict 檢查通過 | CLI output |
| 2026-02-16 | P2-Reverify | `npm run build` | PASS | 補修後 production build 成功（僅 chunk size warning，非阻斷） | CLI output |
| 2026-02-16 | P3-1 | fixture 分離（mock-auth / real-auth） | PASS | 新增 `mock_auth_client`、`real_auth_client`、`test_redis`，保留 `client` 為相容別名 | `backend/tests/conftest.py` |
| 2026-02-16 | P3-2 | login/refresh/logout 測試落地 | PASS | 新增 login/refresh/logout 真實流程測試（token rotation/revocation） | `backend/tests/test_api/test_auth_flows.py` |
| 2026-02-16 | P3-3 | role 403 + idle timeout 測試落地 | PASS | 新增角色權限拒絕與閒置逾時失效測試 | `backend/tests/test_api/test_auth_flows.py` |
| 2026-02-16 | P3-Verify | `./.venv312/bin/pytest tests/test_api/test_auth* -q` | PASS | `7 passed, 5 warnings in 5.44s` | CLI output |
| 2026-02-16 | P3-Reverify | `./.venv312/bin/pytest tests/test_api/test_contract.py tests/test_api/test_cors.py -q` | PASS | fixture 分離後既有 mock-auth API 測試仍通過（`20 passed, 1 warning`） | CLI output |
| 2026-02-16 | P4-1 | Team Chat 排序語意對齊 | PASS | 後端 `list_team_chat` 改為 `timestamp asc` 並移除 `reversed()` | `backend/app/routers/team_chat.py` |
| 2026-02-16 | P4-2 | 前端移除多餘 `reverse()` | PASS | Chat 頁面改為直接使用 API 順序（oldest->newest）並新增 `data-testid` 供 E2E 驗證 | `src/pages/chat.tsx` |
| 2026-02-16 | P4-3 | API + E2E 驗證補齊 | PASS | 新增 Team Chat 順序契約測試（backend）與排序 E2E（reload 後仍維持 oldest->newest） | `backend/tests/test_api/test_contract.py`, `e2e/t27-extended-journeys.spec.js` |
| 2026-02-16 | P4-Verify | `./.venv312/bin/pytest tests/test_api/test_contract.py -q` | PASS | `19 passed, 1 warning in 12.52s` | CLI output |
| 2026-02-16 | P4-Verify | `npm run test:e2e -- --project=chromium --grep "@t27-extended"` | PASS | `4 passed (6.1s)`，新增 Team Chat 排序情境通過 | CLI output |
| 2026-02-16 | P5-1 | 擴充 `PatientCreate` 欄位 | PASS | `PatientCreate` 新增 `ventilator_days/has_dnr/is_isolated/sedation/analgesia/nmb` 等欄位 | `backend/app/schemas/patient.py` |
| 2026-02-16 | P5-2 | 後端 create 單次完整寫入 | PASS | `create_patient` 已一次寫入 UI 所需核心欄位，不需後續 patch | `backend/app/routers/patients.py` |
| 2026-02-16 | P5-3 | 前端移除 create 後補 patch | PASS | `createPatient` 對齊完整欄位映射，`patients.tsx` 改為單次 create，刪除 create 後 `updatePatient` | `src/lib/api/patients.ts`, `src/pages/patients.tsx` |
| 2026-02-16 | P5-4 | 建立流程測試補強 | PASS | 新增單次 create 完整寫入測試（含欄位回讀驗證） | `backend/tests/test_api/test_patients_create.py` |
| 2026-02-16 | P5-Verify | `./.venv312/bin/pytest tests/test_api/test_patients_create.py -q` | PASS | `2 passed, 1 warning` | CLI output |
| 2026-02-16 | P5-Verify | `npm run typecheck && npm run build` | PASS | 前端型別與建置通過（僅 chunk size warning，非阻斷） | CLI output |
| 2026-02-16 | P5-Verify | `./.venv312/bin/pytest tests/test_api -q` | PASS | `77 passed, 5 warnings in 98.46s` | CLI output |
| 2026-02-16 | P6-1 | 拆分 `patient-detail` summary tab | PASS | `patient-detail.tsx` 2078 → 1668 行；新增 `patient-summary-tab.tsx` 458 行承接 summary/AI 區塊 | `src/pages/patient-detail.tsx`, `src/components/patient/patient-summary-tab.tsx` |
| 2026-02-16 | P6-1-Verify | `npm run typecheck` | PASS | summary 模組化後 TypeScript 檢查通過 | CLI output |
| 2026-02-16 | P6-2 | 拆分 `pharmacy/workstation.tsx` | PASS | `workstation.tsx` 1197 → 713 行；抽離 `types.ts`、`assessment-results-panel.tsx`、`advice-submit-dialog.tsx` | `src/pages/pharmacy/workstation.tsx`, `src/pages/pharmacy/workstation/types.ts`, `src/pages/pharmacy/workstation/assessment-results-panel.tsx`, `src/pages/pharmacy/workstation/advice-submit-dialog.tsx` |
| 2026-02-16 | P6-2-Verify | `npm run typecheck` | PASS | workstation 模組化後 TypeScript 檢查通過 | CLI output |
| 2026-02-16 | P6-3 | 拆分 `backend/app/routers/pharmacy.py` | PASS | `pharmacy.py` 662 → 15 行；拆為 `pharmacy_routes/*` 4 個子路由模組，由原入口聚合 | `backend/app/routers/pharmacy.py`, `backend/app/routers/pharmacy_routes/*.py` |
| 2026-02-16 | P6-3-Verify | `./.venv312/bin/pytest tests/test_api/test_pharmacy_advice.py tests/test_api/test_pharmacy_favorites.py tests/test_api/test_contract.py -q` | PASS | `33 passed, 1 warning` | CLI output |
| 2026-02-16 | P6-Verify | `npm run typecheck && npm run build` | PASS | 前端重構後型別與建置通過（僅 chunk size warning，非阻斷） | CLI output |
| 2026-02-16 | P6-Verify | `./.venv312/bin/pytest tests/test_api -q` | PASS | `77 passed, 5 warnings in 72.51s` | CLI output |
| 2026-02-16 | P7-1 | 統一 observability log tag | PASS | backend/ai/api/auth/rag/main 與 frontend api-client 日誌統一含 `[INTG]` 主標籤 | `backend/app/main.py`, `backend/app/routers/rag.py`, `backend/app/routers/ai_chat.py`, `backend/app/routers/auth.py`, `backend/app/routers/clinical.py`, `src/lib/api-client.ts` |
| 2026-02-16 | P7-2 | request_id/trace_id 前後端鏈路補齊 | PASS | 前端 request interceptor 自動附加 `X-Request-ID`/`X-Trace-ID`，錯誤訊息與 console 帶回傳 IDs；新增 contract 測試驗證 header/body propagation | `src/lib/api-client.ts`, `backend/tests/test_api/test_contract.py` |
| 2026-02-16 | P7-3 | README/Runbook 補齊離線啟動與排錯 | PASS | README 新增離線啟動、驗證、埠衝突排查與 request_id/trace_id 追查章節；runbook 同步補充 | `README.md`, `docs/operations/json-offline-dev-runbook.md` |
| 2026-02-16 | P7-Verify | `rg -n "\\[INTG\\]|\\[API\\]|\\[DB\\]|\\[AI\\]|\\[E2E\\]" backend src e2e` | PASS | 命中 backend/src/e2e 主要觀測路徑且包含統一 tag | CLI output |
| 2026-02-16 | P7-Verify | `npm run typecheck && npm run build` | PASS | 前端型別與建置通過（僅 chunk size warning，非阻斷） | CLI output |
| 2026-02-16 | P7-Verify | `./.venv312/bin/pytest tests/test_api/test_contract.py -q` | PASS | `21 passed, 1 warning`（含 request_id/trace_id propagation 新測試） | CLI output |
| 2026-02-16 | P7-Reverify | `./.venv312/bin/pytest tests/test_api -q` | PASS | `79 passed, 5 warnings in 73.10s` | CLI output |
| 2026-02-16 | P8-1 | CI 新增 datamock JSON 驗證 gate | PASS | `backend-test` job 新增 `python -m seeds.validate_datamock`（JSON mode，含 `DATAMOCK_DIR`/`JWT_SECRET` env） | `.github/workflows/ci.yml` |
| 2026-02-16 | P8-2 | CI 新增 non-null assertion 防線 | PASS | `static-integration-guards` 新增阻擋 `response.data.data!` 規則 | `.github/workflows/ci.yml` |
| 2026-02-16 | P8-3 | CI Gate 覆蓋確認 | PASS | workflow 仍固定執行 contract/integration/frontend typecheck+build/e2e smoke，並含 except-pass、dangerous CORS、secret pattern 靜態阻擋 | `.github/workflows/ci.yml` |
| 2026-02-16 | P8-Verify | `./.venv312/bin/python -m seeds.validate_datamock && ./.venv312/bin/pytest tests/test_api/test_contract.py -q` | PASS | datamock 驗證通過；contract 測試 `21 passed` | CLI output |
| 2026-02-16 | P8-Verify | `./.venv312/bin/pytest tests/test_api -q` | PASS | backend integration `79 passed, 5 warnings` | CLI output |
| 2026-02-16 | P8-Verify | `npm run typecheck && npm run build` | PASS | 前端型別與建置通過（僅 chunk size warning，非阻斷） | CLI output |
| 2026-02-16 | P8-Verify | `npm run test:e2e -- --list` | PASS | Playwright smoke 清單可列出 6 條情境（含 @critical） | CLI output |
| 2026-02-16 | P8-Verify | `rg static guards (except-pass/cors/secret/non-null)` | PASS | 四項靜態規則本地執行皆 PASS，無誤判 | CLI output |
| 2026-02-16 | P9-0 | `lsof -nP -iTCP:8000 -sTCP:LISTEN` + process cwd probe | PASS | 發現既有 8000 程序來自其他專案路徑，確認為 E2E 污染源 | CLI output |
| 2026-02-16 | P9-1 | 新增受控 E2E 執行器並接管 `npm run test:e2e` | PASS | 自動隔離埠、重建 Postgres 測試 DB、seed、啟停服務、清理程序 | `scripts/e2e/run_managed_e2e.sh`, `package.json` |
| 2026-02-16 | P9-2 | 文件補齊避免埠衝突與 raw/managed 模式 | PASS | README/Runbook 新增 managed E2E 與 `E2E_MANAGED_SERVERS=0` 用法 | `README.md`, `docs/operations/json-offline-dev-runbook.md` |
| 2026-02-16 | P9-Verify | `npm run test:e2e -- --project=chromium --workers=1` | PASS | `6 passed (46.2s)`，report 統計 pass_rate=`100.0%`（6/6） | CLI output, `output/playwright/report.json` |
| 2026-02-16 | P9-Verify | `./.venv312/bin/pytest tests/test_api/test_contract.py -q` | PASS | `21 passed, 1 warning` | CLI output |
| 2026-02-16 | P9-Verify | `./.venv312/bin/pytest tests/test_api -q` | PASS | `79 passed, 5 warnings` | CLI output |
| 2026-02-16 | P9-Verify | `npm run typecheck` | PASS | TypeScript 檢查通過 | CLI output |
| 2026-02-16 | P9-Verify | `rg except-pass/non-null guards` | PASS | `except...pass` 與 `response.data.data!` 無命中 | CLI output |
| 2026-02-16 | P0-4 | issue/branch/commit 命名規範落盤 | PASS | 建立 `INTG-PXX-<seq>` + `codex/intg-pXX-*` + `fix(integration): [PXX] ...` 規範文件 | `docs/operations/issue-branch-naming-convention.md` |
| 2026-02-16 | Closure-Sec | key rotation runbook + tracked secret scan | PASS | 建立輪替 runbook 並執行 tracked-files secret scan（無命中） | `docs/operations/key-rotation-runbook.md`, CLI output |
| 2026-02-16 | Closure-Sec-Exec | `bash ./scripts/ops/run_key_rotation_acceptance.sh` | PASS | 產生 `key-rotation-acceptance-20260216T112413Z.md`，自動驗證全 PASS（含 contract/integration/typecheck/e2e critical） | `reports/operations/key-rotation-acceptance-20260216T112413Z.md` |
| 2026-02-16 | P0-Followup | 清除本機 `backend/.env` 的 `OPENAI_API_KEY` | PASS | `OPENAI_API_KEY=`（空值） | `backend/.env` |
| 2026-02-16 | P0-Followup-Verify | `rg secret pattern in tracked files` | PASS | 無輸出（no match） | CLI output |
| 2026-02-16 | P1-Followup | Evidence outbound trace propagation | PASS | `EvidenceClient` 全部 HTTP 方法支援 `request_id/trace_id` 並寫入 header | `backend/app/services/evidence_client.py` |
| 2026-02-16 | P1-Followup | 路由層 trace 傳遞 | PASS | `clinical/rag/ai_chat` 呼叫 evidence client 時均傳入 `evidence_trace_kwargs(request)` | `backend/app/routers/clinical.py`, `backend/app/routers/rag.py`, `backend/app/routers/ai_chat.py` |
| 2026-02-16 | P1-Followup-Verify | `./.venv312/bin/pytest tests/test_api/test_clinical.py tests/test_api/test_ai_chat.py tests/test_api/test_rag.py tests/test_services/test_evidence_client.py -q` | PASS | `38 passed, 1 warning in 52.32s` | CLI output |
| 2026-02-16 | AO-00-1 | `config.py -> backend/.env` key 佈署 | PASS | 已由 `config.py` 來源套用至 backend `.env`（不回顯明文） | `backend/.env` |
| 2026-02-16 | AO-00-2 | 清理 `config.py` 明文 key export | PASS | `export OPENAI_API_KEY='...'` 已改為安全註記，避免洩漏與語法錯誤 | `config.py` |
| 2026-02-16 | AO-00-Verify | `python -m py_compile config.py` + masked key check | PASS | `config.py compile: PASS`；`backend/.env OPENAI_API_KEY present=True`、`prefix=sk-proj...` | CLI output |
| 2026-02-16 | AO-01-1 | 後端 AI readiness endpoint + contract spot check | PASS | 新增 `/api/v1/ai/readiness` 與 `feature_gates`；contract 測試納入 endpoint envelope 驗證 | `backend/app/routers/ai_readiness.py`, `backend/app/main.py`, `backend/tests/test_api/test_ai_readiness.py`, `backend/tests/test_api/test_contract.py` |
| 2026-02-16 | AO-01-2 | 前端 AI Gate 串接（chat/summary/polish） | PASS | 病患詳情頁、病歷摘要、病歷記錄、藥師建議按鈕依 readiness 禁用並顯示原因 | `src/lib/api/ai.ts`, `src/pages/patient-detail.tsx`, `src/components/patient/patient-summary-tab.tsx`, `src/components/medical-records.tsx`, `src/components/pharmacist-advice-widget.tsx` |
| 2026-02-16 | AO-01-3 | managed E2E startup hardening | PASS | 預設 `RAG_DOCS_PATH` 為空，避免本地大檔 RAG 自動索引拖慢健康檢查 | `scripts/e2e/run_managed_e2e.sh` |
| 2026-02-16 | AO-01-Verify | `cd backend && ./.venv312/bin/pytest tests/test_api/test_ai_readiness.py tests/test_api/test_contract.py -q` | PASS | `25 passed, 1 warning in 15.08s` | CLI output |
| 2026-02-16 | AO-01-Verify | `npm run typecheck && npm run build` | PASS | 前端型別/建置通過（僅 chunk size warning，非阻斷） | CLI output |
| 2026-02-16 | AO-01-Verify | `npm run test:e2e -- --project=chromium --grep "ai readiness gate"` | PASS | `1 passed (6.7s)`（readiness gate: chat input disabled when not ready） | `e2e/t27-extended-journeys.spec.js` |
| 2026-02-16 | AO-02/03-1 | 結構化 schema + evidence gate 實作 | PASS | `clinical` 新增 `*_structured`；`ai_chat/rag_query` 新增 citations/confidence 門檻拒答 | `backend/app/routers/clinical.py`, `backend/app/routers/ai_chat.py`, `backend/app/routers/rag.py`, `backend/app/utils/structured_output.py`, `backend/app/utils/evidence_gate.py`, `backend/app/config.py` |
| 2026-02-16 | AO-02/03-Verify | `cd backend && ./.venv312/bin/pytest tests/test_api/test_contract.py tests/test_api/test_clinical.py tests/test_api/test_ai_chat.py tests/test_api/test_rag.py -q` | PASS | `64 passed, 1 warning in 50.33s` | CLI output |
| 2026-02-16 | AO-02/03-Verify | `npm run typecheck` | PASS | 前端型別檢查通過 | CLI output |
| 2026-02-16 | AO-04/05-1 | Chat stream + intent fallback 實作 | PASS | 新增 `/ai/chat/stream` SSE 與 `clinical-query` deterministic fallback（含 observability 欄位） | `backend/app/routers/ai_chat.py`, `backend/app/routers/clinical.py`, `src/lib/api/ai.ts`, `src/pages/patient-detail.tsx` |
| 2026-02-16 | AO-04/05-Verify | `cd backend && ./.venv312/bin/pytest tests/test_api/test_ai_chat.py tests/test_api/test_clinical.py -q` | PASS | `38 passed, 1 warning` | CLI output |
| 2026-02-16 | AO-04-Verify | `npm run test:e2e -- --project=chromium --grep "chat stream"` | PASS | `1 passed`（SSE chunk stream rendering） | `e2e/t27-extended-journeys.spec.js` |
| 2026-02-16 | AO-06-1 | JSON 離線資料新鮮度/缺值提示實作 | PASS | 新增 `dataFreshness` 共用工具並接入 AI chat + clinical 回覆與前端顯示 | `backend/app/utils/data_freshness.py`, `backend/app/routers/ai_chat.py`, `backend/app/routers/clinical.py`, `src/lib/api/ai.ts`, `src/pages/patient-detail.tsx`, `src/components/patient/patient-summary-tab.tsx` |
| 2026-02-16 | AO-06-Verify | `cd backend && ./.venv312/bin/pytest tests/test_api/test_ai_chat.py tests/test_api/test_clinical.py -q` | PASS | `39 passed, 1 warning in 10.92s` | CLI output |
| 2026-02-16 | AO-06-Verify | `npm run typecheck && npm run test:e2e -- --project=chromium --grep "chat stream"` | PASS | 前端型別通過；`chat stream` e2e `1 passed` 且顯示資料新鮮度提示 | `e2e/t27-extended-journeys.spec.js` |
| 2026-02-17 | AO-07-1 | 建立 golden regression 腳本與 gate | PASS | 新增 `scripts/golden/run_clinical_golden.sh`、`scripts/golden/run_regression_gate.sh`；`run_clinical_golden.py` 新增 `quality_gate` 與 threshold 參數 | `scripts/golden/run_clinical_golden.sh`, `scripts/golden/run_regression_gate.sh`, `func/scripts/run_clinical_golden.py` |
| 2026-02-17 | AO-07-Verify | `scripts/golden/run_clinical_golden.sh` | PASS | `total=60 passed=60 failed=0 pass_rate=1.0`；`quality_gate.passed=true` | `func/evidence_rag_data/logs/clinical_golden_report.json` |
| 2026-02-17 | AO-08-1 | Admin vectors 真上傳 API + 前端串接 | PASS | 新增 `/admin/vectors/upload`；前端改為真上傳（含進度）並移除模擬流程 | `backend/app/routers/admin.py`, `src/lib/api/admin.ts`, `src/pages/admin/vectors.tsx` |
| 2026-02-17 | AO-08-Verify | `cd backend && ./.venv312/bin/pytest tests/test_api/test_admin_vectors.py tests/test_api/test_contract.py -q` | PASS | `27 passed, 1 warning in 14.84s` | `backend/tests/test_api/test_admin_vectors.py`, `backend/tests/test_api/test_contract.py` |
| 2026-02-17 | AO-08-Verify | `npm run typecheck && npm run build` | PASS | 前端型別與建置皆通過（僅 chunk size warning，非阻斷） | CLI output |

---

## 7) Blocker 日誌

| 日期 | 階段 | Blocker | 影響 | 暫行方案 | 解除條件 |
|---|---|---|---|---|---|
| - | - | - | - | - | - |

---

## 8) 回滾策略（每階段共通）

1. 每階段至少一個 commit（建議：`fix(integration): [P#] ...`）  
2. 失敗回滾：`git revert <commit_sha>`（禁止破壞性 reset）  
3. 回滾後需重跑對應驗收命令並寫入第 6 節
