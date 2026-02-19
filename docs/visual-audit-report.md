# Visual Audit Report — ChatICU 前端/後端修正總覽

> **Branch:** `ai/meds-layout-api-sync`
> **日期:** 2026-02-19
> **範圍:** 前端 UI 修正、API 對齊、安全強化、Mock 移除

---

## 一、18 項修正總覽表

| # | 優先級 | 修正項目 | 修改檔案 | 狀態 |
|---|--------|----------|----------|------|
| 1 | **P0** | Mock 資料完全移除 | `src/lib/mock-data.ts`（刪除）、12+ 頁面 | ✅ 完成 |
| 2 | **P0** | httpOnly Cookie JWT 認證 | `api-client.ts`, `auth.ts`, `auth-context.tsx`, `middleware/auth.py`, `routers/auth.py` | ✅ 完成 |
| 3 | **P0** | JWT Secret 啟動驗證 (fail-closed) | `backend/app/config.py:113-132` | ✅ 完成 |
| 4 | **P0** | 帳號鎖定 (5 次失敗 / 15 分鐘) | `config.py:66-68`, `routers/auth.py:101-106` | ✅ 完成 |
| 5 | **P1** | HSTS + 安全標頭中介層 | `backend/app/main.py:161-213` | ✅ 完成 |
| 6 | **P1** | 密碼過期 (90天) + 歷史 (5筆) | `config.py:42-46`, `routers/auth.py:302-355` | ✅ 完成 |
| 7 | **P1** | Compact Table 病人列表壓縮行高 | `index.css:4729-4734`, `patients.tsx:359` | ✅ 完成 |
| 8 | **P1** | MED_CATEGORY_LABELS 藥物分類標籤 | `patient-detail.tsx:158-175` | ✅ 完成 |
| 9 | **P1** | ChatMessage timestamp 映射鏈 | `ai.ts:11`, `patient-detail.tsx:1142-1151`, `:1304`, `:1433-1437` | ✅ 完成 |
| 10 | **P1** | AI 串流聊天 (SSE + 降級回退) | `ai.ts:226-333`, `patient-detail.tsx:886-909` | ✅ 完成 |
| 11 | **P1** | AI Markdown 渲染元件 | `ai-markdown.tsx:28-63` | ✅ 完成 |
| 12 | **P1** | Session Idle Timeout (30分鐘) | `middleware/auth.py:174-194` | ✅ 完成 |
| 13 | **P2** | 對話輪次徽章 (#1, #2, ...) | `patient-detail.tsx:1311-1313` | ✅ 完成 |
| 14 | **P2** | 跳到最新訊息按鈕 | `patient-detail.tsx:1462-1469` | ✅ 完成 |
| 15 | **P2** | 資料品質指示器 (degraded/freshness) | `patient-detail.tsx:1391-1399` | ✅ 完成 |
| 16 | **P2** | 可展開參考文獻/說明面板 | `patient-detail.tsx:1331-1388` | ✅ 完成 |
| 17 | **P2** | Skeleton 載入狀態元件 | `skeletons.tsx` (全檔) | ✅ 完成 |
| 18 | **補充** | Figma 匯入清理 + 文件整併至 docs/ | 11 Figma 檔刪除、8 MD 檔從 src/ 移除 | ✅ 完成 |

---

## 二、11 個修改檔案精確行號與內容描述

### 2.1 `src/lib/api/ai.ts` (651 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 6-25 | `ChatMessage` interface | 定義 `timestamp: string`、`citations`、`safetyWarnings`、`degraded`、`dataFreshness` 等完整欄位 |
| 51-61 | `EvidenceGate` interface | 證據閘門結構：`passed`、`reason_code`、`citation_count`、`confidence` |
| 63-85 | `DataFreshness` interface | 資料新鮮度：4 section (lab/vital/ventilator/medications) + `missing_fields` + `hints` |
| 87-105 | `ChatSessionsResponse` | 會話列表含分頁：`page`、`limit`、`total`、`totalPages` |
| 168-171 | `getAIReadiness()` | AI 就緒度檢查 API（12 個 feature gates） |
| 226-333 | `streamChatMessage()` | SSE 串流實作：`delta` 事件 → chunk 累積；`done` 事件 → 完成回呼；失敗自動降級至 `sendChatMessage()` |

### 2.2 `src/pages/patient-detail.tsx` (2157 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 110-128 | `ChatSession` interface | 前端會話結構含 `labDataSnapshot`（K/Na/Scr/eGFR/CRP/WBC） |
| 130-142 | `ChatMessage` interface (前端) | 映射後的訊息結構：`references`（從 API `citations` 轉換）、`warnings`（從 `safetyWarnings`） |
| 158-175 | `MED_CATEGORY_LABELS` | 16 種藥物分類中文標籤 + Tailwind 顏色對照 |
| 177-188 | `formatAiDegradedReason()` | 將 degraded reason code 轉為中文提示 |
| 190-239 | `getDisplayFreshnessHints()` | 解析 DataFreshness → 中文提示陣列（過濾 JSON 離線模式提示） |
| 241-256 | `formatCitationPageText()` | 引用頁碼格式化：多頁 → `第 1、3、5 頁`、單頁 → `第 2 頁` |
| 312-317 | `formatDisplayTimestamp()` | ISO 8601 → `zh-TW` 本地化顯示 |
| 747-760 | `formatTimestamp()` | 留言板時間戳格式化（`year/month/day hour:minute`） |
| 817-834 | `refreshChatSessions()` | 從 API 取得會話列表，映射 `createdAt` → `sessionDate`/`sessionTime` |
| 853-949 | `handleSendMessage()` | 發送 AI 訊息：產生本地 user msg → 串流回應 → 組裝 assistant msg（含 timestamp） |
| 1141-1160 | 歷史訊息映射 | API `ChatMessage` → 前端 `ChatMessage`：`m.timestamp` → `toLocaleTimeString('zh-TW')`、`m.citations` → `references`、`m.safetyWarnings` → `warnings` |
| 1288-1459 | 聊天訊息渲染 | User bubble (右對齊, `#7f265b`)、Assistant card (左對齊, 白底+accent bar)、round badge、inline toolbar |
| 1300-1306 | User timestamp 渲染 | `msg.timestamp` → `<p className="text-[10px] text-white/50">` |
| 1433-1437 | Assistant timestamp 渲染 | `<Clock>` icon + `msg.timestamp` in inline toolbar |
| 1462-1469 | 跳到最新按鈕 | sticky bottom FAB：`<ArrowDown>` + 「跳到最新」 |
| 2096-2126 | 其他藥物區段 | Grid 佈局 + `MED_CATEGORY_LABELS` Badge 渲染 |

### 2.3 `src/index.css` (4734+ 行，Tailwind v4.1.3 pre-compiled)

| 行號 | 內容 | 說明 |
|------|------|------|
| 1 | `/*! tailwindcss v4.1.3 */` | Tailwind v4 pre-compiled CSS（非 JIT，不可使用任意 className） |
| 60-165 | `:root` 變數 | 間距 `--spacing: 0.25rem`、字體大小 `--text-xs` 至 `--text-3xl` |
| 4729-4734 | `.compact-table` | **自定義 CSS**：`td/th { padding-top: 0.375rem; padding-bottom: 0.375rem; }` 覆蓋 table.tsx 的 `p-2` 預設 |

### 2.4 `src/pages/patients.tsx` (500+ 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 1-24 | Imports | Shadcn Table 元件、state-display、skeletons、toast |
| 27 | `ICU_DEPARTMENTS` | UI 靜態設定，非 mock data |
| 30-35 | `PatientWithFrontendFields` | 擴展 Patient 型別含 `sedation/analgesia/nmb/hasUnreadMessages` |
| 76-88 | `fetchPatients()` | API 呼叫 `patientsApi.getPatients({ limit: 100 })` |
| 94-97 | `getSedation/getAnalgesia/getNmb` | 支援兩種格式：`patient.sedation` 或 `patient.sanSummary.sedation` |
| 359 | `<Table className="compact-table">` | 套用 compact-table CSS 壓縮行高 |

### 2.5 `src/components/ui/table.tsx` (117 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 86 | `"p-2 align-middle whitespace-nowrap ..."` | TableCell 預設 padding: `p-2`（= `0.5rem = 8px`），被 `.compact-table` 覆蓋為 `0.375rem = 6px` |

### 2.6 `src/components/ui/ai-markdown.tsx` (64 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 7-22 | `SafetyWarnings` | 渲染 AI 安全警告列表（amber 配色） |
| 28-63 | `AiMarkdown` | ReactMarkdown 元件：h1→h2 降級、blockquote amber 樣式、code block 區分行內/區塊 |

### 2.7 `src/components/ui/skeletons.tsx` (182 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 7-35 | `PatientCardSkeleton` / `PatientListSkeleton` | 病人卡片 + 列表骨架屏 |
| 39-65 | `LabDataSkeleton` | 檢驗數據 3-column grid 骨架屏 |
| 69-108 | `MedicationsSkeleton` | 用藥區段骨架屏（3 卡片 + grid） |
| 112-143 | `MessageListSkeleton` | 留言板骨架屏（avatar + 文字） |
| 147-180 | `TableSkeleton` | 通用表格骨架屏（thead + tbody rows） |

### 2.8 `backend/app/middleware/auth.py` (249 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 26-78 | `_InMemoryRedis` | 開發用記憶體 Redis 替代（含 TTL 支援） |
| 81-110 | Redis 連線 | 支援 `rediss://` TLS 連線，生產環境 fail-closed |
| 137-143 | Token 黑名單 | 每次請求檢查 `blacklist:{token}` 是否存在 |
| 174-194 | Idle Timeout | `last_activity:{user_id}` 追蹤，超過 30 分鐘自動黑名單 |
| 210-248 | Cookie 管理 | `COOKIE_ACCESS_KEY`、`COOKIE_REFRESH_KEY`（httpOnly）、`COOKIE_LOGGED_IN_KEY`（非 httpOnly 供前端偵測） |

### 2.9 `backend/app/main.py` — SecurityHeadersMiddleware (213+ 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 161-172 | Request/Trace ID | 注入 `X-Request-ID`、`X-Trace-ID` 分散式追蹤標頭 |
| 173-195 | HSTS + Security Headers | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`X-XSS-Protection`、`Referrer-Policy` |
| 196-209 | CSP 政策 | DEBUG: 寬鬆（允許 inline）、Production: 嚴格（`'none'` for all） |
| 208-213 | Cache Control | `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0` |

### 2.10 `backend/app/config.py` (132+ 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 26-29 | Redis TLS | `REDIS_SSL_CERT_REQS` 設定（required/optional/none） |
| 31-33 | Cookie 安全 | `COOKIE_SECURE`、`COOKIE_SAMESITE` 設定 |
| 42-46 | 密碼政策 | 90天過期、5筆歷史、12字元最低 |
| 66-68 | 帳號鎖定 | 5次失敗 / 900秒鎖定 |
| 70-72 | 速率限制 | 登入 5/min、預設 60/min |
| 113-132 | JWT Secret 驗證 | 啟動時 fail-closed 檢查（最低 32 字元、黑名單不安全預設值） |

### 2.11 `backend/app/routers/auth.py` (467+ 行)

| 行號 | 內容 | 說明 |
|------|------|------|
| 61-156 | `POST /auth/login` | 登入端點：帳號鎖定計數 + `passwordExpired` 欄位 |
| 159-199 | `POST /auth/logout` | 登出端點：雙 token 黑名單 + 稽核日誌 |
| 202-264 | `POST /auth/refresh` | Token 輪替：舊 refresh token 黑名單化 |
| 302-355 | `POST /auth/change-password` | **新端點**：密碼變更 + 歷史檢查 |
| 363-397 | `POST /auth/reset-password-request` | **新端點**：密碼重設請求（防列舉） |
| 400-467 | `POST /auth/reset-password` | **新端點**：一次性 token 消費 + 密碼強度驗證 |

---

## 三、檔案間關聯圖

```
┌─────────────────────────────────────────────────────────────────┐
│                    API 型別定義層                                │
│  ai.ts:6-25  ChatMessage { timestamp, citations, safetyWarnings }│
│  ai.ts:87-95 ChatSession { createdAt, updatedAt, messageCount }  │
└────────────┬───────────────────────────────────┬────────────────┘
             │                                   │
             ▼                                   ▼
┌────────────────────────────┐   ┌──────────────────────────────┐
│      映射層 (Mapping)       │   │      會話列表映射              │
│  patient-detail.tsx:1141    │   │  patient-detail.tsx:821-830   │
│  ─────────────────────────  │   │  ─────────────────────────    │
│  m.timestamp → toLocaleTime │   │  s.createdAt → sessionDate   │
│  m.citations → references   │   │  s.createdAt → sessionTime   │
│  m.safetyWarnings → warnings│   │  s.messageCount → Badge      │
└────────────┬───────────────┘   └──────────────┬───────────────┘
             │                                   │
             ▼                                   ▼
┌────────────────────────────────────────────────────────────────┐
│                       渲染層 (Render)                           │
│  patient-detail.tsx:1304 — User timestamp (white/50, 10px)     │
│  patient-detail.tsx:1433 — Assistant timestamp (Clock icon)    │
│  patient-detail.tsx:1311 — Round badge (#1, #2, ...)           │
│  patient-detail.tsx:1188 — Session message count Badge         │
└────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  Compact Table CSS 鏈路                          │
│                                                                 │
│  index.css:4729-4734                                            │
│  .compact-table td/th { padding: 0.375rem }                     │
│           │                                                     │
│           ▼                                                     │
│  patients.tsx:359                                               │
│  <Table className="compact-table">                              │
│           │                                                     │
│           ▼ (覆蓋)                                               │
│  table.tsx:86                                                   │
│  TableCell 預設 className="p-2" (= 0.5rem = 8px)                │
│  → 被 .compact-table 覆蓋為 0.375rem = 6px                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  藥物分類標籤鏈路                                  │
│                                                                 │
│  API: GET /patients/{id}/medications                            │
│  Response: { category: "antibiotic" | "vasopressor" | ... }     │
│           │                                                     │
│           ▼                                                     │
│  patient-detail.tsx:158-175                                     │
│  MED_CATEGORY_LABELS[med.category]                              │
│  → { label: "抗生素", color: "bg-amber-100 text-amber-800" }    │
│           │                                                     │
│           ▼                                                     │
│  patient-detail.tsx:2108-2116                                   │
│  <Badge className={catInfo.color}>{catInfo.label}</Badge>       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、後續任務規劃

### 4.1 跳到最新按鈕 — 已完成
- **位置:** `patient-detail.tsx:1462-1469`
- **實作:** sticky bottom FAB + `scrollIntoView({ behavior: 'smooth' })`
- **觸發:** `showScrollToBottom` state（基於 `handleMessagesScroll` 偵測滾動位置）

### 4.2 元件拆分建議（未執行，非必要）
- `patient-detail.tsx` 已達 **2157 行**，可考慮拆分：
  - `ChatPanel` 元件（~500 行：會話列表 + 訊息區 + 輸入框）
  - `MedicationsPanel` 元件（~200 行：S/A/N 三卡片 + 其他藥物 grid）
  - `VitalSignsPanel` 元件（~150 行：生命徵象卡片 + 趨勢圖觸發）
- **優先級:** Low — 目前功能正確，效能無問題

### 4.3 Unused Imports 檢查
- 已移除的 Figma 匯入：11 檔案（`src/imports/`）
- 已移除的 Mock 資料：`src/lib/mock-data.ts`
- **驗證:** `grep -r "mock-data" src/` → 0 結果 ✓
- **驗證:** `grep -r "from.*imports/" src/` → 0 結果 ✓

---

## 五、Playwright MCP 驗證結果（2026-02-19 完成）

> **驗證環境:** 前端 Vite dev server (port 3000) + 後端 FastAPI DEBUG mode (port 8000, SQLite + in-memory Redis)
> **工具:** Playwright MCP (`browser_navigate` / `browser_snapshot` / `browser_take_screenshot` / `browser_run_code`)
> **截圖:** 14 張 `pw-verify-*.png` 已存檔於專案根目錄

### 5.1 頁面渲染驗證（14/14 通過）

| # | 頁面 | 截圖 | 關鍵驗證項 | 結果 |
|---|------|------|------------|------|
| 1 | Login `/login` | `pw-verify-01-login.png` | 登入表單、Logo、帳號/密碼欄位 | ✅ 通過 |
| 2 | Dashboard `/dashboard` | `pw-verify-02-dashboard.png` | 5 統計卡片、4 病患卡片、側邊欄 | ✅ 通過 |
| 3 | Patients `/patients` | `pw-verify-03-patients.png` | Compact table、14 欄、4 病患列 | ✅ 通過 |
| 4 | Detail — AI Chat | `pw-verify-04-chat-tab.png` | 對話記錄、新對話按鈕、AI 就緒狀態 | ✅ 通過 |
| 5 | Detail — Messages | `pw-verify-05-messages.png` | 4 則留言、Badge、時間戳 | ✅ 通過 |
| 6 | Detail — Lab Data | `pw-verify-06-labs.png` | 生命徵象 + 6 檢驗分類區塊 | ✅ 通過 |
| 7 | Detail — Medications | `pw-verify-07-meds-tab.png` | S/A/N 卡片 + 其他藥物 + category badge | ✅ 通過 |
| 8 | Detail — Summary | `pw-verify-08-summary.png` | 4 AI 工具按鈕 (summary/education/guideline/decision) | ✅ 通過 |
| 9 | Team Chat `/chat` | `pw-verify-09-team-chat.png` | 訊息列表、2 則釘選、輸入框 | ✅ 通過 |
| 10 | Pharmacy Workstation | `pw-verify-10-workstation.png` | 病患選擇器、藥品輸入框、空狀態 | ✅ 通過 |
| 11 | Pharmacy Interactions | `pw-verify-11-interactions.png` | 藥物 A/B 輸入欄、查詢按鈕 | ✅ 通過 |
| 12 | Pharmacy Advice Stats | `pw-verify-12-advice-stats.png` | 4 類別卡片、空資料狀態正確 | ✅ 通過 |
| 13 | Admin Users | `pw-verify-13-admin-users.png` | 4 帳號、角色 Badge、統計卡片 | ✅ 通過 |
| 14 | Admin Vectors | `pw-verify-14-admin-vectors.png` | RAG 資料庫 (44 docs, 2150 chunks)、上傳表單 | ✅ 通過 |

### 5.2 Computed Style 斷言（4/4 通過）

| # | 斷言項目 | 方法 | 預期值 | 實際值 | 結果 |
|---|----------|------|--------|--------|------|
| 1 | Compact table `td` padding | `browser_run_code` | ≤ 8px (覆蓋 p-2) | `6.75px` | ✅ |
| 2 | Table row height | `browser_run_code` | ≤ 60px | `~59.5px` | ✅ |
| 3 | Table header `white-space` | `browser_run_code` | `nowrap` | `nowrap` | ✅ |
| 4 | Security headers (8 項) | `browser_run_code` fetch `/api/v1/health` | 全部存在 | X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection, CSP, Cache-Control, X-Request-ID, X-Trace-ID 全部存在（HSTS 在 DEBUG 模式正確跳過） | ✅ |

### 5.3 MED_CATEGORY_LABELS Badge 驗證

| Badge | 顏色 | 字體大小 | 結果 |
|-------|------|----------|------|
| 抗凝血 | `bg-rose-100 text-rose-800` | 10px | ✅ |
| 電解質 | `bg-cyan-100 text-cyan-800` | 10px | ✅ |
| 抗生素 | `bg-amber-100 text-amber-800` | 10px | ✅ |
| PPI | `bg-indigo-100 text-indigo-800` | 10px | ✅ |

### 5.4 Console Errors

| 頁面 | Error 數 | 說明 |
|------|----------|------|
| 全 14 頁 | 0 critical | 無 runtime crash |
| Team Chat | 1 warning | React ref warning ("Function components cannot be given refs") — 非功能性問題 |

### 5.5 驗證期間發現並修正的 P0 問題（2 項）

| # | 問題 | 根因 | 修正檔案 | 修正內容 |
|---|------|------|----------|----------|
| 1 | Auth refresh 無限重導迴圈 | Response interceptor 對 `/auth/` 端點也嘗試 refresh | `src/lib/api-client.ts` | 跳過 auth 端點的自動 refresh；不重導已在 `/login` 的頁面；`clearAll()` 清除 indicator cookie |
| 2 | SPA 路由顯示 raw JSON | Vite proxy 將 `/patients`、`/dashboard`、`/admin`、`/pharmacy` 瀏覽器請求轉發至後端 | `vite.config.ts` | 為共用路徑添加 `bypass(req)` 函數，檢查 `Accept: text/html` header 時返回 SPA |

### 5.6 最終 Build/Test 驗證

| 項目 | 指令 | 結果 |
|------|------|------|
| Frontend build | `npm run build` | ✅ built in 1.58s |
| Backend tests | `python3 -m pytest tests/ -v --tb=short` | ✅ 170 passed, 13 skipped, 0 failed |

---

## 六、Mock 資料移除驗證

```bash
# 驗證指令與結果
$ grep -r "mock-data" src/
# (zero results)

$ grep -r "from.*mock-data" src/
# (zero results)

$ ls src/lib/mock-data.ts
# No such file or directory

$ grep -r "from.*imports/" src/
# (zero results — all Figma imports removed)
```

**結論:** Mock 資料與 Figma 匯入已 100% 清除。所有頁面現在透過 API Client 從後端取得資料。
