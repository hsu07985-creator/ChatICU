# 病歷紀錄（Medical Records）UX 修改計畫

> **背景**：本文件根據 2026-05-02 由 3 個 Opus 4.7 並行審查的結果彙整。
> 範圍：`src/components/medical-records.tsx`、`src/components/pharmacist-soap-editor.tsx`、
> `src/lib/api/record-templates.ts`、`src/lib/api/ai.ts`（`streamPolishClinicalText`）。
> **本功能不需要存紀錄**——純粹是「潤飾→複製貼到 HIS」的工具。

---

## 一、問題彙總

### 🔴 P0 — 立即影響使用 / 病安風險

| # | 問題 | 位置 | 影響 |
|---|------|------|------|
| P0-1 | Production `GET /record-templates` 對 `progress-note`、`nursing-record` 回 **500**；只有 `medication-advice` 200 OK | 後端 + `medical-records.tsx:317-319` 把錯誤吞掉 | 醫師、護理師完全看不到任何自訂模板；新增看似成功（POST 200）但接下來 GET 失敗，新模板從不出現 → 使用者重複按、產生 server-side 重複資料 |
| P0-2 | 「複製貼到 HIS」當沒潤飾過時，會把**未潤飾的破中文/破英文草稿**複製進剪貼簿，但 toast 仍顯示「已複製，可貼到 HIS」 | `medical-records.tsx:445`、`canCopy` 在 `:535` | 病人病歷被貼入未潤飾文字 — 病安風險 |
| P0-3 | 「再修一次」實際送出的 `content` 是**原始草稿**而非右邊看到的潤飾結果（潤飾結果只塞在 `previousPolished`） | `medical-records.tsx:421-428` | 使用者心智模型「繼續潤飾我看到的這版」與系統行為不符；手動編輯右邊後再修一次會被忽略 — 這是「再修一次怪怪的」根因 |
| P0-4 | 套用模板會**無聲蓋掉**已寫的草稿，無確認、無 undo、localStorage 同步寫掉 → 重整也救不回 | `medical-records.tsx:334-362` | 醫師/護理師最常見的「邊寫邊探索模板」流程被破壞 |
| P0-5 | 潤飾中可繼續編草稿，串流 callback 每個 chunk 都用「當下最新的 inputContent」覆寫 `polishedFrom` → 「草稿已變動」徽章長期說謊 | `medical-records.tsx:391` | 使用者誤判潤飾結果是否對應目前草稿 |

### 🟠 P1 — 結構性 UX 缺陷

| # | 問題 | 位置 |
|---|------|------|
| P1-1 | 沒有「中止」按鈕。一旦按下潤飾要等 10–20 秒才能反悔 | `medical-records.tsx:382`、`pharmacist-soap-editor.tsx:209`（後端 `ai.ts:641` 已支援 `AbortSignal`，前端從不傳） |
| P1-2 | AI 修飾會**偷偷注入** medication context（使用者沒寫，但結果跑出 `Current medications (selected, active): …`） | 後端 prompt 行為，與「修飾」label 不符 |
| P1-3 | 藥師 SOAP 串流 JSON 解析（`extractStreamedSoapValue`）是手刻 scanner，遇到嵌套引號 / `\u` escape / key 順序變動會默默吃掉內容；使用者看到亂碼後 done 事件又覆寫 → 雙重困惑 | `pharmacist-soap-editor.tsx:74-97` |
| P1-4 | 藥師 SOAP 重新潤飾會**無聲蓋掉**手動編輯（右邊 polished pane 在串流中是 controlled component，cursor 也會跳） | `pharmacist-soap-editor.tsx:231,238,433` |
| P1-5 | 藥師 SOAP 整頁高 1600–2000px，沒有 sticky 預覽、沒有「全部潤飾」按鈕，A 和 P 必須分別等串流 | 整體 layout |
| P1-6 | 「插入 Labs / 用藥」只能打進 O；雙擊產生兩份 Labs block，無 dedup/replace | `pharmacist-soap-editor.tsx:174,183` |
| P1-7 | Lab window 下拉只在「下一次」按插入時生效；改了下拉、已插入的 Labs 不會更新 | `pharmacist-soap-editor.tsx:124,331-339` |

### 🟡 P2 — 一致性與小困擾

| # | 問題 | 位置 |
|---|------|------|
| P2-1 | 模板按鈕永遠顯示「模板」，選了哪個只在旁邊小 Badge 顯示 | `medical-records.tsx:592` |
| P2-2 | 護理紀錄左邊按鈕顯示「AI 檢查」，右邊敘述卻寫「按左側的『AI 修飾』」 | `medical-records.tsx:846` |
| P2-3 | 切換 record-type 時 `selectedTemplate` 沒在 Drafts 結構裡，會丟失 | `medical-records.tsx:296` |
| P2-4 | 套用內建模板後改內容，**無法**「另存為自訂模板」，只能複製貼到新增表單 | `medical-records.tsx:539` |
| P2-5 | 切到別的 record-type 再回來，模板套用狀態消失但 SOAP 內容還在 | `medical-records.tsx:568` |
| P2-6 | Cmd+Enter 只在 refine textarea 有效，主草稿要滑鼠按按鈕 | `medical-records.tsx:774-779` |
| P2-7 | 藥師模式違反 CLAUDE.md「藥事工具避免 emoji/裝飾 icon」原則 — Brain/Sparkles/Wand2/Pill/ArrowRight 應移除 | 多處 |
| P2-8 | 切換病人時前一筆草稿在 render 階段更新 state（可能掉編輯）；localStorage key 沒 user-namespace，共用工作站會跨帳號洩漏 | `medical-records.tsx:193,254` |
| P2-9 | `submittedAt` 是 dead code，寫了沒人讀 | `medical-records.tsx:174,757` |
| P2-10 | `BUILTIN_TEMPLATES.medication-advice` 包含「藥師 SOAP」，但所有角色（醫師/護理師）打開 用藥建議 都看得到 | `medical-records.tsx:117` |
| P2-11 | 護理紀錄 tab 上的紅點只看 `input.length`，polished 有東西也不顯示 → 隱藏使用者尚未複製的 AI 結果 | `medical-records.tsx:554-577` |
| P2-12 | localStorage 寫入 quota 錯誤被靜默吞掉 | `medical-records.tsx:225` |

---

## 二、修復順序與工作拆解

> 原則：先解鎖（P0-1）→ 修病安（P0-2）→ 修根因 bug（P0-3, P0-4, P0-5）→ 結構重構（P1）→ 一致性收尾（P2）。

### Wave 1 — 解鎖 + 病安（半天）

#### W1-T1：修 `/record-templates` 500
- **後端**：找出為什麼 `progress-note` / `nursing-record` 的 GET 回 500（疑似 seed data 缺角色 scope 或 enum 對不上）。
- **前端**（`medical-records.tsx:313-320`）：
  ```tsx
  const fetchTemplates = useCallback(async (type: RecordTemplateType) => {
    try {
      const templates = await listRecordTemplates(type);
      setServerTemplates(templates);
    } catch (err) {
      setServerTemplates([]);
      toast.error('無法載入自訂模板');
      console.error('listRecordTemplates failed', err);
    }
  }, []);
  ```
- **驗收**：醫師、護理師登入後在 patient detail 的 病歷記錄 → 模板 popover 看得到 自訂 區段；新增模板後該區段立即出現。

#### W1-T2：複製按鈕當沒潤飾就 disable
- **改 `medical-records.tsx`**：
  ```tsx
  const canCopy = polishedContent.trim().length > 0;
  ```
- **`handleCopy`**：移除 `(polishedContent || inputContent)` 的 fallback，改成只 copy `polishedContent`。
- **按鈕 hover/title**：「請先按 AI 修飾再複製」。
- **驗收**：未跑潤飾時複製按鈕灰掉、tooltip 提示。

### Wave 2 — 修「再修一次」根因（半天）

#### W2-T1：`handleRefine` 改成把 polished 當主體
- **改 `medical-records.tsx:421-428`**：
  ```tsx
  const result = await streamPolishClinicalText(
    {
      patientId,
      content: polishedContent,         // ← 改這個
      polishType: polishTypeMap[recordType],
      instruction,
      // 移除 previousPolished：避免雙軌語意
    },
    onChunk,
  );
  ```
- **後端 prompt**：確認 `instruction` 出現時把 `content` 視為「現有潤飾結果，依指示再修改」，不再從原稿重建。
- **驗收**：手動修右邊 → 加 instruction「再簡短一點」→ 結果保留手動修的詞彙、僅變短。

### Wave 3 — 修模板覆蓋與草稿狀態機（1 天）

#### W3-T1：套用模板前確認
- **`medical-records.tsx:334-362`**：套用前若 `inputContent.trim()` 非空且 `inputContent !== tpl`，顯示確認：
  - 「覆蓋目前草稿」
  - 「附加到草稿結尾」
  - 「取消」
- 同時 stash 舊草稿到 ref，toast 顯示「已套用『XXX』 [還原]」可一鍵 undo（5 秒視窗）。

#### W3-T2：潤飾期間鎖左邊 + 加中止鈕
- 抽出 polish state machine：
  ```ts
  type PolishState =
    | { kind: 'idle' }
    | { kind: 'streaming'; controller: AbortController; sourceSnapshot: string }
    | { kind: 'streamed-fresh'; sourceSnapshot: string }
    | { kind: 'streamed-stale'; sourceSnapshot: string }
    | { kind: 'error'; message: string };
  ```
- 串流期間 `<Textarea value={inputContent} disabled />`；按鈕變「停止」並 `controller.abort()`。
- `polishedFrom` 改用 `sourceSnapshot`（呼叫時凍結，不被 chunk callback 動到）→ 修 P0-5。

### Wave 4 — 藥師 SOAP 串流與 layout（1–2 天）

#### W4-T1：串流解析改穩固版
- 兩條路擇一：
  - **方案 A**：後端把 SOAP 的 target section 改用 SSE event 直接傳純文字 chunk（`event: section_delta\ndata: {"key":"p","chunk":"..."}`），前端不再解 JSON。
  - **方案 B**：前端引入 `partial-json` 之類 lib，跑 `JSON.parse(buffer + closingBrace)` 的容錯解析。
- 推薦方案 A（最終 done 事件依然回完整結果）。

#### W4-T2：A 與 P 統一 polish 介面
- 改成 segmented toggle：`[只修文法 | 套藥師格式]`，A 預設只修文法、P 預設套藥師格式。
- 移除 P 的兩顆按鈕擺放。

#### W4-T3：sticky compose pane + 「全部潤飾」
- 雙欄 layout：左欄 4 段編輯、右欄 sticky 顯示組合結果 + 複製按鈕 + 「Polish A & P」一鍵跑 A、P 兩段。
- 進度狀態：`Status: A ✓  P ⏳`。

#### W4-T4：Insert Labs/Meds 改善
- 工具列改成 sticky / 浮動於目前 focus 的可編輯段落（A、P 也能塞）。
- 已有 Labs block 用 sentinel 標記（如 `<!-- labs:24h -->`）→ 再次插入時提示「替換 / 新增一份 / 取消」。
- Lab window 下拉改顯示「下次插入會帶入：24h」chip，避免誤以為動到既有內容。

### Wave 5 — 一致性收尾（半天）

逐項處理 P2-1 ~ P2-12，特別是：

- **P2-1**：模板按鈕 trigger 顯示 `模板：{selectedTemplate || '選擇'}`；移除下面重複的「已套用模板」footer。
- **P2-2**：右邊 CardDescription 改用 `config.polishLabel` 做插值。
- **P2-3 / P2-5**：把 `selectedTemplate` 加進 `DraftEntry` 結構持久化。
- **P2-4**：當 `selectedTemplate` 是 built-in 且 `inputContent !== tpl` 時，顯示「另存為自訂模板」CTA，預填當前內容。
- **P2-6**：主 `<Textarea>` 加 Cmd/Ctrl+Enter handler 觸發 `handlePolishContent`。
- **P2-7**：`isPharmacistSoapMode` 為 true 時 strip Brain/Sparkles/Wand2/Pill/ArrowRight icon。
- **P2-8**：`draftKey` 改成 `chaticu-draft-${userId}-${patientId}`；切換病人改用 `useEffect` + 卸載前 flush。
- **P2-9**：移除 `submittedAt` 欄位。
- **P2-10**：`BUILTIN_TEMPLATES.medication-advice` 的「藥師 SOAP」用 `user.role === 'pharmacist'` gate。
- **P2-11**：Tab 紅點條件改為 `input.length > 0 || polished.length > 0`。
- **P2-12**：`saveDrafts` catch quota 錯誤時顯示 toast 並提供「清空所有病人草稿」escape hatch。

---

## 三、完成定義（Definition of Done）

每個 Wave 結束時必須通過：

1. **Local 驗證**：在 dev server 用 doctor / nurse / pharmacist 三個角色至少跑一次完整流程（草稿 → 套模板 → 潤飾 → 再修 → 複製）。
2. **Prod 部署驗證**（依 CLAUDE.md 規範）：
   - 後端改 → `git push personal main`；等 60–90s 後 `curl /health`。
   - 前端改 → `git push railway main`；確認 `/assets/index-*.js` hash 變動。
   - 用 Playwright 對 `https://chat-icu.vercel.app` 重跑三角色快速 smoke。
3. **Regression**：原本測過的 `progress-note` 流程不能比改前更糟。
4. **不新增 emoji**（CLAUDE.md feedback memory）。

---

## 四、不做的事（明確排除）

- **不**新增「儲存病歷紀錄到 DB」的功能 — 使用者明確指定純粹潤飾貼上工具。
- **不**改現有的訊息（messages）/ 用藥建議推送（advice）流程 — 那是另一條 pipeline。
- **不**在 `src/` 新增 markdown（依 CLAUDE.md 目錄慣例）。
- **不**動 Pharmacist SOAP 編輯器的核心規則：S/O 永遠不被 AI 動、A 預設只修文法、P 預設套藥師格式。

---

## 五、預估時程

| Wave | 工作量 | 累計 |
|------|--------|------|
| W1 | 半天 | 0.5d |
| W2 | 半天 | 1d |
| W3 | 1 天 | 2d |
| W4 | 1–2 天 | 3–4d |
| W5 | 半天 | 3.5–4.5d |

可以單人 4–5 天做完，或拆成 W1+W2 一個 PR、W3 一個 PR、W4 一個 PR、W5 收尾 PR。
