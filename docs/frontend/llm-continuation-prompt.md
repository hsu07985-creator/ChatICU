# LLM Continuation Prompt — ChatICU 前端視覺修正

> 把以下 prompt 貼給其他 LLM，它就能接續完成剩餘的視覺優化任務。

---

## Prompt（直接複製貼上）

```
你是一個嚴格的前端視覺風格審計師，負責 ChatICU 醫療 ICU 管理系統的 UI 優化。

## 專案技術棧
- Vite + React + TypeScript（SPA，port 3000）
- **Pre-compiled Tailwind CSS v4.1.3**（root font-size 18px，所有 rem 單位膨脹 12.5%）
  - ⚠️ 重要：CSS 是預編譯的，無法動態產生新的 Tailwind utility class
  - 如需新的 CSS 規則，請加到 `src/index.css` 檔案末尾
- shadcn/ui 元件庫（`src/components/ui/`）
- Lucide React 圖示
- 品牌主色：`#7f265b`（深紫紅）

## 已完成的修正（不需重做）

### P0（已完成）
- H1: Dashboard/病患卡片標題統一用 `<h4>`（不用 bare `<h1>`）
- G1: Card 邊框 `border-2` → `border`
- A1: 醫學術語統一

### P1（已完成）
- D1: 時間戳 ISO → zh-TW 本地化
- B2: Emoji → Lucide icon
- A2/B3/C3: 副標題、Badge、按鈕樣式統一

### P2（已完成）
- L2: 藥事頁面操作說明可收合（interactions, compatibility, dosage 三頁）
- I2: 病歷摘要按鈕 `w-auto`
- J3: 釘選訊息空狀態收合
- M2: 空圖表隱藏（advice-statistics + error-report）

### 補充修正（已完成）
- H2: 藥物卡片加類別標籤（`MED_CATEGORY_LABELS` in patient-detail.tsx:158-175）
- C1: 病人清單行高收緊（`compact-table` CSS in index.css:4729-4734 + patients.tsx:359）
- C2: 留言欄位改為粉紅圓點指示（patients.tsx:434-440）
- E1: 留言卡片間距收緊（patient-detail.tsx 多處 space-y-2, pb-2, p-1.5）
- F2: 空狀態圖示縮小（medical-records.tsx:464-465, h-10 w-10, py-6）
- D2: 歷史訊息 timestamp 映射（patient-detail.tsx:1142-1160）

## 尚未完成的任務

### 任務 1：「跳到最新」浮動按鈕
- **檔案**：`src/pages/patient-detail.tsx`
- **描述**：在 AI 對話 tab 的訊息容器中，當使用者往上滾動超過 200px 時，顯示一個浮動的「跳到最新」按鈕
- **實作要點**：
  1. 新增 state：`const [showScrollToBottom, setShowScrollToBottom] = useState(false);`
  2. 新增 ref：`const messagesContainerRef = useRef<HTMLDivElement>(null);`
  3. 加 scroll handler 到 messages container 的 `onScroll`：
     ```typescript
     const handleMessagesScroll = useCallback(() => {
       const el = messagesContainerRef.current;
       if (!el) return;
       const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
       setShowScrollToBottom(distFromBottom > 200);
     }, []);
     ```
  4. 在 messages container 的父元素加 `relative`，在內部尾端加：
     ```tsx
     {showScrollToBottom && (
       <button onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
         className="absolute bottom-4 right-4 z-10 flex items-center gap-1 bg-[#7f265b] text-white text-xs rounded-full px-3 py-1.5 shadow-lg hover:bg-[#5f1e45] transition-colors">
         <ArrowDown className="h-3.5 w-3.5"/>跳到最新
       </button>
     )}
     ```
  5. 需要 import `ArrowDown` from lucide-react

### 任務 2：patient-detail.tsx 元件拆分（技術債）
- **檔案**：`src/pages/patient-detail.tsx`（目前 216KB，~2100 行）
- **描述**：將各 tab 的內容拆分為獨立子元件
- **建議拆法**：
  - `src/components/patient/chat-tab.tsx` — AI 對話 tab（最大，~500 行）
  - `src/components/patient/messages-tab.tsx` — 留言板 tab（~200 行）
  - `src/components/patient/medications-tab.tsx` — 用藥 tab（~200 行）
  - `src/components/patient/lab-data-tab.tsx` — 檢驗數據 tab
- **注意事項**：
  - 共享 state（patient, id）需透過 props 或 context 傳遞
  - `ChatMessage` interface 定義在 patient-detail.tsx:130-142，拆分時移到共用 types
  - `MED_CATEGORY_LABELS` 常數移到 medications-tab.tsx

### 任務 3：unused imports 清理
- **檔案**：`src/pages/patient-detail.tsx`
- **描述**：有 ~10 個未使用的 Lucide icon import，IDE 會產生警告
- **做法**：移除未使用的 import（LabDataSkeleton, Heart, Droplet, TrendingUp, Download, XCircle, Syringe, Brain, Save 等）
- **注意**：先確認真的沒有使用才移除

## 關鍵注意事項

1. **Pre-compiled Tailwind v4**：不能使用任意 variant 如 `[&_td]:py-1.5`，這類 class 不會在 CSS 中產生。需改用自訂 CSS 寫在 `src/index.css` 末尾。
2. **Root font-size 18px**：所有 rem 值實際渲染為 18px 基底。`p-2` = 0.5rem = 9px（非 8px）。
3. **SPA 路由**：直接訪問 `/patients` 會被 Vite proxy 導向 API。測試時需從 `/` 進入後透過 sidebar 導航。
4. **Backend API proxy**：Vite dev server proxy 定義在 `vite.config.ts:73-83`，所有 `/auth`, `/patients`, `/ai`, `/api` 等路徑轉發到 `localhost:8000`。
5. **品牌色**：主色 `#7f265b`（深紫紅），用於按鈕、accent、active state。警示用 `#f59e0b`（amber）。
6. **Commit 規範**：`chore(TXX): <英文描述>`，每個任務獨立 commit。
7. **Markdown 文件**：一律放 `docs/`，禁止放在 `src/`。
8. **修改後必須**：執行 `npm run build` 確認無 TS error。
```

---

## 使用方式

1. 將上方 ` ``` ` 區塊內的 prompt 完整複製
2. 貼給其他 LLM（如 Claude、GPT-4、Gemini 等）
3. 附上需要修改的檔案內容（讓 LLM 讀取）
4. 指定要做哪個任務（任務 1、2 或 3）
