# 多語介面（i18n）導入進度

> **配對計畫文件**：[`docs/i18n-rollout-plan-2026-05-04.md`](i18n-rollout-plan-2026-05-04.md)
> **配對術語表**：[`docs/i18n-medical-glossary.md`](i18n-medical-glossary.md)
> **負責人**：Chun + Claude
> **啟動日**：2026-05-04
> **總進度**：🟢 3 / 8 Waves（W0+W1 合併完成、W2 完成 2026-05-04）

---

## 進度總覽

| Wave | 主題 | 狀態 | PR / Branch | 完成日 | 部署 |
|------|------|------|-------------|--------|------|
| 0 | 基建 + 切換按鈕 | 🟢 完成 | `feat/i18n-w0-w1` | 2026-05-04 | 🚀 personal+railway 已推 |
| 1 | sidebar + common + errors + roles + notifications | 🟢 完成 | `feat/i18n-w0-w1` | 2026-05-04 | 🚀 personal+railway 已推 |
| 2 | login + change-password + dashboard | 🟢 完成 | `feat/i18n-w2` | 2026-05-04 | 🚀 personal+railway 已推 |
| 3 | 病人模組（patients / discharged / detail / medical records） | ⬜ 待開工 | — | — |
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

### Wave 3｜病人模組（最大宗）
- 範圍：`patients.tsx` / `discharged-patients.tsx` / `patient-detail.tsx` + `src/components/medical-records.tsx` / `vital-signs-card.tsx` / `lab-data-display.tsx` / `lab-trend-chart.tsx` / `score-trend-chart.tsx` / `src/components/patient/*`
- namespace：`patients.json` / `patient-detail.json` / `medical-records.json`

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

---

## 連結
- [Plan](i18n-rollout-plan-2026-05-04.md)
- [Medical Glossary](i18n-medical-glossary.md)（Wave 1 建立）
- [i18n Guide](frontend/i18n-guide.md)（Wave 7 建立）
