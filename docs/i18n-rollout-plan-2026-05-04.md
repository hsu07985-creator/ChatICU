# 多語介面（i18n）導入計畫（2026-05-04）

> **狀態**：已拍板（§10 全數決議完成 2026-05-04），待開 Wave 0+1 PR
> **發起人**：Chun
> **配對進度文件**：[`docs/i18n-rollout-progress.md`](i18n-rollout-progress.md)
> **相關慣例**：CLAUDE.md「修復流程」「目錄慣例」「禁止事項」

## 1. 背景與目標

ChatICU 目前所有介面字串均寫死為繁體中文（zh-TW），無 i18n 基建。
本計畫將：

- 引入 `react-i18next` 作為翻譯框架
- 建立 `zh-TW`（預設）/ `en-US`（次要）兩套字典
- 在側邊欄 footer（深色模式按鈕旁）加入語言切換按鈕
- 分波段（Wave）將既有字串遷入字典，避免一次性 PR 過大

## 2. 範圍盤點（2026-05-04）

| 指標 | 數字 |
|------|------|
| 含中文字元的 `.ts` / `.tsx` 檔案 | ~177 |
| 含中文 JSX text 的檔案 | ~53 |
| 中文字串字面量（雙引號內，粗估） | ~1,042 |
| 主要頁面 | 14（dashboard / patients×3 / chat / ai-chat / login / change-password / admin×4 / pharmacy×9）|
| 主要 layout 元件 | sidebar / notification-bell / error-boundary / medical-records / pharmacist-soap-editor / vital-signs-card / lab-data-display 等 |

> 範圍不含：資料庫內容、AI 生成輸出、HIS 同步資料、醫師 SOAP 內文、藥品中文名（見 §8 不在範圍）。

## 3. 技術選型

### 套件
- **`i18next`** + **`react-i18next`** — 業界標準，社群大、TS 型別好
- **`i18next-browser-languagedetector`** — 偵測 localStorage / `navigator.language`
- 不導入 `i18next-http-backend`：字典直接打包進 bundle（檔案小、無額外請求）

### 為何不選其他
- `next-intl` / `next-i18next` — 需 Next.js，本專案是 Vite
- `react-intl` (FormatJS) — API 較重，pluralization 寫法繁瑣
- `lingui` — 需編譯步驟，與現有 Vite pipeline 整合成本高

### 安裝
```bash
npm install i18next react-i18next i18next-browser-languagedetector
```

## 4. 架構設計

### 目錄結構
```
src/i18n/
├── config.ts                   # i18next 初始化（resources, fallback, detector）
├── index.ts                    # re-export useTranslation 等常用 API
├── lang-context.tsx            # 提供 useLanguage()（含 setLanguage / current）
└── locales/
    ├── zh-TW/
    │   ├── common.json         # 通用按鈕、狀態、確認、登出、主題切換
    │   ├── sidebar.json        # 側邊欄選單
    │   ├── auth.json           # 登入、改密
    │   ├── dashboard.json
    │   ├── patients.json
    │   ├── patient-detail.json
    │   ├── chat.json
    │   ├── ai-chat.json
    │   ├── pharmacy.json       # workstation + 6 工具共用
    │   ├── admin.json
    │   ├── medical-records.json
    │   └── errors.json         # 錯誤訊息、toast 文字
    └── en-US/
        └── (同檔名)
```

### Key 命名慣例
- 點分層：`<namespace>:<page>.<section>.<key>`
- 範例：
  - `sidebar:groups.patientCare` → `"病人照護"` / `"Patient Care"`
  - `sidebar:items.workstation` → `"智藥輔助"` / `"Pharmacist Workstation"`
  - `common:actions.save` → `"儲存"` / `"Save"`
  - `chat:header.title` → `"團隊訊息"` / `"Team Messages"`
- 動態插值：`{{name}}` 語法
  - `chat:badge.unreadMessages` → `"{{count}} 則新訊息"` / `"{{count}} new message"` (with `_one` / `_other` 複數)

### 偵測與儲存
- localStorage key：`chaticu.lang`（不用 `i18nextLng` 預設值，加專案前綴避免共用瀏覽器其他專案衝突）
- 預設語言：`zh-TW`
- Fallback：`zh-TW`（en-US 缺 key 時不洩漏 raw key 給使用者）
- 不依賴 `navigator.language`：本系統使用者主要為台灣醫療人員，預設中文較合理；英文要主動切換

### 時間 / 數字格式
- 仍透過 `Date.toLocaleString` + `timeZone: 'Asia/Taipei'` 渲染（不論語言一律台北時區，符合既有 memory）
- locale 字串隨語言切換：`zh-TW` / `en-US`
- 例：`new Date().toLocaleString(i18n.language, { timeZone: 'Asia/Taipei', ... })`

### 角色名稱（roleLabel）
- `src/lib/utils/user-role.ts` 的 `roleLabel` 改成 i18n key map：
  - `pharmacist` → `roles:pharmacist` → `"藥師"` / `"Pharmacist"`
  - `physician` → `roles:physician` → `"醫師"` / `"Physician"`
  - 等等

## 5. 分波段 Rollout（依「使用者價值優先」排序）

> 排序原則：**高頻 + 全角色看得到的區域** > 低頻 / 單一角色區域 > 純後台 / 工具頁

### Wave 0｜基建 + 切換按鈕
- 安裝套件、建立 `src/i18n/` 骨架
- 寫 `config.ts`、`lang-context.tsx`
- `App.tsx` 包 `<I18nextProvider>`
- **在 `app-sidebar.tsx` footer 深色模式按鈕旁加「EN / 中」切換按鈕**
- 字典先放空殼（兩個檔案都只含 `{}`），按鈕點擊能切換 `i18n.language` 並寫入 localStorage
- 此 Wave 完成後**畫面尚不會變**，但有 toggle 行為可觀察

**驗收**：
- 切換按鈕可點擊、會 toggle、重整後保留
- TypeScript / build 過
- console 無 i18next 警告

### Wave 1｜全站共用：sidebar + footer + 通用按鈕
- `common.json`、`sidebar.json`、`errors.json`（toast 通用訊息）
- 觸碰檔案：
  - `src/components/app-sidebar.tsx`（5 個 group label + ~15 個 menu items + footer 兩顆按鈕）
  - `src/components/notification-bell.tsx`
  - `src/components/error-boundary.tsx`
  - `src/lib/utils/user-role.ts`

**驗收**：切換到 EN 後，側邊欄、鈴鐺彈窗、全站 toast、錯誤畫面全英文

### Wave 2｜入口頁：login + change-password + dashboard
- `auth.json`、`dashboard.json`
- 觸碰：`src/pages/login.tsx`、`change-password.tsx`、`dashboard.tsx`、`src/components/dashboard/*`
- Dashboard 卡片標題、空狀態、總覽欄位

### Wave 3｜病人模組：patients 列表 + discharged + detail
- `patients.json`、`patient-detail.json`、`medical-records.json`
- 觸碰：
  - `src/pages/patients.tsx`、`discharged-patients.tsx`、`patient-detail.tsx`
  - `src/components/medical-records.tsx`、`vital-signs-card.tsx`、`lab-data-display.tsx`、`lab-trend-chart.tsx`、`score-trend-chart.tsx`
  - `src/components/patient/*`
- ⚠️ **不翻譯**：病人姓名、床號、醫囑內文、SOAP 內文、HIS 來源欄位值（見 §8）

### Wave 4｜溝通：team chat + AI chat
- `chat.json`、`ai-chat.json`
- 觸碰：`src/pages/chat.tsx`、`ai-chat.tsx`、`src/components/ai-chat/*`
- ⚠️ **不翻譯**：使用者輸入訊息、AI 回應內容（後者由 model 生成，與 UI 語言獨立）

### Wave 5｜藥事工具（7 頁）
- `pharmacy.json`
- 觸碰 `src/pages/pharmacy/*` 9 個檔案 + `src/components/pharmacy/*`
- ⚠️ **不翻譯**：藥品中文名、ATC 描述、Lexicomp 原文（XD 等級保留英文縮寫即可）
- ⚠️ memory 規則：藥事工具頁面不加 emoji / 裝飾 icon — i18n 切換按鈕本身不在這些頁面，不衝突

### Wave 6｜系統管理（admin）
- `admin.json`
- 觸碰：`src/pages/admin/*` 4 個檔案

### Wave 7｜收尾
- 走查所有頁面切換到 EN，補漏字
- 加入 ESLint plugin（`eslint-plugin-i18next`）擋未來新硬編碼字串
- 寫使用文件 `docs/frontend/i18n-guide.md`：「新增字串該放哪、怎麼用 useTranslation」

## 6. 開發慣例

### 元件改寫範例
**Before：**
```tsx
<h1 className="text-2xl font-bold">團隊訊息</h1>
```

**After：**
```tsx
const { t } = useTranslation('chat');
<h1 className="text-2xl font-bold">{t('header.title')}</h1>
```

### 字串該放哪個 namespace
- 只在單一頁面/元件出現 → 該頁面 namespace
- 跨 ≥3 頁面共用（按鈕、確認對話框、loading 文字）→ `common`
- 後端錯誤訊息 → `errors`

### Pluralization
i18next 原生支援（`_one` / `_other`）：
```json
{
  "unread_one": "{{count}} 則新訊息",
  "unread_other": "{{count}} 則新訊息"
}
```
中文無單複數，兩個 key 內容相同；英文則：
```json
{
  "unread_one": "{{count}} new message",
  "unread_other": "{{count}} new messages"
}
```

### Commit 規範（依 CLAUDE.md）
- 每個 Wave 拆多個 commit：`chore(i18n-w1): extract sidebar strings`
- 不允許跨 Wave 混合
- PR 描述列出該 Wave 觸碰的檔案清單

## 7. 風險與陷阱

| 風險 | 影響 | 緩解 |
|------|------|------|
| 字典漏 key 顯示原始 key | 使用者看到 `sidebar:items.foo` | Wave 7 走查 + console.warn 攔截 missingKey |
| 動態字串拼接（`'總共 ' + n + ' 筆'`）難抽 | 翻譯不通順 | 統一改 `t('total', { count: n })` 插值 |
| 後端錯誤訊息混入英文 stack trace | UI 切 EN 但訊息仍是中文 | `errors.json` 對 backend error code 做 mapping，不直接渲染 message |
| 病人姓名遮罩（maskPatientName）含中文括號 | EN 模式下違和 | 遮罩函式接受 locale 參數，EN 用半形括號 |
| HIS 同步資料含中文（病房、診斷） | EN 模式下中英混雜 | 接受混雜，註記為「資料來自 HIS，原文保留」 |
| 字典 JSON 過大影響 bundle | 啟動慢 | 先打包進 main bundle；如 >50KB 再考慮 `i18next-http-backend` lazy load |
| TypeScript 型別 | `t()` 回傳 string，但翻譯文字含 HTML 時要 `<Trans>` | Wave 7 寫 i18n-guide 範例 |
| date-fns / dayjs locale | 若有用到時間 humanize（"3 分鐘前"） | 跟 i18n.language 同步切換 locale 包 |

## 8. 不在範圍

明確**不**翻譯的內容（保留原文）：

- 資料庫所有欄位（病人資料、醫囑、SOAP、訊息內文、藥品中文名）
- AI 模型生成回應（與 UI 語言解耦，由 prompt 決定）
- HIS 同步來源資料（病房名、科別、診斷描述）
- Lexicomp / FDA / 藥典原文資料
- 系統 log、稽核紀錄的歷史紀錄欄位
- 檔名、git commit 訊息、文件目錄（`docs/*.md` 維持中文）

## 9. 驗收標準（每 Wave 通用）

1. 切換語言 → 該 Wave 範圍內所有可見字串都跟著切
2. 重整頁面 → 語言設定保留
3. EN 模式下無顯示原始 key（`namespace:key.path`）
4. TS / lint / build 全綠
5. 對應 e2e 測試（如有）的中文 selector 同步補英文 fallback：
   ```js
   page.getByRole('link', { name: /團隊訊息|Team Messages/ })
   ```

## 10. 待決問題（已於 2026-05-04 拍板）

| # | 問題 | 決議 |
|---|------|------|
| 1 | 語言切換按鈕樣式 | **純文字 toggle `中 / EN`**（最簡潔，無 emoji/icon） |
| 2 | EN 翻譯來源 | **Claude 自動翻初版**，醫療專有名詞另列清單供校對 |
| 3 | 第三語言（日語等） | **只做中/英**，架構保留可擴充 |
| 4 | PR 節奏 | **Wave 0 + Wave 1 合一個 PR**，Wave 2 起獨立 PR |
| 5 | Lint 防硬編碼 | **Wave 7 加 `eslint-plugin-i18next`**，Wave 0-6 靠 review |

### 衍生細節（從決議展開）
- **按鈕互動**：點 `中` 切換到 EN（按鈕顯示 `EN`），再點切回中文（顯示 `中`）。即按鈕**永遠顯示對方語言**作為「點下去會變成什麼」的提示。
- **按鈕尺寸**：與深色模式按鈕一致（`size="default"` 或短視窗 `size="icon"`）；icon 模式下顯示當前語言縮寫（`中` / `EN`）。
- **醫療術語清單**：Wave 1 開始時同步建立 `docs/i18n-medical-glossary.md`，列出所有需校對的中→英對照（藥師、醫師、住院、出院、ICU 各細項、SOAP、bid/qid 等用法）。校對前用初譯版本，校對完回填字典。

## 11. 預估時程（粗估，不含校稿）

| Wave | 內容 | 預估 |
|------|------|------|
| 0 | 基建 + 切換按鈕 | 0.5 day |
| 1 | sidebar + common + errors | 0.5 day |
| 2 | login + dashboard | 0.5 day |
| 3 | 病人模組（最大宗） | 1.5 day |
| 4 | chat + ai-chat | 1 day |
| 5 | 藥事 7 頁 | 1.5 day |
| 6 | admin 4 頁 | 0.5 day |
| 7 | 收尾 + lint + 文件 | 0.5 day |
| **合計** | | **~6.5 day** 開發 + 校稿時間 |

## 12. 啟動 Checklist

開 Wave 0 PR 前確認：

- [ ] 本文件已被 PM 確認
- [ ] §10 待決問題 1-3 有結論
- [ ] 建立配對 progress 文件 `docs/i18n-rollout-progress.md`
- [ ] CLAUDE.md「開工前必讀」清單加入本計畫與 progress 文件
- [ ] 在 `docs/coordination/frontend-tasks.md` 排入 Wave 0 任務

---

**下一步**：等使用者回覆 §10 問題後，建立 progress doc 與啟動 Wave 0。
