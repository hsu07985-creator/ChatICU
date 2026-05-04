# ChatICU 前端 i18n 指南

> 適用對象：未來會在 ChatICU 前端新增 / 修改 UI 字串的人（含 LLM 助手）。閱讀時間 5 分鐘。
> 配對：[plan](../i18n-rollout-plan-2026-05-04.md) / [progress](../i18n-rollout-progress.md) / [glossary](../i18n-medical-glossary.md)

ChatICU 已導入 `react-i18next`，支援 `zh-TW`（預設）/ `en-US` 切換。所有可見 UI 字串都應走 `t()`，不可硬編碼中文 / 英文字面量。

## 1. 決定字串該放哪個 namespace

### 現有 20 個 namespace（依使用範圍）

| namespace | 範圍 |
|-----------|------|
| `common` | 跨頁共用按鈕 / 狀態 / 相對時間（save / cancel / loading / 剛剛 …） |
| `errors` | ErrorBoundary、全站 toast 共用錯誤訊息 |
| `notifications` | 鈴鐺彈窗、未讀通知摘要 |
| `roles` | 角色名稱（pharmacist / physician / nurse …）— 各頁顯示用 |
| `sidebar` | 側邊欄 group label / menu item / footer 切換按鈕 |
| `auth` | 登入頁 + 改密碼頁 |
| `dashboard` | 首頁總覽（HIS sync、metrics、病患卡片、edit dialog） |
| `patients` | 住院 / 出院列表 + 共用 edit / archive dialog |
| `patient-detail` | patient-detail.tsx 主頁 + 5 共用元件（header / state guard / activity panel / confidence / expert review） |
| `patient-tabs` | patient-summary-tab / patient-labs-tab |
| `medications` | patient-medications-tab + 4 medication 子元件 |
| `medical-records` | medical-records.tsx（含 SOAP draft / polish / templates） |
| `labs` | lab-data-display + lab-trend-chart（檢驗欄位 60+） |
| `score-trend` | score-trend-chart（pain / RASS） |
| `microbiology` | patient-microbiology-card |
| `diagnostic-reports` | patient-diagnostic-reports |
| `patient-chat` | patient-messages-tab + patient-chat-tab + chat-message-thread + discharge-check-panel |
| `chat` | team chat（chat.tsx）+ ai-chat |
| `pharmacy` | 藥事 7 頁（workstation / duplicates / dosage / interactions / compatibility / drug-library / advice-statistics） |
| `admin` | admin 4 頁（users / audit / statistics / medication-normalization） |

### 怎麼選 namespace（決策樹）

```
這個字串會在哪些頁面 / 元件出現？
├── 只出現在「一個頁面 / 一個元件家族」
│   └── → 用該頁面 namespace（例：admin 頁面用 admin）
├── 出現在「同模組 ≥ 2 個元件」（patient detail 各 tab、patient detail 共用元件）
│   └── → 用模組 namespace（patient-tabs / medications / patient-detail）
├── 出現在「跨模組 ≥ 3 個地方」
│   └── → 用 common（actions / status / time）或 errors / roles / notifications
└── 是全新一塊功能（≥ 30 keys 且範圍清楚）
    └── → 開新 namespace（見 §7）
```

**判準是「使用範圍」而非「主題」。**
舉例：`'病患'` 標籤同時出現在 dashboard、pharmacy 工具頁、patient-detail —
不要每個 namespace 都複製一份，放 `common:patient` 或 `pharmacy:common.patient` 共用。

「common 化」門檻：≥ 3 個地方使用同一文字。否則先放在最先用到它的 namespace。

## 2. 命名慣例

### 格式

```
<namespace>:<section>.<key>
<namespace>:<page>.<section>.<key>   ← 大型 namespace（pharmacy / admin / patients）
```

- section 與 key 一律 **camelCase**
- **不可用中文當 key**（key 是 stable identifier，翻譯改了 key 不該動）
- 按鈕狀態用「動詞」描述「點下去會做什麼」，不要用「過去式 / 完成狀態」

### 好範例（從現有字典擷取）

```jsonc
// common.json
"actions.save"       // 儲存 / Save             ← 動詞
"actions.cancel"     // 取消 / Cancel
"status.loading"     // 載入中... / Loading...   ← 進行中

// pharmacy.json
"duplicates.header.title"          // 重複用藥偵測 / Duplicate Medication Detection
"duplicates.manual.submitting"     // 偵測中... / Detecting...   ← 動詞 ing
"duplicates.errors.tooManyDrugs"   // 最多 {{max}} 個藥品

// dashboard.json
"card.ageYears"      // {{age}} 歲 / {{age}} y/o   ← 帶插值

// patients.json
"create.gender.male" // 男 / Male                  ← 巢狀 enum 化
```

### 壞範例

```jsonc
"已儲存"              // ❌ 中文 key
"saved"              // ❌ 完成狀態（按鈕應寫 save / saving）
"someButton"         // ❌ 沒指出在哪頁、做什麼
"patient_age_label"  // ❌ snake_case
```

## 3. `useTranslation()` hook vs module-scope `i18n.t()`

### React component → 一律用 hook

```tsx
import { useTranslation } from 'react-i18next';

export function MyCard() {
  const { t } = useTranslation('pharmacy');
  return <h2>{t('duplicates.header.title')}</h2>;
}
```

### Module-scope helper / class component / 早期初始化 → 直接 `i18n.t()`

```ts
import i18n from '../i18n/config';

// module-scope helper（如 medical-records 的 formatTimestamp）
export function formatTimestamp(d: Date): string {
  return d.toLocaleString(i18n.language, { timeZone: 'Asia/Taipei' });
}

// class component（ErrorBoundary 唯一 case）
class ErrorBoundary extends React.Component {
  render() {
    return <div>{i18n.t('errors:boundary.title')}</div>;
  }
}

// schema 驗證 / utils 拋錯訊息（W6 medication-normalization）
throw new Error(i18n.t('admin:medNorm.errors.parseFailed'));
```

### 子元件必須各自呼叫 hook（W5c 踩過的雷）

❌ **不要**靠外層 `t` 透過 prop 一路傳給子元件 / module helper：

```tsx
// pharmacy-report-view.tsx 的子函式（W5c bug）
function renderPanel(t: TFunction) { ... }   // 需要每處傳入，易漏
```

✅ **每個 component 自己 call hook**：

```tsx
function ReportPanel() {
  const { t } = useTranslation('pharmacy');   // 各自 useTranslation
  return ...;
}
```

理由：hook 會自動跟著語言切換 re-render；用 prop 傳的 `t` 雖然也是 reactive，但散布後維護成本與遺漏風險高。

## 4. 插值與複數

### 基本插值

```jsonc
// pharmacy.json
"duplicates.manual.description": "輸入至少 {{min}} 個藥品（最多 {{max}}）..."
```

```tsx
t('duplicates.manual.description', { min: 2, max: 10 })
```

### 複數（i18next `_one` / `_other`）

中文不分單複數，多數情況直接寫**一個版本**就好；只有當英文必須區分時，才寫 `_one` / `_other`：

```jsonc
// zh-TW/notifications.json
"unread": "{{count}} 則新訊息"

// en-US/notifications.json
"unread_one":   "{{count}} new message",
"unread_other": "{{count}} new messages"
```

```tsx
t('notifications:unread', { count: 3 })
```

i18next 會依 `count` 自動選 `_one` / `_other`；中文沒有變體就 fall back 到 base key。

### JSX 內嵌 component（rare）

`<a>`、`<strong>` 內嵌 → 用 i18next-react 的 `<Trans>`：
參考 [i18next-react Trans docs](https://react.i18next.com/latest/trans-component)。
ChatICU 目前沒大量使用，遇到先寫 issue 討論。

## 5. 常見錯誤（前 6 wave 踩過的雷）

| 錯誤 | 範例 | 修法 |
|------|------|------|
| 寫死 `'zh-TW'` 給 `toLocaleString` / `Intl.DateTimeFormat` | `d.toLocaleString('zh-TW', {...})` | 改 `d.toLocaleString(i18n.language, {...})`，仍保留 `timeZone: 'Asia/Taipei'` |
| 子元件靠外層 `t` | 一個檔案多個函式共用一個 `t` | 每個 component / 函式自己 `useTranslation()` 或 import `i18n` |
| 把整個 JSX block 包進 `t()` | `t('html.<b>foo</b>')` | 拆 keys 或用 `<Trans>` |
| module-scope 物件放 label | `const ROLE_LABEL = { pharmacist: '藥師' }` | 改 ID + `t()` 查表（W3b 已示範 `useRoleLabel()`） |
| `t` 名稱衝突 | `templates.map((t) => ...)` 撞 `useTranslation` | 改 callback 參數名（W3c 改成 `tpl`） |
| 把 backend zh marker 也翻譯 | `'JSON 離線模式'`（後端送來的 string） | 故意不翻；UI chrome 才走 t() |
| detect-secrets 把 `passwordLabel` 誤判 | pre-commit fail | `.pre-commit-config.yaml` 已加 `src/i18n/locales/.*` exclude |
| 翻譯模板 / SOAP 內文 | `'主訴'` / `'處置計畫'` 等 fill-in 區段 | 不翻譯（使用者填寫的占位結構，不是 UI chrome） |
| 翻譯藥品中文名 / Lexicomp 原文 | `Acetaminophen` / 中文藥名 | 不翻譯（資料層 vs UI 層） |

## 6. 加新字串的 checklist

依序：

1. **決定 namespace**（§1 決策樹）
2. **加 zh-TW key** 到 `src/i18n/locales/zh-TW/<ns>.json`
3. **同步加 en-US key** 到 `src/i18n/locales/en-US/<ns>.json`（必要！缺的話 EN 會 fallback 到中文，使用者看到的混雜）
4. **元件用 `t()`**：React → `useTranslation('<ns>')`；module → `i18n.t('<ns>:<key>')`
5. **`npm run typecheck`** 通過
6. （建議）瀏覽器手切 EN 確認新字串都跟著切

## 7. 加新 namespace 的步驟

只有當功能「≥ 30 keys 且範圍明確獨立」才開新 namespace。否則放既有 namespace。

### 4 處需要改 `src/i18n/config.ts`

1. 建檔：`src/i18n/locales/zh-TW/<name>.json` + `src/i18n/locales/en-US/<name>.json`
2. 在 `config.ts` 新增 zh-TW import：`import zhTWFoo from './locales/zh-TW/foo.json';`
3. 新增 en-US import：`import enUSFoo from './locales/en-US/foo.json';`
4. 加進 `NAMESPACES` 常數陣列
5. 加進 `resources['zh-TW']` block
6. 加進 `resources['en-US']` block

> i18next 不會自動掃描 locales 資料夾 — 必須手動註冊到 `resources`，否則 `t('foo:bar')` 會回傳 raw key。

## 8. ESLint：`no-literal-string`（W7 進行中）

W7 將加入 [`eslint-plugin-i18next`](https://github.com/edvardchen/eslint-plugin-i18next) 並啟用 `no-literal-string` rule，
擋未來新增的硬編碼中文 / 英文字面量。

### 已知 false positive 處理（將在 W7 落地）

- `e2e/**/*.spec.js` — 測試用中文 selector，exclude
- `src/lib/**/*.test.ts` / `__tests__` — 測試 fixture，exclude
- `src/imports/**` — Figma 匯出檔（reference only），exclude
- `**/*.json` — 字典本身，exclude
- 開發用 `console.log` / `console.warn` 訊息（非使用者可見）— allow（rule option `markupOnly: true` 或 `ignore` regex）

如果 lint 對某段合理的非 UI 字串吵，先在 PR comment 說明，再決定是 inline `// eslint-disable-next-line` 還是補 exclude pattern。

### detect-secrets

`.pre-commit-config.yaml` 已將 `src/i18n/locales/.*` 加入 exclude，避免 `passwordLabel` 等 i18n key 被當 secret。新增 namespace 不需再改。

## 速查

- 主計畫：[`docs/i18n-rollout-plan-2026-05-04.md`](../i18n-rollout-plan-2026-05-04.md)
- 進度與設計決策：[`docs/i18n-rollout-progress.md`](../i18n-rollout-progress.md)
- 醫療術語對照：[`docs/i18n-medical-glossary.md`](../i18n-medical-glossary.md)
- i18next 官方：<https://www.i18next.com/>
- react-i18next：<https://react.i18next.com/>
