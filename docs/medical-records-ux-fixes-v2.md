# 病歷紀錄 UX 修改計畫 v2

> **v2 變更摘要**：依 4 個 Opus 4.7 並行驗證結果重寫。修正 v1 中
> P0-1 範圍誤判、P0-3 修法會打破後端 contract、W3-T2 鎖 textarea、
> P2-7 icon 清單錯誤、P2-9 過度刪除、P2-10/P2-11 修法不可行 等問題；
> 新增 M-1 ~ M-13 共 9 項漏掉的 issue（含 2 項 P0 病安）；
> 重排 Wave 為 4 個並把藥師 SOAP 前移（藥師為主要使用者）。
>
> 範圍：`src/components/medical-records.tsx`、`src/components/pharmacist-soap-editor.tsx`、
> `src/lib/api/record-templates.ts`、`src/lib/api/ai.ts`（`streamPolishClinicalText`）、
> `backend/app/schemas/record_template.py`、`backend/app/llm.py`。
>
> **本功能不需要存紀錄**——純粹是「潤飾→複製貼到 HIS」的工具。

---

## 一、Production 測試帳號（CLAUDE.md 過期，這份才正確）

CLAUDE.md / `_archive_candidates/.../users.json` 列的 `doctor / nurse / pharmacist`
**在 prod 不存在**。實際 prod seed 結果：

| 角色 | username | userId |
|------|----------|--------|
| admin | jht12020304 | usr_330f80 |
| doctor | DAX94 | usr_d8cbe8 |
| nurse | （兩位） | usr_cf2df3 / usr_d9c782 |
| pharmacist | A3266 | usr_1d14a8 |

未來測試請用以上帳號；CLAUDE.md 也應更新（屬另一個 task）。

---

## 二、問題彙總（v2 重排）

### 🔴 P0 — 必修（病安 / 阻斷使用）

| # | 問題 | 位置 | 影響 |
|---|------|------|------|
| **P0-1** | Production `GET /record-templates?recordType=nursing-record` 在 **nurse 身分**回 500（doctor / pharmacist 不會；其他 recordType 也不會） | 後端 root cause：`backend/app/schemas/record_template.py:41`；前端錯誤吞掉：`medical-records.tsx:317-319` | 護理師完全看不到任何 nursing-record 模板，新增模板 POST 200 但下次 GET 又 500 → 重複按、產生 server-side 重複資料 |
| **P0-2** | 「複製貼到 HIS」當沒潤飾過時，會把未潤飾的破中文/英文草稿複製進剪貼簿，但 toast 仍顯示「已複製，可貼到 HIS」 | `medical-records.tsx:445`（`handleCopy`）；`canCopy` 在 `:535` | 病人病歷被貼入未潤飾文字 — 病安風險 |
| **P0-3** | AI 潤飾**偷偷注入**病人 medication context（使用者沒寫，結果跑出 `Current medications (selected, active): ...`），label 卻寫「修飾」 | 後端 prompt 行為，前端無透明度提示 | 醫師可能簽名通過自己沒寫過的藥物列表進病歷 — 病安 + 法律責任 |
| **P0-4** | 沒有「中止」按鈕。一旦按下潤飾要等 10–20 秒才能反悔；M-1 timeout 修法的前置 | `medical-records.tsx:382`、`pharmacist-soap-editor.tsx:209`；後端 `ai.ts:638-647` 已支援 `signal` 但前端從不傳 | 使用者人質化、token 浪費 |
| **P0-5** | 套用模板**無聲蓋掉**已寫的草稿，無確認、無 undo、`updateDraft` 同步寫掉 localStorage → 重整也救不回 | `medical-records.tsx:334-362` | 醫師 / 護理師最常見的「邊寫邊探索模板」流程被破壞 |
| **P0-6 (新)** | **串流潤飾沒有 timeout，半截結果留在 `polishedContent` 沒清。**網路掉、後端 500 mid-stream → 使用者看到截斷的 polish，`canCopy=true`，可能直接複製進 HIS | `ai.ts:638-720`；`medical-records.tsx:395` 用空 catch | 病安：HIS 收到中斷句子 |
| **P0-7 (新)** | **跨病人資料污染。** patient 切換用 render-phase setState（`:253-258`），in-flight polish chunk callback 繼續寫 `updateDraft(recordType, …)` 進**新患者**的 localStorage | `medical-records.tsx:253-258` + `:391` | 病安 + 法規：B 病人病歷出現 A 病人的潤飾文字 |

### 🟠 P1 — 結構性 UX / 應與 P0 同梯次處理

| # | 問題 | 位置 |
|---|------|------|
| P1-1 | 「再修一次」實際送的 `content = inputContent`（原始草稿），polished 只塞在 `previousPolished`。手動修右邊後再修一次，behavior 不一致；**修法不是改 API 而是改 UI mental model**（見 W2） | `medical-records.tsx:421-428`；後端契約 `backend/app/llm.py` REFINEMENT mode |
| P1-2 | 潤飾中可繼續編草稿；串流 callback 每個 chunk 用「當下最新的 inputContent」覆寫 `polishedFrom` → 「草稿已變動」徽章長期說謊 | `medical-records.tsx:391`（`inputContent` 從 closure 取最新值） |
| P1-3 | 藥師 SOAP 串流 JSON 解析（`extractStreamedSoapValue`）是手刻 scanner：只處理 `\n \t \r` escape，遇到 `\u00XX` 會把字面 `u` 寫進 buffer；chunk 邊界切到 `\\` 之後的 `"` 會早結 string | `pharmacist-soap-editor.tsx:74-97` |
| P1-4 | 藥師 SOAP 重新潤飾**無聲蓋掉**手動編輯（polished pane 在串流中是 controlled component，cursor 也會跳） | `pharmacist-soap-editor.tsx:231,238,433` |
| P1-5 | 藥師 SOAP 整頁高 1600–2000px，沒有 sticky 預覽，A 和 P 必須分別等串流（沒有「Polish A & P」一鍵） | 整體 layout |
| P1-6 | 「插入 Labs / 用藥」**hard-coded 只能打進 O**（`'o'`）；雙擊產生兩份 Labs block 無 dedup | `pharmacist-soap-editor.tsx:174,183`、`:141-166` |
| P1-7 | Lab window 下拉只在「下次插入」生效；改了下拉但已插入的 Labs 不會更新 | `pharmacist-soap-editor.tsx:124,331-339` |
| **P1-8 (新)** | 藥師 SOAP composed output (`:253-261`) 無腦用 `polishedSoap.s || soap.s`，編輯 source 後 polished 變 stale **無視覺提示**；剛貼進 HIS 才發現用到舊版 | `pharmacist-soap-editor.tsx:253-261` |
| **P1-9 (新)** | **Auth race**：`useState(getDefaultRecordType())` 第一次 render `user` 是 null → 所有人 default 到 `progress-note`，藥師打開 patient page 沒看到 SOAP 編輯器，得手動切 `用藥建議` | `medical-records.tsx:241-247` |
| **P1-10 (新)** | **IME composition 誤觸 Cmd+Enter**：中文 IME 提交候選字會觸發 Enter；refine handler 缺 `e.nativeEvent.isComposing` 檢查 | `medical-records.tsx:890-895`、`pharmacist-soap-editor.tsx:451-466` |
| **P1-11 (新)** | Session 過期 mid-stream → 後續 refine/save 401 → toast「AI 修飾失敗」使用者完全不知道要重登；apiClient 401 沒 reset auth state | `medical-records.tsx:395`（generic catch） |
| **P1-12 (新)** | localStorage quota 滿了之後 in-memory 還繼續更新（`saveDrafts` swallow `:225`），重整後丟資料；無任何訊號 | `medical-records.tsx:221-227` |
| P1-13 | CLAUDE.md memory `feedback_no_icons_emoji` 是 standing policy：藥事工具頁面禁止裝飾 icon。`pharmacist-soap-editor.tsx:33` import 了 `Brain, Sparkles, Wand2, Pill`（裝飾）+ `FlaskConical, Syringe, Copy`（功能性）。同樣 `medication-advice` recordType **任何角色**進入都算藥事工具，`medical-records.tsx` 也要 strip | `pharmacist-soap-editor.tsx:33`、`medical-records.tsx`（用藥建議分支） |
| P1-14 | `BUILTIN_TEMPLATES.medication-advice` 內含 `藥師 SOAP`，所有角色（含醫師）打開 用藥建議 popover 都看得到。配合 P1-15，是 clinical correctness 問題 | `medical-records.tsx:117` |
| P1-15 (新, 配 P1-14) | 醫師若不慎套到 `藥師 SOAP`：因為該模板 S/O/A 都空，`flattenSoapTemplate` 走 single-section 分支（`:101`）只剩 `1.Please consider…` 一坨進 textarea，沒有 section header，使用者搞不清楚自己貼了什麼 | `medical-records.tsx:90-103,117-124` |

### 🟡 P2 — 一致性與小困擾

| # | 問題 | 位置 |
|---|------|------|
| P2-1 | 模板按鈕永遠顯示「模板」，選了哪個只在旁邊小 Badge 顯示（精確：靜態 `模板` 文字在 `:591`，Badge 在 `:593`） | `medical-records.tsx:584-597` |
| P2-2 | 護理紀錄左邊按鈕顯示「AI 檢查」，右邊敘述卻 hardcode「按左側的『AI 修飾』」 | `medical-records.tsx:846` |
| P2-3 | 切換 record-type 時 `selectedTemplate` 不在 `DraftEntry` 結構裡，會丟失 | `medical-records.tsx:296,568` |
| P2-4 | 套用內建模板後改內容，**沒有「另存為自訂模板」入口**（`templateDirty` 在 `:541` gate `editableSelectedTemplate`，built-in 永遠 false） | `medical-records.tsx:539-543,678-692` |
| P2-5 | 切到別的 record-type 再回來，模板套用狀態消失但 SOAP 內容還在 ← 易誤判 | `medical-records.tsx:568` |
| P2-6 | 主草稿 textarea 沒 Cmd+Enter handler；只有 refine textarea 有 | `medical-records.tsx:774-779` vs `:890-895` |
| P2-7 | 切換病人時前一筆草稿在 render 階段更新 state；localStorage key 沒 user-namespace（`chaticu-draft-${patientId}`），共用工作站跨帳號洩漏 | `medical-records.tsx:193,254` |
| P2-8 | `submittedAt` **唯一**signal pharmacist 真的按了複製，**不要刪**——改名 `lastCopiedAt` 並在 SOAP composed 顯示「last copied N min ago」 | `medical-records.tsx:174,757`（無讀取者） |
| P2-9 | Tab 紅點只看 `input.length`，polished 有未複製內容看不出來。**正確邏輯**：`input.length > 0 || (polished.length > 0 && polishedFrom !== input)`（**不是** `||polished.length>0`，那會讓紅點永遠亮） | `medical-records.tsx:554,575` |
| P2-10 | localStorage quota 錯誤靜默吞 → 加 toast + 提供「清空所有病人草稿」escape hatch（M-13 / P1-12 的後續） | `medical-records.tsx:225` |
| P2-11 | 缺 `aria-live` / `role="status"`：螢幕閱讀器使用者完全感受不到串流 | `medical-records.tsx:850-855` |
| P2-12 | 藥師 polish output 可能含 markdown（`**bold**` / `- ` bullets），HIS textarea 不 render → 顯示 `**` 字面值。需要 strip 或在 backend prompt 禁用 markdown | 後端 prompt + `handleCopy` |
| P2-13 | iPad portrait（藥師 ICU 床邊用）SOAP layout ≈ 2400px 高，沒 sticky 沒 floating copy → 必須 scroll to bottom 才能 copy | layout |

---

## 三、Wave 計畫（v2 重排）

> 原則：**先解鎖 + 病安**（W1）→ **修串流完整性 + 藥師關鍵 bug**（W2，提前因為藥師是主要使用者）→ **模板與草稿狀態機**（W3）→ **藥師 layout + 一致性收尾**（W4）。
>
> Wave 對應到 PR：建議拆 4 個 PR（W1 一個、W2 一個、W3 一個、W4 一個）。

### Wave 1 — 解鎖 + 病安（1 天）

#### W1-T1：修 `/record-templates` 500（root cause 已找到）

**後端**：`backend/app/schemas/record_template.py:41-42`

```python
# Before
createdById: str
createdByName: str

# After
createdById: Optional[str] = None
createdByName: Optional[str] = None
```

ORM 在 migration 075 之後 `created_by_id` 改為 `nullable=True`（`ON DELETE SET NULL`），prod 上 4 個 nursing 系統模板的原 seed user 被硬刪，現值是 NULL，因此 Pydantic validation 拋例外 → 500。

**選擇性 backfill migration**（idempotent）：

```sql
UPDATE record_templates
SET created_by_id = 'usr_330f80',
    created_by_name = COALESCE(created_by_name, '系統管理')
WHERE is_system = true AND created_by_id IS NULL;
```

`usr_330f80` 是 prod 唯一存在的 admin user（`jht12020304`），不要用 `usr_003`（不存在於 prod）。

**前端錯誤透明化**：`src/components/medical-records.tsx:313-320`

```tsx
const fetchTemplates = useCallback(async (type: RecordTemplateType) => {
  try {
    const templates = await listRecordTemplates(type);
    setServerTemplates(templates);
  } catch (err) {
    setServerTemplates([]);
    // Sonner replaces by id → 不會 toast spam
    toast.error('無法載入自訂模板', { id: 'record-templates-fetch' });
    console.error('listRecordTemplates failed', err);
  }
}, []);
```

**驗收**：`docs/his-sync-schedule-and-manual-trigger.md` 風格的 curl 三組合一起跑：

```bash
# 用 prod admin 帳號登入抓 cookie 後
for rt in progress-note medication-advice nursing-record; do
  curl -s -b cookies.txt "https://chaticu-production-8060.up.railway.app/record-templates?recordType=$rt&includeInactive=false" \
    | jq -c '{recordType: "'"$rt"'", success, templates: (.data.templates | length)}'
done
# 期望全部 success=true
```

#### W1-T2：複製按鈕——**relabel 不 disable**（修正 v1）

不要 disable，因為護理師有「貼空白模板到 HIS 手填」的合法工作流。改 label：

```tsx
const hasPolished = polishedContent.trim().length > 0;
const copyLabel = hasPolished ? '複製潤飾結果到 HIS' : '複製草稿到 HIS（未潤飾）';
const copyVariant = hasPolished ? 'primary' : 'outline-warning';

<Button onClick={handleCopy} disabled={!canCopy} className={copyVariant === 'primary' ? 'bg-brand' : 'border-amber-500 text-amber-700'}>
  <Copy className="mr-2 h-4 w-4" />
  {copyLabel}
</Button>
```

`handleCopy` toast 也對應變化：「已複製潤飾結果」vs「已複製未潤飾草稿，注意檢查」（黃色警告）。

#### W1-T3：PHI 注入透明度 (P0-3)

只在 UI 加提示就好，不動後端 prompt（後端注入是設計、有臨床價值）：

```tsx
{canPolish && (
  <p className="text-[11px] text-slate-400">
    AI 修飾會帶入此病人的用藥列表與檢驗摘要作為背景；請檢查潤飾結果再複製。
  </p>
)}
```

放在 polish 按鈕下方。對應 backend `polish_clinical_text` route 的 system prompt 行為。

#### W1-T4：Abort 按鈕 (P0-4) — 簡單版（state machine 在 W3 重構）

```tsx
const polishAbortRef = useRef<AbortController | null>(null);

const handlePolishContent = async () => {
  // ...
  polishAbortRef.current?.abort();
  const controller = new AbortController();
  polishAbortRef.current = controller;
  try {
    await streamPolishClinicalText({ ... }, onChunk, controller.signal);
  } finally {
    polishAbortRef.current = null;
  }
};

// 按鈕：
{isPolishing ? (
  <Button onClick={() => polishAbortRef.current?.abort()} variant="outline">
    <X className="mr-2 h-4 w-4" /> 停止
  </Button>
) : (
  <Button onClick={handlePolishContent} ...>AI 修飾</Button>
)}
```

`streamPolishClinicalText` 第三參數已經是 `signal`（`ai.ts:642`），目前沒人傳。

#### W1-T5：跨病人污染 (P0-7)

把 `setHydratedPatient` 改成 `useEffect`，並在 patientId 變動時 abort 任何 in-flight polish：

```tsx
useEffect(() => {
  // abort in-flight 避免寫進新 patient 的 drafts
  polishAbortRef.current?.abort();
  setDraftsState(loadDrafts(patientId));
}, [patientId]);
```

順便修 P1-9（Auth race）：

```tsx
const [recordType, setRecordType] = useState<RecordType>('progress-note');

useEffect(() => {
  // 等 user 真的 hydrate 之後再決定 default
  if (user?.role === 'pharmacist') setRecordType('medication-advice');
  else if (user?.role === 'nurse') setRecordType('nursing-record');
}, [user?.role]);
```

只在初次決定（不要每次 user 變都重設使用者已切的 type，必要時加 `hasInitialized` ref）。

#### W1 驗收

- 三角色 prod 登入測 `/record-templates` 三 recordType 全 200
- 複製按鈕 label 隨 polished 狀態變化、警告色
- Polish 中可按「停止」立即中斷
- Patient 切換時 in-flight polish 不會寫到新 patient
- 藥師打開 patient detail 直接看到 SOAP editor
- Polish CTA 下方有 PHI 透明度提示

**估時：1 天。**

---

### Wave 2 — 串流完整性 + 藥師關鍵 bug（1.5–2 天）

> 為什麼不在 W3 之後：CLAUDE.md memory 標明藥師為主要使用者；`extractStreamedSoapValue` 每次 SOAP polish 都會踩；M-1 半截結果是病安級。

#### W2-T1：串流 timeout + 半截清理 (P0-6)

`ai.ts:638-720` 加 timeout 與失敗清空策略：

```ts
const TIMEOUT_MS = 90_000;
const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
try {
  const response = await fetch(url, { ..., signal: controller.signal });
  // ... existing stream
} catch (err) {
  // 清掉前端已塞的 partial polished
  throw new PolishStreamError({
    cause: err,
    partial: streamBuffer,  // 給呼叫端決定要不要保留
    reason: controller.signal.aborted ? 'aborted' : 'network',
  });
} finally {
  clearTimeout(timeoutId);
}
```

呼叫端（`medical-records.tsx:382` / pharmacist-soap-editor `:209`）catch 後決定：
- aborted → 靜默
- network/timeout → 清掉 polishedContent，toast「網路中斷，潤飾結果已捨棄」

#### W2-T2：藥師 SOAP 串流改 SSE event（取代 hand-rolled JSON parser）

後端 `streamPolishClinicalText` 已經走 SSE（`ai.ts:638-720` 有 `delta` / `done` / `error` event）。
新增 `section_delta`：

```python
# backend/app/services/clinical_polish.py (or wherever streams)
yield SSEEvent("section_delta", {"key": "p", "chunk": chunk_text})
```

前端：

```ts
case 'section_delta': {
  const { key, chunk } = JSON.parse(payload);
  onSectionDelta?.(key, chunk);
  break;
}
```

`pharmacist-soap-editor.tsx`：

```ts
const result = await streamPolishClinicalText(
  { /* ... */ },
  /* onDelta (legacy, ignored) */ () => {},
  /* signal */ controller.signal,
  /* onSectionDelta (new) */ (sectionKey, chunk) => {
    if (sectionKey !== key) return;
    setPolishedValue(key, prev => prev + chunk);
  },
);
```

`extractStreamedSoapValue` (74-97) 整段刪除，no more silent truncation on `\u` / chunk-boundary `\\"`.

最後 `done` 事件依然帶完整 `polished_sections`，作為 authoritative。

#### W2-T3：藥師 polished pane 串流期間 readonly + 提示

```tsx
<Textarea
  value={polished}
  onChange={(e) => setPolishedValue(key, e.target.value)}
  readOnly={st.polishing || st.refining}
  className={... + (st.polishing ? 'bg-slate-50' : '')}
/>
{(st.polishing || st.refining) && (
  <p className="text-[11px] text-slate-400">AI 寫入中，完成後即可編輯</p>
)}
```

避免 cursor jump（P1-4 部分）。手動編輯被覆蓋的問題在 W3 完整修。

#### W2-T4：IME composition guard (P1-10) — global utility

```ts
// src/lib/dom/key.ts (new)
export function isCmdEnter(e: React.KeyboardEvent) {
  if (e.key !== 'Enter') return false;
  if (!(e.metaKey || e.ctrlKey)) return false;
  // @ts-expect-error nativeEvent.isComposing exists on KeyboardEvent
  if (e.nativeEvent?.isComposing) return false;
  return true;
}
```

替換 `medical-records.tsx:891` 與 `pharmacist-soap-editor.tsx:452-457` 的判斷。

#### W2 驗收

- 拔網線測：polish 30s 後自動 timeout，polishedContent 清空，toast 顯示
- 中文輸入法 composing 中按 Enter 不會誤觸 refine
- 藥師 polish A 段有 `\u00X` / 嵌套引號 / chunk 切到 `\\` → 串流預覽完整無截斷
- 串流中 polished textarea 鎖唯讀有提示

**估時：1.5–2 天。**

---

### Wave 3 — 模板狀態機 + 「再修一次」mental model（1.5 天）

#### W3-T1：保留 polish 二輸入 contract，改 UI mental model (P1-1)

**不**改後端 `previousPolished` / `content` 二軌（會破壞 REFINEMENT mode 偵測）。
改 UI 讓使用者看清楚「再修一次」修的是哪一版：

```tsx
{refinementOpen && (
  <div className="space-y-2 border-t border-slate-200 p-3">
    <div className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
      將依右側目前內容再修：
      <span className="font-mono ml-1">{polishedContent.slice(0, 40)}…</span>
    </div>
    <Textarea ... />
  </div>
)}
```

`handleRefine` 維持現狀（`content: inputContent`、`previousPolished: polishedContent`），
但確認後端 `clinical_polish` REFINEMENT system prompt 把 `previous_polished` 視為主要修改對象、`content` 為 anchor（已是現狀，但加註解 / 寫測試 lock 行為）。

#### W3-T2：模板套用前確認（短稿不打擾）

```tsx
const handleApplyTemplate = (name: string) => {
  const tpl = allTemplates[name];
  if (tpl === undefined) return;

  const currentLen = inputContent.trim().length;
  const SHORT_DRAFT = 80;

  // 短稿（< 80 字）視為 scratch，直接套用 + 復原 chip
  if (currentLen > 0 && currentLen <= SHORT_DRAFT) {
    stashedDraftRef.current = inputContent;
    applyTemplateNow(name, tpl);
    setRecentlyApplied({ name, timestamp: Date.now() });  // 顯示持久 chip
    return;
  }

  // 長稿（> 80 字）才彈 modal
  if (currentLen > SHORT_DRAFT) {
    setPendingTemplate({ name, tpl });
    setConfirmOpen(true);
    return;
  }

  applyTemplateNow(name, tpl);
};
```

UI：套用後顯示持久 chip（不是 5s toast）：

```tsx
{recentlyApplied && (
  <div className="flex items-center gap-2 rounded bg-blue-50 px-2 py-1 text-xs">
    <span>已套用「{recentlyApplied.name}」</span>
    <button onClick={undoApply}>還原上一版</button>
  </div>
)}
// 使用者開始打字或套別的模板時清掉 chip
```

#### W3-T3：Polish state machine（最小化）

```ts
type PolishState =
  | { kind: 'idle' }
  | { kind: 'streaming'; controller: AbortController; sourceSnapshot: string; startedAt: number }
  | { kind: 'streamed'; sourceSnapshot: string }
  | { kind: 'error'; message: string };

// 衍生（不放進 union 避免不可能狀態）
const isStale = state.kind === 'streamed' && state.sourceSnapshot !== inputContent;
```

修 P1-2：`onChunk` 改用 `state.sourceSnapshot`（凍結時值）：

```ts
const sourceSnapshot = inputContent;  // 開 stream 之前 freeze
setState({ kind: 'streaming', controller, sourceSnapshot, startedAt: Date.now() });

await streamPolishClinicalText(
  { content: sourceSnapshot, ... },
  (chunk) => {
    streamed += chunk;
    updateDraft(recordType, { polished: streamed, polishedFrom: sourceSnapshot });
    //                                                          ^^^^^^^^^^^^^^^ 不再變動
  },
  controller.signal,
);
```

textarea **不鎖**（v1 提案的鎖會擋快手）；改加非阻斷 banner：

```tsx
{state.kind === 'streaming' && (
  <div className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
    潤飾基於 {Math.floor((Date.now() - state.startedAt) / 1000)}s 前的草稿；目前修改不影響此次結果
  </div>
)}
```

#### W3-T4：`selectedTemplate` / `selectedTemplateContent` 進 `DraftEntry` (P2-3, P2-5)

```ts
type DraftEntry = {
  input: string;
  polished: string;
  polishedFrom: string;
  soap: SoapDraft;
  polishedSoap: SoapDraft;
  selectedTemplateId: string | null;       // ← new
  selectedTemplateSnapshot: string | null;  // ← new (template content as applied)
  lastCopiedAt?: number;                    // ← renamed from submittedAt
};
```

`templateDirty` 改用 snapshot 比較，不再依賴「server template 現在是什麼」：

```ts
const templateDirty =
  !!currentDraft.selectedTemplateId &&
  currentDraft.selectedTemplateSnapshot !== null &&
  inputContent !== currentDraft.selectedTemplateSnapshot;
```

#### W3-T5：「另存為自訂模板」入口 (P2-4)

當 `selectedTemplate` 是 built-in 且 `templateDirty`：

```tsx
{selectedTemplateIsBuiltin && templateDirty && (
  <Button variant="outline" size="sm" onClick={openSaveAsCustom}>
    <Save className="mr-1.5 h-3.5 w-3.5" />
    另存為自訂模板…
  </Button>
)}
// 開啟時預填當前 inputContent 與「{原模板名} (自訂)」
```

#### W3-T6：`PHARMACIST_SOAP_TEMPLATE_NAME` 角色 gating (P1-14)

修在 `allTemplates` useMemo（**不要**動 `BUILTIN_TEMPLATES` const）：

```ts
const allTemplates = useMemo(() => {
  const merged: Record<string, TemplateContent> = { ...BUILTIN_TEMPLATES[recordType] };
  if (recordType === 'medication-advice' && user?.role !== 'pharmacist') {
    delete merged[PHARMACIST_SOAP_TEMPLATE_NAME];
  }
  for (const t of serverTemplates) merged[t.name] = t.content;
  return merged;
}, [recordType, serverTemplates, user?.role]);
```

順便修 P1-15：`flattenSoapTemplate` 在 single-section 時保留原 section header（看 user 對 plan-only template 的 expectations）—— alternative 是 reject 醫師看不到 SOAP template，問題自然消失。建議用 reject 路徑。

#### W3-T7：localStorage namespace + migration (P2-7)

```ts
const draftKey = (userId: string | null, patientId: string) =>
  userId ? `chaticu-draft-${userId}-${patientId}` : null;

function loadDrafts(userId: string | null, patientId: string): Drafts {
  if (!userId) return { ...EMPTY_DRAFTS };
  const key = draftKey(userId, patientId)!;
  const raw = localStorage.getItem(key);

  // One-shot migration: 舊 key 無 user 前綴
  const legacyKey = `chaticu-draft-${patientId}`;
  if (!raw) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      localStorage.setItem(key, legacy);
      localStorage.removeItem(legacyKey);
      return parse(legacy);
    }
  }
  // ... existing parse
}
```

`useEffect` 等 `user?.id` 之後才 mount drafts。

#### W3 驗收

- 套短稿（< 80 字）模板：直接套 + 持久復原 chip，無 modal
- 套長稿模板：跳 modal「覆蓋 / 附加 / 取消」
- Polish 中編草稿：banner 顯示「修改不影響此次結果」，post-stream 草稿已變動 badge 才亮
- 內建模板改完：出現「另存為自訂模板」入口
- 醫師打開 用藥建議：popover **不顯示** `藥師 SOAP`
- 共用工作站切換帳號：drafts 互不可見

**估時：1.5 天。**

---

### Wave 4 — 藥師 SOAP layout 重做 + 一致性收尾（2–2.5 天）

#### W4-T1：A / P 統一 polish 介面

不用 segmented toggle（多一次 click），改用「主按鈕 + 次按鈕」視覺層級：

- A 段：主 = `[只修文法]`（filled）；次 = `[套藥師格式]`（ghost）
- P 段：主 = `[套藥師格式]`（filled）；次 = `[只修文法]`（ghost）

兩段 surface 一致，只是預設動作不同（per `defaultMode`）。

#### W4-T2：Sticky compose pane（折疊式）

不要硬切兩欄（13" 螢幕等於砍半編輯區）。改成 sticky bottom bar：

```tsx
<div className="sticky bottom-0 z-10 border-t bg-white/95 backdrop-blur px-4 py-2">
  <div className="flex items-center justify-between">
    <span className="text-xs text-slate-500">
      Composed: {composed.length} 字 · A {polishStatus.a} · P {polishStatus.p}
    </span>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
        預覽 ↑
      </Button>
      <Button onClick={handleCopy} disabled={!composed} className="bg-brand">
        <Copy className="mr-2 h-4 w-4" /> 複製貼到 HIS
      </Button>
    </div>
  </div>
</div>

{composeOpen && <ComposedPreviewModal text={composed} onClose={() => setComposeOpen(false)} />}
```

iPad portrait（P2-13）也順便解決——sticky bar 永遠在底部可達。

#### W4-T3：「Polish A & P」一鍵

```tsx
<Button onClick={polishAandP}>潤飾 A + P（並行）</Button>

async function polishAandP() {
  await Promise.all([
    runPolish('a', 'grammar_only'),
    runPolish('p', 'full'),
  ]);
}
```

注意：兩 stream 並行需要兩個 AbortController；abort 鈕變「全部停止」。

#### W4-T4：Composed output stale 提示 (P1-8)

```tsx
const sectionStale = (key: SoapSection) =>
  polishedSoap[key].length > 0 && polishedSnapshot[key] !== soap[key];

// composed pane 上方
{(['a', 'p'] as const).filter(sectionStale).map(key => (
  <Badge key={key} variant="warning">{key.toUpperCase()} 段已編輯，潤飾結果可能過時</Badge>
))}
```

需要在 polish 完成時 snapshot `polishedSnapshot[key] = soap[key]`，比 polishedSoap 多一個 ref。

#### W4-T5：Insert Labs / Meds 升級 (P1-6, P1-7)

- Insert toolbar 改成 floating，跟著最後 focused 的可編輯段落（A、P 也能塞）
- 已有 lab block 用**前後文字串標記**（如 `=== Labs (24h, inserted 14:30) ===` 開頭、`=== /Labs ===` 結尾）—— 是純文字、可貼進 HIS、可被 regex 偵測
- 再次插入時 toast：「找到既有 Labs block，要替換還是新增一份？」
- Lab window 下拉旁加 chip：「下次插入會帶入 24h」

避免 v1 提案的 HTML comment sentinel（會被貼進 HIS）。

#### W4-T6：Tab 紅點正確邏輯 (P2-9)

```tsx
const draftDirty = (type: RecordType) => {
  const d = drafts[type];
  if (d.input.length > 0) return true;
  if (d.polished.length > 0 && d.polishedFrom !== d.input) return true;
  return false;
};
```

#### W4-T7：藥事工具去裝飾 (P1-13)

`pharmacist-soap-editor.tsx`：

- 移除 `Brain`（line 33 import + line 395 usage）
- 移除 `Sparkles`（line 33 + lines 417, 485 usages）
- 移除 `Wand2`（line 33 + line 427 usage）
- 移除 `Pill`（line 33 + line 406 usage）
- 保留 `FlaskConical`、`Syringe`（功能性，標示 paste source）
- 保留 `Copy`（標示 copy 動作）

`medical-records.tsx` 在 `recordType === 'medication-advice'` 分支也比照（不只 pharmacist 模式，所有角色進 用藥建議 都算藥事工具）。

#### W4-T8：小修零碎

- P2-1：模板按鈕 trigger 顯示 `模板：{selectedTemplate || '選擇'}`，移除下方重複 footer
- P2-2：右邊 CardDescription 改用 `config.polishLabel` 插值
- P2-6：主草稿 textarea 加 `isCmdEnter` handler 觸發 polish
- P2-8：rename `submittedAt` → `lastCopiedAt`、SOAP composed 顯示 last copied 時間（用 Asia/Taipei timezone per memory）
- P2-10：`saveDrafts` catch quota 錯誤時顯示 toast「儲存空間不足」+ 提供「清空所有病人草稿」按鈕
- P2-11：polished textarea 包 `<div role="status" aria-live="polite" aria-atomic="false">`
- P2-12：後端 `polish_clinical_text` system prompt 加「禁用 markdown 格式」；或 `handleCopy` 用 `text.replace(/\*\*/g, '').replace(/^- /gm, '')` strip 一次

#### W4 驗收

- 13" 螢幕藥師頁面 Copy 按鈕**不需要 scroll** 即可看到
- 並行 polish A+P 約等於單段時間（不是 2x）
- A/P 改 source 後 composed pane 上方 badge 警告
- 插入 Labs 兩次跳替換 / 新增 prompt
- 藥事工具相關頁面 0 裝飾 icon（可保留功能 icon 清單需 PR review confirm）
- 護理紀錄 tab 紅點：input=0 + polished 已複製的情況下不亮

**估時：2–2.5 天。**

---

## 四、完成定義（Definition of Done，每個 Wave）

每 Wave merge 前都必須：

1. **Local 三角色 smoke**（用 W1-T0 prod 帳號或 local seed）：草稿 → 套模板 → 潤飾 → 再修 → 複製，全部走完不報錯
2. **Prod 部署驗證**（依 CLAUDE.md）：
   - 後端改 → `git push personal main`；等 60–90s 後 `curl /health`、curl `/record-templates`
   - 前端改 → `git push railway main`；確認 `/assets/index-*.js` hash 變動
   - Playwright 重跑 W1 三角色 smoke
3. **Regression**：原本能跑的流程不能比改前更糟（W1 之後有 baseline）
4. **不新增 emoji**（CLAUDE.md feedback memory）；藥事工具去裝飾 icon 進度需確認
5. **Asia/Taipei** 顯示時間（lastCopiedAt 等）—— 不丟 raw UTC

---

## 五、不做的事（明確排除）

- **不**新增「儲存病歷紀錄到 DB」功能 — 使用者明確指定純粹潤飾貼上工具
- **不**改現有的 messages / 用藥建議推送（advice）pipeline
- **不**在 `src/` 新增 markdown（依 CLAUDE.md 目錄慣例）
- **不**動 Pharmacist SOAP 編輯器的核心規則：S/O 永遠不被 AI 動、A 預設 grammar_only、P 預設 full
- **不**做 polish history persistence（M-13 mitigation 後 quota / 跨患者污染都會修，不需要再加歷史）
- **不**做 template sharing / export（屬 admin-tool 範疇）

---

## 六、預估時程（v2 修正）

| Wave | 工作量 | 累計 |
|------|--------|------|
| W1 解鎖+病安 | 1d | 1d |
| W2 串流完整性+藥師關鍵 bug | 1.5–2d | 2.5–3d |
| W3 模板狀態機 | 1.5d | 4–4.5d |
| W4 藥師 layout + 收尾 | 2–2.5d | **6–7d** |

比 v1 估計（4.5d）多 **1.5–2.5 天**——主要因為新增 SSE 協議變更（W2-T2）、跨患者污染修法（W1-T5）、模板狀態機重構（W3-T3/T4）。可單人連續做完，或拆 4 個 PR 給多人分擔。

---

## 七、與 v1 的主要差異（給 reviewer 對照）

| 項目 | v1 | v2 |
|------|----|----|
| P0-1 範圍 | progress-note + nursing-record 都 500 | **只有** nurse + nursing-record 500；root cause 是 schema NULL constraint |
| P0-2 修法 | disable copy button | relabel + 警示色（保留護理師「貼空模板」工作流） |
| P0-3（v1） / P1-1（v2）handleRefine | drop `previousPolished`，用 polishedContent 當 content | **不**改 API，改 UI label + preview chip（v1 修法會打破後端 REFINEMENT mode 偵測） |
| W3-T2 textarea 鎖 | streaming 中 disable | streaming 中**不鎖**，改非阻斷 banner（避免擋快手） |
| P2-7 icon 清單 | Brain/Sparkles/Wand2/Pill/ArrowRight | 移除 Brain/Sparkles/Wand2/Pill；ArrowRight 不在藥師 editor，FlaskConical/Syringe/Copy 保留 |
| P2-9 submittedAt | 刪除 | rename `lastCopiedAt`，UI 顯示「last copied N min ago」 |
| P2-10 BUILTIN_TEMPLATES gating | 動 const | 在 `allTemplates` useMemo gate（const 不能動） |
| P2-11 tab 紅點 | `input \|\| polished` | `input \|\| (polished && polishedFrom !== input)`（避免永遠亮） |
| P2-8 localStorage namespace | 加 userId 前綴 | 加前綴 + 一次性 migration + null user 防護 |
| 新增 P0-6 串流 timeout / 半截清理 | — | M-1：拔網線 → 半截 polish 留在剪貼簿風險 |
| 新增 P0-7 跨病人污染 | — | M-4：in-flight polish chunk 寫進新患者 localStorage |
| 新增 P1-9 Auth race | — | M-2：第一次 render user=null，藥師看不到 SOAP editor |
| 新增 P1-10 IME composition | — | M-10：中文輸入法 commit candidate 誤觸 Cmd+Enter |
| 新增 P1-11 Session 過期 | — | M-12：mid-stream 401 沒人 surface |
| 新增 P1-12 Quota | — | M-13：in-memory drift 後重整丟資料 |
| 新增 P1-15 Plan-only template 醫師看到 | — | 配 P2-10 / M-9：silent collapse 沒有 header |
| 新增 P2-11 a11y | — | aria-live |
| 新增 P2-12 markdown 過濾 | — | HIS textarea 不 render `**bold**` |
| 新增 P2-13 iPad portrait | — | 床邊使用情境 |
| Wave 順序 | 後端 → handleRefine → state 機 → 藥師 SOAP → 收尾 | 後端+病安 → **藥師串流先**（主要使用者）→ 模板狀態機 → 藥師 layout + 收尾 |
| Wave 數 | 5 | 4（W2 太小併入 W1） |
| 時程 | 4–5d | **6–7d** |
| Test users | doctor/doctor 等 | 列出 prod 真實帳號 usr_330f80 / usr_d8cbe8 / usr_1d14a8 |
