# 多語介面（i18n）導入進度

> **配對計畫文件**：[`docs/i18n-rollout-plan-2026-05-04.md`](i18n-rollout-plan-2026-05-04.md)
> **配對術語表**：[`docs/i18n-medical-glossary.md`](i18n-medical-glossary.md)
> **負責人**：Chun + Claude
> **啟動日**：2026-05-04
> **總進度**：🟢 3.6 / 8 Waves（W0+W1+W2+W3a+W3b+W3c 完成、W3d 完成 2026-05-04；W3e+ 待開工）

---

## 進度總覽

| Wave | 主題 | 狀態 | PR / Branch | 完成日 | 部署 |
|------|------|------|-------------|--------|------|
| 0 | 基建 + 切換按鈕 | 🟢 完成 | `feat/i18n-w0-w1` | 2026-05-04 | 🚀 personal+railway 已推 |
| 1 | sidebar + common + errors + roles + notifications | 🟢 完成 | `feat/i18n-w0-w1` | 2026-05-04 | 🚀 personal+railway 已推 |
| 2 | login + change-password + dashboard | 🟢 完成 | `feat/i18n-w2` | 2026-05-04 | 🚀 personal+railway 已推 |
| 3a | 病人列表 + 出院列表 + 編輯/封存對話框 | 🟢 完成 | `feat/i18n-w3a` | 2026-05-04 | 🚀 personal+railway 已推 |
| 3b | patient-detail.tsx 主頁 + 5 共用元件 | 🟢 完成 | `feat/i18n-w3b` | 2026-05-04 | 🚀 personal+railway 已推 |
| 3c | medical-records + lab-data + lab-trend + score-trend | 🟢 完成 | `feat/i18n-w3c` | 2026-05-04 | 🚀 personal+railway 已推 |
| 3d | patient-summary-tab + patient-labs-tab | 🟢 完成 | `feat/i18n-w3d` | 2026-05-04 | 🚀 personal+railway 已推 |
| 3e | patient-medications-tab + 4 medication 子元件 | ⬜ 待開工 | — | — | — |
| 3f | patient-microbiology-card + patient-diagnostic-reports | ⬜ 待開工 | — | — | — |
| 3g | patient-messages-tab + patient-chat-tab + chat-message-thread + discharge-check-panel | ⬜ 待開工 | — | — | — |
| 4 | team chat + ai chat | ⬜ 待開工 | — | — |
| 5 | 藥事 7 頁（workstation + 6 工具） | ⬜ 待開工 | — | — |
| 6 | admin 4 頁 | ⬜ 待開工 | — | — |
| 7 | lint 規則 + i18n-guide 文件 + 走查 | ⬜ 待開工 | — | — |

> 狀態圖示：⬜ 待開工　🟡 進行中　🟢 完成　🔴 阻塞

---

## Wave 0 + Wave 1（合併 PR）

**目標**：基建落地 + 側邊欄完全切英文。

### Wave 0｜基建 + 切換按鈕（🟢 完成 2026-05-04）

#### 任務清單
- [x] `npm install i18next react-i18next i18next-browser-languagedetector`
- [x] 建立 `src/i18n/config.ts`（i18next init、resources 註冊、fallbackLng）
- [x] 建立 `src/i18n/index.ts`（re-export `useTranslation`、`i18n` instance）
- [x] 建立 `src/i18n/use-language.ts`（`useLanguage()` 封裝 setter / toggle）
- [x] 建立 `src/i18n/locales/zh-TW/` 與 `src/i18n/locales/en-US/` 資料夾
- [x] `src/main.tsx` import `./i18n/config`（觸發初始化）
- [x] `src/components/app-sidebar.tsx` footer 加入 `中 / EN` 切換按鈕
- [x] localStorage key 使用 `chaticu.lang`
- [x] 預設語言 `zh-TW`、fallback `zh-TW`、不依賴 `navigator.language`

#### 驗收（Wave 0）
- [x] 切換按鈕在 sidebar 展開、收合、短視窗（橫置手機）三種狀態下都正確顯示
- [x] TypeScript build 過 (`npm run typecheck` 通過)
- [ ] 手動瀏覽器驗證（待使用者跑 `npm run dev` 確認）

### Wave 1｜sidebar + common + errors + roles + notifications 字典化（🟢 完成 2026-05-04）

#### 已完成檔案
- 字典：
  - `src/i18n/locales/{zh-TW,en-US}/common.json`（actions / status / time × 兩語）
  - `src/i18n/locales/{zh-TW,en-US}/sidebar.json`（5 groups + 14 items + header + footer + badge）
  - `src/i18n/locales/{zh-TW,en-US}/errors.json`（boundary 6 keys）
  - `src/i18n/locales/{zh-TW,en-US}/roles.json`（5 roles）
  - `src/i18n/locales/{zh-TW,en-US}/notifications.json`（title / summary / labels / empty）
- 元件改寫：
  - `src/components/app-sidebar.tsx`（所有字串走 `t()`、加入語言切換按鈕）
  - `src/components/notification-bell.tsx`（含 `useRelativeFormatter` hook 用 t() 處理時間）
  - `src/components/error-boundary.tsx`（class component 用 `i18n.t()`、`SectionErrorBoundary` 用 hook）
  - `src/lib/utils/user-role.ts`（新增 `useRoleLabel()` hook、`roleLabel()` 改用 i18n.t）
- e2e 同步：
  - `e2e/t27-extended-journeys.spec.js`（selector 改 regex 相容雙語）
- 文件：
  - `docs/i18n-medical-glossary.md`（術語對照表骨架，Wave 1 角色與側邊欄已列入校稿）

#### 驗收（Wave 1）
- [x] TypeScript build 過 (`npm run typecheck` 通過)
- [ ] 手動瀏覽器驗證：切到 EN 後 sidebar / 鈴鐺 / error boundary 全英文
- [ ] 切回中文，文字一致無漏字
- [ ] EN 模式下無顯示原始 key（待瀏覽器確認 console 無 missingKey 警告）
- [x] e2e selector 已改 regex
- [ ] e2e 跑過（選擇性，可待 W2 一起）

#### 已知限制（Wave 1 範圍外，預期）
- `mention-textarea.tsx` / `patient-activity-panel.tsx` / `chat.tsx` / `admin/placeholder.tsx`
  使用 `ROLE_LABEL` const，仍顯示中文。將於 Wave 3/4/6 改為 `useRoleLabel()` 後支援切換。

---

## Wave 2-7（待 W0+W1 合併後展開）

各 Wave 任務細節待 W0+W1 落地、踩過第一輪坑後再展開到此文件。先列範圍即可：

### Wave 2｜入口頁（🟢 完成 2026-05-04）

#### 已完成檔案
- 字典（兩語各 1 檔）：
  - `src/i18n/locales/{zh-TW,en-US}/auth.json`（login + changePassword）
  - `src/i18n/locales/{zh-TW,en-US}/dashboard.json`（header / hisSync / metrics / list / card / edit / duplicateBadge）
- 元件改寫：
  - `src/pages/login.tsx`（標題、tagline、表單欄位、show/hide password aria、登入按鈕）
  - `src/pages/change-password.tsx`（卡片標題、4 種驗證錯誤訊息、欄位 label、提示文字、按鈕、成功 toast）
  - `src/pages/dashboard.tsx`（標題列、HIS sync 三狀態 toast + 上次紀錄組合句、5 個 metrics、搜尋/篩選/排序、放大縮小、病患卡片內全部資料行、編輯對話框 6 個 label + 2 個 switch + footer）
  - `src/components/dashboard/patient-duplicate-badge.tsx`（aria-label + tooltip）
  - `src/i18n/config.ts`（註冊 auth + dashboard namespace）
- 文件：
  - `docs/i18n-medical-glossary.md`（補入 Wave 2 校稿表）

#### 驗收（Wave 2）
- [x] TypeScript build 過 (`npm run typecheck` 通過)
- [ ] 手動瀏覽器驗證：登入頁、改密頁、總覽頁切換 EN/中
- [ ] 手動驗證 HIS sync toast 在英文模式下文字正確
- [ ] 手動驗證 dashboard 卡片 + 編輯對話框

#### 設計決策
- `lastUpdate` 用 `i18n.language` 替換寫死的 `'zh-TW'`，讓日期格式跟隨語言切換
- HIS sync 「上次{mode}」拆成 `lastSync` / `lastSyncWithErrors` 兩 key，避免條件拼接
- 病患卡片 `{age} 歲` 用 `t('card.ageYears', {age})` 帶插值，英文版直接 `{{age}} y/o`
- 編輯對話框的「儲存/取消」走 `common:` namespace 而非 `dashboard:`，重複利用

### Wave 3｜病人模組（拆 W3a + W3b + W3c + W3d-g 共 7 個 sub-PR）

**為何拆**：原計畫 1.5 天估算嚴重低估。實際範圍 ~5,400 行 source（patient-detail.tsx 1802 行、medical-records.tsx 1320 行、patient-medications-tab.tsx 61KB 等），分多個 PR 較好 review。

#### Wave 3a｜病人列表 + 出院列表 + 編輯/封存對話框（🟢 完成 2026-05-04）

**已完成檔案**：
- 字典：`src/i18n/locales/{zh-TW,en-US}/patients.json`（list / create / edit / archive / dischargeType / discharged 6 個 sub-section、~120 keys）
- 元件改寫：
  - `src/pages/patients.tsx`（住院病人列表 + 內嵌新增/封存對話框，895 行）
  - `src/pages/discharged-patients.tsx`（出院病人列表 + 多選 + AI 問答，485 行）
  - `src/components/patient/dialogs/patient-edit-dialog.tsx`（共用編輯對話框，354 行）
  - `src/components/patient/dialogs/patient-archive-dialog.tsx`（共用辦理出院對話框，174 行）
- `src/i18n/config.ts`：註冊 `patients` namespace
- 文件：`docs/i18n-medical-glossary.md` 補入 Wave 3a 校稿表

**已知範圍外（dead code，跳過）**：
- `src/components/patient/patients-list-card.tsx`（沒有 import 它）
- `src/components/patient/dialogs/patient-create-dialog.tsx`（沒有 import 它，創建邏輯已內嵌在 patients.tsx）

**驗收**：
- [x] TypeScript build 過 (`npm run typecheck`)
- [ ] 手動瀏覽器驗證

#### Wave 3b｜patient-detail.tsx 主頁 + 5 共用元件（🟢 完成 2026-05-04）

**已完成檔案**：
- 字典：`src/i18n/locales/{zh-TW,en-US}/patient-detail.json`（header / state / bundle / tabs / messages / session / snapshot / chat / degradedReason / freshnessHints / citation / labFields(30) / medCategories(16) / expertReview / confidence / activityPanel 共 16 個 sub-section、~150 keys）
- 元件改寫：
  - `src/pages/patient-detail.tsx`（**1802 行**，主頁面 + AI 對話 + 留言板協調 + 病人 header + 6 個 tab 觸發器）
  - `src/components/patient/patient-detail-header.tsx`
  - `src/components/patient/patient-detail-state-guard.tsx`
  - `src/components/patient/expert-review-warning.tsx`
  - `src/components/patient/confidence-badge.tsx`
  - `src/components/patient/patient-activity-panel.tsx`
- `src/i18n/config.ts`：註冊 `patient-detail` namespace

**設計決策**：
- module-scope helper 函式（`formatAiDegradedReason`、`getDisplayFreshnessHints`、`formatCitationPageText`、`formatDisplayTimestamp`）改用 `i18n.t()` 直接呼叫（非 hook 形式），透過閉包讀當前語言
- `LAB_CHINESE_NAMES_MAP` 大字典移除，改成 `i18n.t('labFields.<key>')` 動態查詢
- `MED_CATEGORY_LABELS` 在 patient-detail.tsx 是 dead code（patient-medications-tab.tsx 有自己的 copy），直接刪除
- `formatTimestamp` 內 hardcoded `'zh-TW'` locale 改為 `i18n.language`
- `useRoleLabel()` hook 在 patient-activity-panel.tsx 取代本地 ROLE_LABEL
- gender 顯示用三元運算 + 跨 namespace `t('patients:create.gender.male', ...)`，避免重複定義

**踩到的坑**：
- patient-detail.tsx 1802 行，無法 Edit 全文重寫；改用 Python 批次 replace（47 個 toast/console + 26 個 JSX = 共 73 個 in-component 替換 + 8 個 module-scope）
- `'JSON 離線模式'` / `'資料快照時間'` 是後端送來的 zh marker，故意保留不翻譯

**驗收**：
- [x] TypeScript build 過 (`npm run typecheck`)
- [ ] 手動瀏覽器驗證

#### Wave 3c｜病歷 + 檢驗 + 趨勢圖（🟢 完成 2026-05-04）

**已完成檔案**：
- 字典（3 套兩語）：
  - `medical-records.json`（recordTypes / draftSection / templateApply / polishedSection / refine / templates / draftStorage / polish / lastCopied，~75 keys）
  - `labs.json`（fields 60+ 檢驗欄位 + display + trendChart，~80 keys）
  - `score-trend.json`（labels / subtitle / history headers，~10 keys）
- 元件改寫：
  - `src/components/medical-records.tsx`（**1320 行**，60 個替換 = 19 handler + 41 JSX；`RECORD_TYPE_CONFIG` 從靜態 const 改成 `useRecordTypeConfig()` hook）
  - `src/components/lab-data-display.tsx`（filter buttons / legend / 60+ lab name lookup 改用 `t('fields.<key>')`）
  - `src/components/lab-trend-chart.tsx`（時窗選項 / 參考範圍 / tooltip 狀態 / Clcr 體重來源 6 個 case）
  - `src/components/score-trend-chart.tsx`（pain/RASS labels + 歷史紀錄表頭）
  - `src/components/vital-signs-card.tsx`（**未動，無 UI 字串**，所有 label 透過 prop 傳入）
- `src/i18n/config.ts`：註冊 `medical-records` / `labs` / `score-trend` 三個 namespace

**設計決策**：
- `BUILTIN_TEMPLATES` 字典名（'SOAP 格式' / '藥師 SOAP' / '一般交班' 等 11 個）與內容（主訴/處置計畫等臨床 fill-in 區段）**不翻譯**：模板名是 lookup key（含使用者自訂模板），內容是讓使用者填寫的占位結構，與 UI chrome 不同
- `RECORD_TYPE_CONFIG` 從 module-level const 重構為 `useRecordTypeConfig()` hook，這樣 label/description/placeholder/polishLabel 跟隨語言切換 re-render
- `RECORD_TYPE_ICONS` 拆出來保留 module-level（icons 不需要 reactive）
- `formatTimestamp` zh-TW 寫死 → `i18n.language`（保持 `Asia/Taipei` 時區）
- `lastCopiedHint` 用 `useMemo` + i18n hook
- `score-trend-chart` 的 `Pain Score` / `RASS Score` 在英文模式下兩個都顯示英文，中文模式 Chinese label 為「疼痛分數」/「鎮靜分數」
- `lab-data-display` 的 60+ 檢驗縮寫 `Na/K/BUN/...` 在英文版用全名 `Sodium/Potassium/BUN/...`
- 命名衝突：`useTranslation` 的 `t` 與 `serverTemplates.map((t) => ...)` 衝突 → 重命名為 `tpl`

**範圍外**：
- `vital-signs-card.tsx` 純展示元件，所有顯示文字（label/value/unit）由父元件以 prop 傳入

**驗收**：
- [x] TypeScript build 過 (`npm run typecheck`)
- [ ] 手動瀏覽器驗證

#### Wave 3d-g｜patient-detail 各 tab
- 一個 tab 一個 sub-PR：`patient-summary-tab` / `patient-medications-tab` / `patient-labs-tab` / `patient-messages-tab` / `patient-chat-tab`
- 加上 `medication-risk-card`、`drug-interaction-badges`、`medication-duplicate-badges`、`iv-compatibility-checker`、`patient-microbiology-card`、`patient-diagnostic-reports`、`discharge-check-panel`、`chat-message-thread`

### Wave 4｜溝通
- 範圍：`chat.tsx` / `ai-chat.tsx` / `src/components/ai-chat/*`
- namespace：`chat.json` / `ai-chat.json`

### Wave 5｜藥事 7 頁
- 範圍：`src/pages/pharmacy/*` 9 檔 + `src/components/pharmacy/*`
- namespace：`pharmacy.json`

### Wave 6｜系統管理
- 範圍：`src/pages/admin/*` 4 檔
- namespace：`admin.json`

### Wave 7｜收尾
- 安裝 `eslint-plugin-i18next`，設 `no-literal-string` rule
- 寫 `docs/frontend/i18n-guide.md`（新增字串該放哪、複數寫法、插值範例）
- 全站 EN 走查補漏字
- 校稿後的醫療術語回填字典

---

## 阻塞與決策紀錄

| 日期 | 項目 | 內容 |
|------|------|------|
| 2026-05-04 | 計畫拍板 | §10 五題全選 A：純文字 toggle / Claude 初譯 / 只做中英 / W0+W1 合 PR / W7 加 lint |
| 2026-05-04 | W0+W1 落地 | 基建 + 5 個 namespace + sidebar/notification/error/role 元件遷移完成；typecheck 通過 |
| 2026-05-04 | namespace 擴充 | 原計畫 4 個 namespace（common/sidebar/errors/roles），W1 額外加 `notifications`（隔離 bell 字串） |
| 2026-05-04 | W2 落地 | auth + dashboard 兩 namespace 上線；patient-duplicate-badge 共用元件納入 dashboard namespace（Wave 5 pharmacy 沿用同 key） |
| 2026-05-04 | pre-commit hook 修補 | detect-secrets 把 `passwordLabel` 等 i18n 字串誤判為 secret；加入 `src/i18n/locales/.*` 到 exclude pattern 解決 |
| 2026-05-04 | W0+W1+W2 部署 | `git push personal main` + `git push railway main` 兩邊都通（personal 推 1 commit、railway 推 6 commit）；待部署完成後驗證 health + bundle |
| 2026-05-04 | 部署驗證通過 | Railway `/health` → `{"status":"healthy","version":"1.4.5"}`；Vercel bundle `index-DWlI4vVx.js` 含 `i18next` + `chaticu.lang` localStorage key；VITE_API_URL 未洩漏（proxy 路徑正確） |
| 2026-05-04 | 切換按鈕版面調整 | Theme + Language 由「上下兩行 full-width」改為「50/50 並排」；語言按鈕補上 lucide `Globe` icon（方案 B）。覆寫 Q1-A 的「純文字」原始決定，原因：使用者在實機看到後覺得語言按鈕太突兀，icon 化反而更協調 |
| 2026-05-04 | 縮短按鈕文字 | 深色模式/淺色模式 → 深/淺；Dark Mode/Light Mode → Dark/Light；EN → 英（語言按鈕）。理由：50/50 layout 文字長度需收斂 |
| 2026-05-04 | Wave 3 拆分決策 | 原計畫 1.5 天估算嚴重低估（patient-detail 1802 行 + medical-records 1320 行 + 21 個子元件最大 61KB）。拆成 W3a-g 共 7 個 sub-PR，依檔案 size + 使用頻率分配。dead code（patients-list-card、patient-create-dialog）跳過 |
| 2026-05-04 | W3a 落地 | patients/discharged/edit-dialog/archive-dialog 全部 t() 化，~120 keys，typecheck 通過 |
| 2026-05-04 | W3a 部署 | commit `6889772c2`、`git push personal main` + `git push railway main` 兩邊都通 |

---

## 連結
- [Plan](i18n-rollout-plan-2026-05-04.md)
- [Medical Glossary](i18n-medical-glossary.md)（Wave 1 建立）
- [i18n Guide](frontend/i18n-guide.md)（Wave 7 建立）
