# Frontend-Driven API Contract Audit Tracker

> 專案：前端驅動 API 契約盤點與整合修復  
> 版本：v1.0  
> 狀態：`Phase 0/1/2/3/4 完成，Phase 5 進行中（P0-A1 + P0-B1/B2/B3 已實作）`  
> 最後更新：2026-02-17 13:45 CST  
> 負責角色：Principal Frontend-Driven API Contract Auditor + Full-Stack Architect + QA Lead

---

## 0) 任務範圍與目標

以**前端需求為唯一真相來源**，完成：

1. 前端需要 API 全清單  
2. 欄位來源分類（AI 生成 / 直接資料 / 規則計算 / 混合）  
3. 找出 mock、缺失 API、契約不一致  
4. 產出可執行修復計畫（後端實作 + 契約對齊 + 測試）  

---

## 1) 全域 Gate 狀態

| Phase | 名稱 | 狀態 | 完成條件 | 目前結果 | 風險 |
|---|---|---|---|---|---|
| 0 | 專案盤點 | ✅ Completed | 完成前端/後端/DB/AI/MOCK 地圖 | 已完成，見 Phase 0 Project Map | 低 |
| 1 | Frontend Requirement Catalog | ✅ Completed | 逐功能列出 FE 需求契約 | 已完成，見 `reports/phase-1-frontend-requirement-catalog.md` | 中 |
| 2 | Contract Matrix | ✅ Completed | FE vs BE 契約比對 | 已完成，見 `reports/phase-2-contract-matrix.md` | 中 |
| 3 | Field Lineage Matrix | ✅ Completed | 欄位來源分類完成 | 已完成，見 `reports/phase-3-field-lineage-matrix.md` | 中 |
| 4 | Mock/Fake Risk Register | ✅ Completed | mock/fake 證據與替換計畫 | 已完成，見 `reports/phase-4-mock-fake-risk-register.md` | 中 |
| 5 | Prioritized Fix Backlog | 🟡 In Progress | P0/P1/P2 修復藍圖 | 已完成：P0 backlog 拆解；P0-A1 + P0-B1/B2/B3 已實作 | 中 |
| 6 | Verification Plan | ⬜ Not Started | 可執行驗證命令完整 | 未開始 | 中 |

---

## 2) Phase 0 Project Map（已填）

### 2.1 前端（入口 / 路由 / API client / 型別）
- 入口：`src/main.tsx:2`, `src/main.tsx:6`
- 路由：`src/App.tsx:1`, `src/App.tsx:106`, `src/App.tsx:115`, `src/App.tsx:278`
- API client：`src/lib/api-client.ts:5`, `src/lib/api-client.ts:164`, `src/lib/api-client.ts:202`
- API 模組與型別：`src/lib/api/index.ts:1`, `src/lib/api/ai.ts:14`, `src/lib/api/ai.ts:186`, `src/lib/api/ai.ts:225`
- 契約文件：`src/API_SPECIFICATION.md`, `backend/docs/API_CONTRACT.md`

### 2.2 後端（router / service / schema / model）
- 入口：`backend/app/main.py:108`
- routers 掛載：`backend/app/main.py:307`, `backend/app/main.py:325`
- 主要 router：
  - `backend/app/routers/ai_chat.py` (`/ai`)
  - `backend/app/routers/ai_readiness.py` (`/api/v1/ai`)
  - `backend/app/routers/clinical.py` (`/api/v1/clinical`)
  - `backend/app/routers/rag.py` (`/api/v1/rag`)
  - `backend/app/routers/patients.py` (`/patients`)
  - `backend/app/routers/lab_data.py` (`/patients/{patient_id}/lab-data`)
  - `backend/app/routers/vital_signs.py` (`/patients/{patient_id}/vital-signs`)
  - `backend/app/routers/ventilator.py` (`/patients/{patient_id}/ventilator`)
  - `backend/app/routers/medications.py` (`/patients/{patient_id}/medications`)
  - `backend/app/routers/messages.py` (`/patients/{patient_id}/messages`)
  - `backend/app/routers/pharmacy.py` (`/pharmacy`)
- services：
  - `backend/app/services/evidence_client.py`
  - `backend/app/services/llm_services/rag_service.py`
  - `backend/app/services/safety_guardrail.py`
  - `backend/app/services/data_services/*`
  - `backend/app/services/rule_engine/*`
- schemas/models：`backend/app/schemas/*`, `backend/app/models/*`

### 2.3 資料庫（migration / seed / runtime tables）
- migration 路徑：`backend/alembic/versions/001_initial_schema.py` ~ `backend/alembic/versions/006_pharmacy_compatibility_favorites.py`
- seed/mock 資料：
  - `datamock/*.json`
  - `backend/seeds/datamock_source.py`
  - `backend/seeds/seed_data.py`
  - `backend/seeds/seed_if_empty.py`
- 關鍵資料表（runtime）：
  - `users`, `patients`, `lab_data`, `vital_signs`, `ventilator_settings`, `medications`
  - `patient_messages`, `team_chat_messages`
  - `ai_sessions`, `ai_messages`
  - `drug_interactions`, `iv_compatibilities`
  - `pharmacy_advices`, `pharmacy_compatibility_favorites`
  - `audit_logs`, `password_history`

### 2.4 AI 鏈路（provider / prompt / fallback / observability）
- provider 設定：`backend/app/config.py:69`, `backend/app/config.py:70`, `backend/app/config.py:75`
- prompt/template：`backend/app/llm.py:29`（`TASK_PROMPTS`），`backend/app/llm.py:50`（`rag_generation`）
- fallback：
  - hybrid evidence service：`backend/app/services/evidence_client.py:29`
  - local RAG lazy index：`backend/app/routers/ai_chat.py:116`
  - evidence gate blocking/degraded：`backend/app/routers/ai_chat.py:759`, `backend/app/routers/ai_chat.py:798`
  - partial response when data missing/stale：`backend/app/routers/ai_chat.py:767`
- 追蹤欄位與可觀測性：
  - request/trace header：`backend/app/main.py:138`, `backend/app/main.py:165`
  - FE header 注入：`src/lib/api-client.ts:172`
  - audit log：`backend/app/routers/ai_chat.py:901`
  - evidence gate payload：`backend/app/routers/ai_chat.py:882`
  - data freshness payload：`backend/app/utils/data_freshness.py:105`

### 2.5 Mock 來源
- mock-data / fixtures：
  - `datamock/drugInteractions.json`
  - `datamock/labData.json`
  - `datamock/labTrends.json`
  - `datamock/medications.json`
  - `datamock/messages.json`
  - `datamock/patients.json`
  - `datamock/users.json`
- FE mock / stubs：
  - `src/lib/mock-data.ts`
  - `VITE_USE_MOCK` (`.env.example`, `.env.development`)
- Backend offline mode：
  - `DATA_SOURCE_MODE=json` (`backend/app/config.py:22`)
  - datamock validation on startup (`backend/app/main.py:80`)

> 詳細版盤點已輸出：`reports/phase-0-project-map.md`

---

## 3) MCP Tool Plan（Phase 0）

| Step | MCP Tool | Input | Expected Output | Decision Rule | Next Step |
|---|---|---|---|---|---|
| 0-1 | 檔案搜尋/樹狀掃描 | repo root | ✅ 檔案地圖、技術棧線索 | 已找到 FE/BE/DB/AI 入口 | 0-2 |
| 0-2 | 全域文字搜尋 | API route、fetch/axios、mock 關鍵字 | ✅ 呼叫點與定義位置 | 可建立 Project Map | 0-3 |
| 0-3 | 測試命令探測 | package scripts / pytest / e2e config | ✅ 可執行命令清單 | 已確認驗證路徑 | Gate |
| 0-4 | 日誌/執行器（可選） | 本地啟動命令 | ✅ 啟動訊息、錯誤 | 已可啟動 FE/BE | Gate |

### 3.1 MCP/工具能力（本回合）
- `functions.exec_command`：repo 掃描、命令執行、輸出蒐證
- `multi_tool_use.parallel`：平行化批次掃描
- `functions.apply_patch`：可追蹤檔案修改
- `functions.mcp__playwright__*`：UI/瀏覽器驗證

> 本回合盤點依賴上述工具，已足夠進入 Phase 1。

---

## 4) 一次性補件清單（BLOCKER Checklist）

> 狀態：`未完成前，Final Gate 只能是 AUDIT BLOCKED`

- [x] MCP 工具清單（工具名、用途、輸入例、輸出例）
- [x] 前端關鍵路徑（頁面/按鈕/觸發流程）
- [x] 前端 API 呼叫碼位置（File:Line）
- [x] 後端對應 endpoint + service 位置（File:Line）
- [x] 一次完整 Network request/response（已完成手動 API 驗證；待補 HAR 檔）
- [x] 後端同時間 log（含 request_id）已完成，見 `reports/operations/manual-api-evidence-20260217T041454Z/13_backend_log_slice.txt`
- [x] AI provider 呼叫碼與 raw response（可遮敏）已完成，見 `reports/operations/manual-api-evidence-20260217T041454Z/provider_raw/masked_sample.json`
- [x] env 變數名與注入方式（不貼密鑰）

---

## 5) Message Progress Log（訊息追蹤）

| Update # | 時間 | 來源 | 內容摘要 | 影響 Phase | 產出 | 下一步 |
|---|---|---|---|---|---|---|
| 001 | 2026-02-17 11:58 | User | 要求建立 Frontend-Driven API Contract 稽核流程並追蹤進度 | 0 | 本追蹤檔建立 | 蒐集補件 |
| 002 | 2026-02-17 11:58 | Assistant | 建立 Phase/Gate、MCP Plan、補件清單模板 | 0 | `reports/frontend_api_contract_audit_tracker.md` | 進行 repo 掃描 |
| 003 | 2026-02-17 12:00 | Assistant | 完成 FE/BE/DB/AI/mock 路徑盤點與 File:Line 證據 | 0 | `reports/phase-0-project-map.md` | 更新 Gate/Checklist |
| 004 | 2026-02-17 12:02 | Assistant | 完成 Phase 0 追蹤檔實填與阻塞項目標記 | 0 | 本檔更新 | 進入 Phase 1 契約盤點 |
| 005 | 2026-02-17 12:15 | Assistant | 完成前端需求契約目錄（Phase 1）與缺口盤點 | 1 | `reports/phase-1-frontend-requirement-catalog.md` | 製作契約矩陣 |
| 006 | 2026-02-17 12:18 | Assistant | 完成真實資料流手動 API 驗證與證據歸檔（含 request_id + provider raw） | 0/1 | `reports/operations/manual-api-evidence-20260217T041454Z/` | 解除 blocker、進入 Phase 2 |
| 007 | 2026-02-17 12:29 | Assistant | 完成 Phase 2 FE vs BE 契約矩陣，標記 P0/P1 缺口 | 2 | `reports/phase-2-contract-matrix.md` | 開始 P0 端點修復 |
| 008 | 2026-02-17 12:31 | Assistant | 修補 medications P0 缺口（detail/administrations/patch）並完成測試與手動 API 驗證 | 5 | `backend/app/routers/medications.py`, `backend/tests/test_api/test_medications_api.py`, `reports/operations/manual-api-phase2-medications-20260217T043002Z/` | 進入下一個 P1 契約修復 |
| 009 | 2026-02-17 12:43 | Assistant | 修補 vital-signs history `startDate/endDate` 契約對齊，並新增日期篩選測試與手動 API 驗證 | 5 | `backend/app/routers/vital_signs.py`, `backend/tests/test_api/test_contract.py`, `reports/operations/manual-api-phase2-vitals-history-20260217T044226Z-with-data/` | 進入下一個 P1 契約修復 |
| 010 | 2026-02-17 12:52 | Assistant | 收斂 pharmacy 頁面 direct `apiClient` 呼叫至 `src/lib/api/pharmacy.ts` 封裝，完成前端型別與建置驗證 | 5 | `src/lib/api/pharmacy.ts`, `src/pages/pharmacy/workstation.tsx`, `src/pages/pharmacy/interactions.tsx`, `src/pages/pharmacy/compatibility.tsx` | P1 契約缺口關閉 |
| 011 | 2026-02-17 12:57 | Assistant | 完成 Phase 3 欄位血緣矩陣（AI生成/直接資料/規則計算/混合）與 file:line 證據追溯 | 3 | `reports/phase-3-field-lineage-matrix.md` | 進入 Phase 4 mock/fake 風險登錄 |
| 012 | 2026-02-17 13:06 | Assistant | 完成 Phase 4 mock/fake risk register（含風險分級、污染路徑、P0/P1/P2 替換計畫） | 4 | `reports/phase-4-mock-fake-risk-register.md` | 進入 Phase 5 prioritized fix backlog |
| 013 | 2026-02-17 13:11 | Assistant | 完成 Phase 5 P0 backlog 拆解（administrations 真實持久化 + docker 預設 mode 安全化）並定義可實作工單/依賴/驗收 | 5 | `reports/phase-5-prioritized-fix-backlog.md` | 開始實作 P0-A1 / P0-B1 |
| 014 | 2026-02-17 13:24 | Assistant | 實作 P0-B1/P0-B2：docker default 改為 db、新增 offline override，並以 `docker compose config` 驗證結果（db/json） | 5 | `backend/docker-compose.yml`, `backend/docker-compose.offline.yml`, `README.md`, `docs/operations/json-offline-dev-runbook.md` | 進入 P0-B3 或開始 P0-A1 |
| 015 | 2026-02-17 13:36 | Assistant | 實作 P0-B3：後端啟動時記錄 DATA_SOURCE_MODE 與來源（env/.env/default），補強 json mode guardrail 可觀測性 | 5 | `backend/app/main.py` | 進入 P0-B5 或開始 P0-A1 |
| 016 | 2026-02-17 13:45 | Assistant | 實作 P0-A1：新增 `medication_administrations` migration + ORM model + Patient/Medication relationships，並通過 contract 測試 smoke | 5 | `backend/alembic/versions/007_med_admins.py`, `backend/app/models/medication_administration.py`, `backend/app/models/medication.py`, `backend/app/models/patient.py`, `backend/app/models/__init__.py` | 開始 P0-A2/P0-A3 |

---

## 6) 風險總覽（持續更新）

| Risk ID | 類型 | 描述 | 影響 | 可能性 | 等級 | 緩解策略 | Owner | 狀態 |
|---|---|---|---|---|---|---|---|---|
| R-001 | Process | 無完整 MCP 工具能力說明 | 中 | 低 | 🟢 | 已補齊工具表 | Assistant | Closed |
| R-002 | Contract | FE/BE 契約未知差距 | 高 | 高 | 🔴 | 進入 Phase 1/2 建立矩陣 | Assistant + Team | Open |
| R-003 | Mock/Fake | AI 路徑可能假 API 或 mock 汙染 | 高 | 中 | 🟠 | Phase 3/4 欄位血緣與 mock 鑑別 | Assistant + Team | Open |
| R-004 | Evidence | 缺少可歸檔的 request_id 對時 log 與 provider raw response | 中 | 中 | 🟠 | 已補齊並歸檔 | Assistant | Closed |

---

## 7) 後續產出檔案命名規範

- `reports/phase-0-project-map.md`
- `reports/phase-1-frontend-requirement-catalog.md`
- `reports/phase-2-contract-matrix.md`
- `reports/phase-3-field-lineage-matrix.md`
- `reports/phase-4-mock-fake-risk-register.md`
- `reports/phase-5-prioritized-fix-backlog.md`
- `reports/phase-6-verification-plan.md`

---

## 8) Final Gate（本檔狀態）

目前結論：`Phase 5 In Progress / P0-A1 + P0-B1+B2+B3 implemented`  
原因：Phase 0~4 已完成；Phase 5 已完成 docker mode 安全化與 administrations 持久化第一步（schema/model/migration）。  
證據包：
- `reports/phase-2-contract-matrix.md`
- `reports/phase-3-field-lineage-matrix.md`
- `reports/phase-4-mock-fake-risk-register.md`
- `reports/phase-5-prioritized-fix-backlog.md`
- `backend/docker-compose.yml`
- `backend/docker-compose.offline.yml`
- `backend/app/main.py`
- `backend/alembic/versions/007_med_admins.py`
- `backend/app/models/medication_administration.py`
- `reports/operations/manual-api-phase2-medications-20260217T043002Z/`
- `reports/operations/manual-api-phase2-vitals-history-20260217T044226Z-with-data/`  
下一步：開始實作 P0-A2（schema）與 P0-A3（router DB 化），並補 P0-B5（docker mode regression evidence）。
