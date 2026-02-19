# ChatICU 前端視覺審計 — 完整修正報告

> 日期：2026-02-19
> 範圍：15 頁全站視覺審計，含 P0/P1/P2 三輪修正 + 補充修正
> 驗證方式：Playwright 自動化截圖 + `getComputedStyle` 數值驗證

---

## 一、修正總覽

| 階段 | ID | 說明 | 狀態 |
|------|-----|------|------|
| P0 | H1 | Dashboard/病患卡片標題統一為 `<h4>` | ✅ 已完成 |
| P0 | G1 | Card 邊框 `border-2` → `border` (1px) | ✅ 已完成 |
| P0 | A1 | 醫學術語統一（Progress Note, Ventilator 等） | ✅ 已完成 |
| P1 | D1 | 時間戳格式統一（ISO → `zh-TW` 本地化） | ✅ 已完成 |
| P1 | B2 | Emoji → Lucide icon 替換 | ✅ 已完成 |
| P1 | A2 | 副標題樣式統一 | ✅ 已完成 |
| P1 | B3 | Badge 色彩統一 | ✅ 已完成 |
| P1 | C3 | 按鈕樣式統一 | ✅ 已完成 |
| P2 | L2 | 藥事頁面操作說明可收合 | ✅ 已完成 |
| P2 | I2 | 病歷摘要按鈕寬度 `w-full` → `w-auto` | ✅ 已完成 |
| P2 | J3 | 釘選訊息空狀態收合 | ✅ 已完成 |
| P2 | M2 | 空圖表隱藏（advice-statistics + error-report） | ✅ 已完成 |
| 補充 | H2 | 藥物卡片加類別標籤 | ✅ 已完成 |
| 補充 | C1 | 病人清單行高收緊 | ✅ 已完成 |
| 補充 | C2 | 留言欄位改為圓點指示 | ✅ 已完成 |
| 補充 | E1 | 留言卡片間距收緊 | ✅ 已完成 |
| 補充 | F2 | 空狀態圖示縮小 | ✅ 已完成 |
| 補充 | D2 | 歷史訊息載入後顯示 timestamp | ✅ 已完成 |

---

## 二、修改檔案路徑與詳細內容

### 2.1 `src/pages/patient-detail.tsx` （核心，4 項修正）

**修正 H2 — 藥物類別標籤**
- **位置**：第 158-175 行
- **內容**：新增 `MED_CATEGORY_LABELS` 常數映射表，定義 16 種藥物類別的中文名稱與顏色
  ```
  antibiotic → 抗生素 (amber)
  vasopressor → 升壓劑 (red)
  anticoagulant → 抗凝血 (rose)
  steroid → 類固醇 (orange)
  ppi → PPI (sky)
  diuretic → 利尿劑 (cyan)
  insulin → 胰島素 (teal)
  electrolyte → 電解質 (emerald)
  ... 等 16 類
  ```
- **位置**：第 2108-2117 行（其他藥物渲染區塊）
- **內容**：在藥物名稱旁用 `<Badge>` 顯示類別標籤
- **關聯**：讀取 `Medication.category` 欄位 → 對應 `MED_CATEGORY_LABELS` → 顯示彩色 Badge
- **資料來源**：`/patients/{id}/medications` API 回傳的 `category` 欄位

**修正 E1 — 留言卡片間距收緊**
- **位置**：第 1620 行 — `space-y-3` → `space-y-2`（訊息列表間距）
- **位置**：第 1686 行 — `CardHeader className="pb-2 pt-3"`（原 `pb-3`）
- **位置**：第 1689 行 — 頭像 `p-1.5`（原 `p-2`）
- **位置**：第 1693 行 — `gap-2`（原 `gap-3`）
- **位置**：第 1710 行 — `CardContent className="pt-0 pb-3"`
- **位置**：第 1712 行 — 文字 `text-[15px]`（原 `text-[16px]`）
- **關聯**：僅影響「留言板」tab 的訊息卡片渲染，不影響其他 tab

**修正 D2 — 歷史訊息 timestamp 映射**
- **位置**：第 1142-1160 行（`fetchChatSessionApi` 回調）
- **內容**：原本 `.map(m => ({...}))` 缺少 `timestamp` 欄位映射
- **修正後**：將 API 回傳的 ISO timestamp 轉為 `zh-TW` 格式 `HH:mm`
  ```typescript
  let ts: string | undefined;
  if (m.timestamp) {
    try { ts = new Date(m.timestamp).toLocaleTimeString('zh-TW',
      { hour: '2-digit', minute: '2-digit' }); } catch { ts = undefined; }
  }
  return { ...fields, timestamp: ts };
  ```
- **關聯**：
  - API 型別定義在 `src/lib/api/ai.ts:11`（`ChatMessage.timestamp: string`）
  - 本地介面在 `patient-detail.tsx:134`（`timestamp?: string`）
  - 新訊息的 timestamp 已在第 861 行（user）和第 922 行（assistant）正確設定
  - 渲染在第 1304-1305 行（user 訊息）和第 1433-1436 行（assistant toolbar）

**其他已有修正（前次 session）**
- handleSendMessage（第 861 行）：新訊息加 `timestamp: nowTime`
- assistant 回覆（第 922 行）：完成時加 `timestamp`
- 免責聲明可收合（第 ~1260 行區域）
- AI 回覆重構（圓號、accent bar、inline toolbar）

---

### 2.2 `src/pages/patients.tsx` （2 項修正）

**修正 C1 — 行高收緊**
- **位置**：第 359 行 — `<Table className="compact-table">`
- **機制**：透過自訂 CSS class `compact-table` 覆蓋 `<td>/<th>` 的 padding
- **原因**：pre-compiled Tailwind v4.1.3 無法動態生成 `[&_td]:py-1.5`，需自訂 CSS
- **關聯**：CSS 規則定義在 `src/index.css:4729-4734`
- **效果**：td padding 9px → 6.75px，行高 ~64px → ~59px

**修正 C2 — 留言欄位改為圓點指示**
- **位置**：第 374 行 — `<TableHead className="text-center w-8">留言</TableHead>`
- **位置**：第 434-440 行 — 留言 cell 渲染
- **內容**：原本是 `<MessageCircle>` icon + 「未讀」文字 → 改為 `<span>` 圓點
  ```html
  <span class="inline-block h-2.5 w-2.5 rounded-full bg-[#ff3975]" />
  ```
- **關聯**：讀取 `patient.hasUnreadMessages` 布林值 → 顯示粉紅圓點或 `-`

---

### 2.3 `src/components/medical-records.tsx` （1 項修正）

**修正 F2 — 空狀態圖示縮小**
- **位置**：第 464-465 行
- **內容**：
  - 容器 `py-12` → `py-6`
  - Icon `h-16 w-16` → `h-10 w-10`
  - 文字加 `text-sm`
- **效果**：圖示 72px → 45px，整體空狀態區域高度大幅降低

---

### 2.4 `src/index.css` （1 項新增）

**修正 C1 — compact-table CSS 規則**
- **位置**：第 4729-4734 行（檔案末尾）
- **內容**：
  ```css
  .compact-table td,
  .compact-table th {
    padding-top: 0.375rem;
    padding-bottom: 0.375rem;
  }
  ```
- **關聯**：被 `patients.tsx:359` 的 `<Table className="compact-table">` 使用
- **原因**：Tailwind v4 pre-compiled CSS 中 `p-2`（TableCell 預設）無法被 `[&_td]:py-1.5` 覆蓋

---

### 2.5 `src/pages/pharmacy/interactions.tsx` （P2-L2）

**修正 L2 — 操作說明可收合**
- **位置**：第 32 行 — `const [instructionsOpen, setInstructionsOpen] = useState(true);`
- **位置**：第 285-291 行 — CardHeader 加 `cursor-pointer onClick` toggle
- **內容**：ChevronDown/ChevronRight 切換 + `{instructionsOpen && (<CardContent>...)}`
- **關聯**：同樣修正套用至 `compatibility.tsx` 和 `dosage.tsx`

---

### 2.6 `src/pages/pharmacy/compatibility.tsx` （P2-L2）

**修正 L2 — 操作說明可收合（同上模式）**
- **位置**：第 49 行 — state
- **位置**：第 349-355 行 — toggle + 條件渲染

---

### 2.7 `src/pages/pharmacy/dosage.tsx` （P2-L2）

**修正 L2 — 操作說明可收合（同上模式）**
- **位置**：第 23 行 — state
- **位置**：第 271-277 行 — toggle + 條件渲染

---

### 2.8 `src/pages/chat.tsx` （P2-J3）

**修正 J3 — 釘選訊息空狀態收合**
- **位置**：第 277-279 行 — `{messages.filter(m => m.pinned).length > 0 && <Badge>}`
- **位置**：第 282 行 — `{messages.filter(m => m.pinned).length > 0 && <CardContent>...}`
- **內容**：無釘選訊息時僅顯示 header（不顯示「目前沒有釘選訊息」空文字），有釘選時顯示數量 Badge

---

### 2.9 `src/components/patient/patient-summary-tab.tsx` （P2-I2）

**修正 I2 — 摘要按鈕寬度**
- **位置**：第 159 行
- **內容**：`className="w-full bg-[#7f265b] hover:bg-[#631e4d] sm:w-auto"` → `className="bg-[#7f265b] hover:bg-[#631e4d] w-auto"`

---

### 2.10 `src/pages/pharmacy/advice-statistics.tsx` （P2-M2）

**修正 M2 — 空圖表隱藏**
- **位置**：第 85 行 — `totalAdvices` 計算
- **位置**：第 250 行 — `{totalAdvices > 0 && (<div className="grid gap-4 lg:grid-cols-2">...)}`
- **內容**：無資料時整個圖表區塊不渲染（PieChart + BarChart）

---

### 2.11 `src/pages/pharmacy/error-report.tsx` （P2-M2 延伸）

**修正 M2 — 空錯誤類型分布隱藏**
- **位置**：第 124-127 行 — `errorTypeCount` 計算
- **位置**：第 288 行 — `{Object.keys(errorTypeCount).length > 0 && (<Card>...)}`

---

## 三、檔案關聯圖

```
src/index.css (compact-table 規則)
  └─→ src/pages/patients.tsx (C1: Table className)
        └─→ src/components/ui/table.tsx (TableCell p-2 被 CSS 覆蓋)

src/lib/api/ai.ts (ChatMessage.timestamp 型別)
  └─→ src/pages/patient-detail.tsx
        ├── L134: 本地 ChatMessage interface (timestamp?: string)
        ├── L861: handleSendMessage (新訊息加 timestamp)
        ├── L922: onComplete (AI 回覆加 timestamp)
        ├── L1142-1160: fetchChatSessionApi (歷史訊息映射 timestamp) ← D2 修正
        ├── L1304: user 訊息渲染 timestamp
        └── L1433: assistant toolbar 渲染 timestamp

src/pages/patient-detail.tsx
  ├── L158-175: MED_CATEGORY_LABELS ← H2 修正
  │     └── L2108: 藥物卡片 Badge 渲染 (讀取 med.category)
  │           └── 資料來源: /patients/{id}/medications API
  ├── L1620,1686,1689: 留言卡片間距 ← E1 修正
  └── L1142-1160: 歷史 timestamp 映射 ← D2 修正

src/pages/pharmacy/interactions.tsx ─┐
src/pages/pharmacy/compatibility.tsx ─┤ 共用相同 collapsible 模式 (P2-L2)
src/pages/pharmacy/dosage.tsx ────────┘

src/pages/pharmacy/advice-statistics.tsx ─┐ 共用 totalCount > 0 隱藏模式 (P2-M2)
src/pages/pharmacy/error-report.tsx ──────┘
```

---

## 四、任務規劃（後續可做）

### 4.1 已完成但可強化
| 項目 | 描述 | 優先級 |
|------|------|--------|
| E2 | 留言卡片分群（依日期 / 依角色） | 低 |
| B1 | Dashboard 空 avatar 佔位處理 | 低（目前紫色圓圈即為設計） |

### 4.2 對話介面重構（已有 plan）
依照 `radiant-skipping-wren.md` plan，已部分完成：
- ✅ Step 2: 訊息加 timestamp
- ✅ Step 4: 免責聲明可收合
- ✅ Step 5: AI 回覆重構（accent bar, inline toolbar, round badge）
- ✅ Step 8: Session 刪除 hover-only
- ✅ Step 9: messages space-y-3 → space-y-2（已改為 space-y-2）
- ⬜ Step 3: 「跳到最新」浮動按鈕（showScrollToBottom）
- ⬜ Step 7: 「跳到最新」UI 渲染

### 4.3 技術債
| 項目 | 描述 |
|------|------|
| Tailwind v4 class 限制 | pre-compiled CSS 無法動態產生新 utility，需用自訂 CSS 或 inline style |
| patient-detail.tsx 體積 | 216KB，應考慮拆分成子元件（ChatTab, MedsTab, MessageTab） |
| unused imports | patient-detail.tsx 有 ~10 個未使用的 Lucide icon import（IDE 警告） |

---

## 五、Playwright 驗證結果

| 修正 | 驗證方式 | 結果 |
|------|----------|------|
| H2 | 截圖確認 Badge 顯示 | ✅ Heparin→抗凝血, Meropenem→抗生素, Pantoprazole→PPI |
| C1 | `getComputedStyle(td).paddingTop` | ✅ 9px → 6.75px |
| C2 | `querySelector('span.rounded-full')` | ✅ 11.25×11.25px, bg=#ff3975 |
| E1 | 截圖確認間距 | ✅ 視覺更緊湊 |
| F2 | `getComputedStyle(svg).width` | ✅ 72px → 45px |
| D2 | 建立 session → 切換 tab → 重新載入 → 檢查 timestamp | ✅ "下午02:29" 保留 |

Build 驗證：`npm run build` → ✓ 1.49s，無 TS error
