# 病歷紀錄修改進度

> 對應 `docs/medical-records-ux-fixes-v2.md`。每完成一個 T，更新此檔。
> 圖示：☐ 未開始　⏳ 進行中　✅ 完成　⏸ 阻塞　❌ 放棄

**最後更新**：2026-05-02

---

## Wave 1 — 解鎖 + 病安（目標 1 天）

| Task | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|------|---------|------|------|
| W1-T1 | 後端 schema `createdById` 改 Optional + 前端錯誤透明化 | `backend/app/schemas/record_template.py`、`src/components/medical-records.tsx:317` | ① pytest record_templates 全綠 ② 三 recordType 在 nurse 身分都 200 | ✅ |
| W1-T2 | 複製按鈕 relabel + 警示色（不 disable） | `src/components/medical-records.tsx:856-863` | UI 視覺：未潤飾時顯示「複製草稿到 HIS（未潤飾）」黃色 | ✅ |
| W1-T3 | PHI 透明度提示文字 | `src/components/medical-records.tsx`（polish 按鈕下方） | UI 視覺：潤飾按鈕下方有 PHI 提示 | ✅ |
| W1-T4 | Abort 按鈕（簡單版） | `src/components/medical-records.tsx`、`src/components/pharmacist-soap-editor.tsx` | 手動：按潤飾後 5s 內按停止可中斷 | ✅ |
| W1-T5 | 跨病人污染修復 + Auth race | `src/components/medical-records.tsx:241-258` | 手動：切病人時 in-flight polish 中斷；藥師打開 patient page 直接看到 SOAP editor | ✅ |

**Wave 1 整體驗收**：
```bash
# 後端
cd backend && python3 -m pytest tests/test_api/test_record_templates.py -v --tb=short
# 前端 (本地 dev)
npm run dev  # 開瀏覽器手動跑三角色 smoke
# Prod (push 後)
for rt in progress-note medication-advice nursing-record; do
  curl -s -b cookies.txt "https://chaticu-production-8060.up.railway.app/record-templates?recordType=$rt" | jq '.success'
done
```

---

## Wave 2 — 串流完整性 + 藥師關鍵 bug（目標 1.5–2 天）

| Task | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|------|---------|------|------|
| W2-T1 | 串流加 timeout（90s）+ 半截清理 | `src/lib/api/ai.ts:638-720`、各 catch 點 | 手動：拔網線後 polish content 自動清空 | ✅ |
| W2-T2 | 藥師 SOAP 串流改用 `section_delta` SSE event | `backend/app/routers/clinical.py`、`src/lib/api/ai.ts`、`src/components/pharmacist-soap-editor.tsx:74-97` | 手動：A/P 串流預覽完整無截斷；單元測試覆蓋特殊字元 | ✅ |
| W2-T3 | 藥師 polished pane 串流期間 readonly + 提示 | `src/components/pharmacist-soap-editor.tsx:431-436` | 手動：串流中 polished textarea 灰底唯讀 | ✅ |
| W2-T4 | IME composition guard utility + 套用 | `src/lib/dom/key.ts`(新)、`medical-records.tsx:891`、`pharmacist-soap-editor.tsx:452` | 手動：中文輸入法 composing 中按 Enter 不誤觸 | ✅ |

---

## Wave 3 — 模板狀態機 + 「再修一次」mental model（目標 1.5 天）

| Task | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|------|---------|------|------|
| W3-T1 | 「再修一次」UI 預覽 chip（保留 API contract） | `src/components/medical-records.tsx:882-913` | UI 視覺：refine panel 上方顯示「將依右側目前內容再修：…」 | ✅ |
| W3-T2 | 模板套用前確認（短稿直接套+持久復原 chip；長稿跳 modal） | `src/components/medical-records.tsx:334-362` | 手動：80 字以下無 modal 但有 chip；80 字以上跳 modal | ✅ |
| W3-T3 | Polish state machine（snapshot 凍結 + banner 不鎖 textarea） | `src/components/medical-records.tsx`（多處） | 手動：polish 中改草稿 banner 顯示「修改不影響此次結果」；post-stream 徽章正確 | ✅ |
| W3-T4 | `selectedTemplateId` / `selectedTemplateSnapshot` 進 DraftEntry | `src/components/medical-records.tsx:168-192` | 手動：切 record-type 再切回，模板狀態保留 | ✅ |
| W3-T5 | 「另存為自訂模板」入口 | `src/components/medical-records.tsx`（template popover 區） | UI 視覺：改完內建模板看到「另存為自訂模板」按鈕 | ✅ |
| W3-T6 | `PHARMACIST_SOAP_TEMPLATE_NAME` 角色 gating（在 useMemo） | `src/components/medical-records.tsx:326-330` | 手動：醫師打開 用藥建議 popover 看不到「藥師 SOAP」 | ✅ |
| W3-T7 | localStorage namespace + migration | `src/components/medical-records.tsx:193,206-227` | 手動：兩個 user 在同一 browser 切換，drafts 不互看 | ⏳ |

---

## Wave 4 — 藥師 SOAP layout + 一致性收尾（目標 2–2.5 天）

| Task | 內容 | 觸碰檔案 | 驗證 | 狀態 |
|------|------|---------|------|------|
| W4-T1 | A / P polish 介面統一視覺層級 | `pharmacist-soap-editor.tsx:387-411` | UI 視覺：A 主按鈕「只修文法」；P 主按鈕「套藥師格式」 | ✅（W2 移除 emoji 後現狀已是 filled-vs-ghost；無需再改） |
| W4-T2 | Sticky bottom bar（複製按鈕永遠可見） | `pharmacist-soap-editor.tsx:500-528` | 手動 13"+iPad portrait：無 scroll 即可看到複製 | ✅ |
| W4-T3 | 「Polish A + P（並行）」一鍵 | `pharmacist-soap-editor.tsx` | 手動：兩段並行跑 ≈ 單段時間 | ✅ |
| W4-T4 | Composed output stale 警告 badge | `pharmacist-soap-editor.tsx:253-261` | 手動：潤飾完 P → 改 P 源 → composed 上方出現警告 badge | ✅ |
| W4-T5 | Insert Labs/Meds 升級（floating + dedup + chip） | `pharmacist-soap-editor.tsx:141-185, 321-366` | 手動：A/P 段也能塞 Labs；雙擊跳替換 prompt | ✅ |
| W4-T6 | Tab 紅點正確邏輯 | `medical-records.tsx:554,575` | 手動：input=0 + polished 已複製 → 紅點不亮 | ✅ |
| W4-T7 | 藥事工具去裝飾 icon | `pharmacist-soap-editor.tsx:33`、`medical-records.tsx`（用藥建議分支） | 視覺：藥事工具頁 0 裝飾 icon；保留 FlaskConical/Syringe/Copy | ✅ |
| W4-T8 | 小修零碎（P2-1/2/6/8/10/11/12） | 多處 | 各自手動驗證 | ✅ |

---

## 部署協議（依 CLAUDE.md）

每個 Wave 完成後：
1. 後端改 → `git push personal main`，等 60–90s `curl /health`
2. 前端改 → `git push railway main`，確認 `/assets/index-*.js` hash 變動
3. Prod smoke 用真實帳號（usr_330f80 admin / usr_d8cbe8 doctor / usr_1d14a8 pharmacist）

**注意 backend/CLAUDE.md 的 backend session 規則**：本次是單一 session 跨前後端，
不走 `docs/coordination/` 流程；W1-T1 後端改完會在此檔註記，不另起 backend-tasks.md item。

---

## 變更記錄

- 2026-05-02：建立進度文件，準備啟動 W1
- 2026-05-02：W1-T1 ✅ — `record_template.py:41-42` 的 `createdById/Name` 改 `Optional[str] = None`；前端 `medical-records.tsx:317` catch 加 `toast.error` + `console.error`。後端 8/8 pytest 通過。
- 2026-05-02：W1-T2 ✅ — `handleCopy` 區分潤飾/未潤飾路徑，toast 文字不同；按鈕 label 與顏色根據 `polishedContent.trim().length > 0` 切換（未潤飾 = 黃色警告色）。tsc 無錯。
- 2026-05-02：W1-T3 ✅ — Polish 按鈕下方加一行小字提示 AI 會帶入病人用藥/檢驗摘要。tsc 無錯。
- 2026-05-02：W1-T4 ✅ — Polish/refine 都加 AbortController，按鈕在串流中變「停止」（黃色 outline）；藥師 SOAP 每段獨立 abort。`streamPolishClinicalText` 第三參數 signal 開始有人傳了。tsc 無錯。
- 2026-05-02：W1-T5 ✅ — `setHydratedPatient` 改 `useEffect`，並在 patientId 變動時 abort 任何 in-flight polish/refine（修 P0-7 跨病人污染）；`getDefaultRecordType` 改用 `useEffect` + `userRoleInitializedRef`，等 `user.role` hydrate 後才設定預設 tab，且只設定一次（不會覆蓋使用者手動切換）。tsc + npm build 全綠。
- **W1 全部完成。** 4 個 PR 中的第 1 個準備好可以 commit + push。
- 2026-05-02：W1 已 commit 並 push 到 personal+railway，merge 進 main（commit 20403b559）；Railway healthy、Vercel build 161s 完成。Playwright 用 nurse 帳號 B4372 登入 prod 驗證：(1) 自動 land 在 護理記錄 tab → Auth race fix 生效 ✅；(2) 模板 popover 顯示「內建 4 + 自訂 4」(原本 500 時自訂為 0) → schema fix 生效 ✅。**W1 真實 prod 穩定。**
- 2026-05-02：W2-T1 ✅ — `ai.ts` 新增 `PolishStreamError` typed error + 90s timeout；`streamPolishClinicalText` 永遠丟 `PolishStreamError`，failure reason 分 `aborted/timeout/network/protocol`。`medical-records.tsx` 與 `pharmacist-soap-editor.tsx` 的 catch 改成依 reason 處理：非 abort 一律清空半截 polish 內容（防止複製到截斷句子進 HIS）。tsc 無錯。
- 2026-05-02：W2-T4 ✅ — 新檔 `src/lib/dom/key.ts` 提供 `isCmdEnter()` helper（檢查 `nativeEvent.isComposing` + `keyCode === 229`）；medical-records 主草稿 + refine textarea、pharmacist-soap-editor refine textarea 全部換掉手刻判斷。順手把 P2-6（主草稿 Cmd+Enter 觸發 polish）一起做了。
- 2026-05-02：W2-T3 ✅ — 藥師 SOAP polished pane 在 `polishing||refining` 期間 `readOnly` + 灰底，title 改顯示「AI 寫入中…完成後即可編輯」，避免 cursor jump 與手動編輯被串流覆寫。
- 2026-05-02：W2-T2 ✅ — 後端 `routers/clinical.py` 新增 `_extract_json_string_value`（含 `\uXXXX` 與部分回退；9/9 單元 case 通過）；polish/stream route 對 pharmacist target_section 額外 emit `section_delta` event（非藥師流程不變）。前端 `ai.ts` 加 `onSectionDelta` 第四參數；`pharmacist-soap-editor.tsx` 移除 hand-rolled `extractStreamedSoapValue`，改聽 `section_delta` 並 append 已解碼 chunks。後端 305/305 pytest + 前端 build clean。
- **W2 全部完成。** 4 個 PR 中的第 2 個準備好可以 commit + push。
- 2026-05-02：W2 已 commit (4406538c9) 並 push 到 personal+railway。Vercel build + Railway deploy 完成。Playwright 用 nurse 帳號實測 護理記錄 polish flow：(1) 草稿 textarea 下方 PHI 提示顯示 ✅ (2) 複製按鈕未 polish 時 label 為「複製未潤飾草稿到 HIS」✅ (3) 點 AI 檢查 → 中途看到「停止 AI 修飾」按鈕、polished 端串流 94 字 ✅ (4) 完成後按鈕恢復 AI 檢查、停止鈕消失、複製按鈕自動切換為「複製潤飾結果到 HIS」、polish 結果 144 字完整收尾 ✅。**W2 真實 prod 穩定。**
- 2026-05-02：W2-T2 用藥師帳號 A3266 補測 SOAP `section_delta` SSE 路徑（陳佩君 / pharmacist）：(1) 預設 land 在 用藥建議、SOAP S/O/A/P 4 段全在 ✅ (2) P 段填中英混雜+特殊字元 195 字後按 套藥師格式 → 串流期間 polished textarea readOnly + 「AI 寫入中…完成後即可編輯」card title ✅ (3) 串流結束 polished 315 字、4 條完整 bullet、**無 JSON 語法殘留**、**無破壞 `\u00` escape**（前舊版 hand-rolled scanner 對 unicode escape 會留 `u4e2d` 字面值）✅ (4) 串流結束 card title 恢復「AI 修飾結果（可直接修改）」、readOnly 解除、停止鈕消失 ✅。**W2-T2 真實 prod 通過。**
- 2026-05-02：W3-T6 ✅ — `allTemplates` useMemo 加 `if (recordType === 'medication-advice' && user?.role !== 'pharmacist') delete merged[PHARMACIST_SOAP_TEMPLATE_NAME]`。醫師/護理師打開 用藥建議 popover 不再看到「藥師 SOAP」。
- 2026-05-02：W3-T7 ✅ — `draftKey` 改為 `chaticu-draft-${userId}-${patientId}`；`loadDrafts` 第一次抓不到時 fallback 讀 legacy `chaticu-draft-${patientId}` 並搬移到新 key（一次性 migration）；user 未 hydrate 時不持久化。`saveDrafts` 對 quota 錯誤改 toast (id-deduped) 不再靜默吞。useEffect deps 加 `user?.id` 確保跨帳號切換重新載入。
- 2026-05-02：W3-T3 ✅ — `handlePolishContent` + `handleRefine` 開始時都 `const sourceSnapshot = inputContent` freeze，串流 callback 全用 snapshot 寫 `polishedFrom`，修「草稿已變動」徽章被串流期間打字打到謊（P1-2 根因）。textarea **不鎖**（避免擋快手），改加非阻斷 banner「AI 正在處理本次草稿；目前在草稿上的編輯不會影響此次結果。」
- 2026-05-02：W3-T4 ✅ — `DraftEntry` 加 `selectedTemplate` + `selectedTemplateSnapshot` + rename `submittedAt` → `lastCopiedAt`。Component-level `useState selectedTemplate` 移除，所有讀寫透過 currentDraft + updateDraft（持久化跨 record-type）。`templateDirty` 改用 snapshot 比較（不再受 server template 變動影響）。
- 2026-05-02：W3-T5 ✅ — 模板 popover 內加 `canSaveBuiltinAsCustom` gating 的「另存為自訂模板」按鈕，按下時預填 `selectedTemplate (自訂)` 名稱與當前 inputContent 到新增表單。內建模板首次有自訂入口。
- 2026-05-02：W3-T2 ✅ — `handleApplyTemplate` 重構為短稿（< 80 字、empty draft、re-apply 同模板）直接套；長稿跳 Dialog（覆蓋 / 附加到後面 / 取消）。`stashedDraftRef` 在套用時 snapshot 前一版，渲染期間若 `inputContent === selectedTemplateSnapshot && stashedDraftRef.current` 顯示「已套用 XXX [還原上一版]」chip；使用者開始打字後 chip 自然消失。
- 2026-05-02：W3-T1 ✅ — Refine panel 上方加 chip「將依右側目前內容再修：{polished 前 50 字}…」，把後端 2-input contract（`content` = 原稿、`previousPolished` = 看到的潤飾結果）翻譯成使用者看得懂的心智模型。
- **W3 全部完成。** 4 個 PR 中的第 3 個準備好可以 commit + push。
- 2026-05-02：W3 已 commit (129d2f695) 並 push 到 railway（純前端，不推 personal）。Vercel build 完成。Playwright 用 nurse 帳號 B4372 驗 W3-T6 → **發現 bug**：popover 直接讀 `BUILTIN_TEMPLATES`，我只 gate 了 `allTemplates`（apply lookup 用），nurse 還是看得到「藥師 SOAP」。
- 2026-05-02：W3-T6 hotfix — 新增 `visibleBuiltins` useMemo（gate `PHARMACIST_SOAP_TEMPLATE_NAME`），popover render + `allTemplates` 都改讀 `visibleBuiltins`。tsc + build clean。Hotfix commit b466cd9a2 已 push railway。
- 2026-05-02：W4 全部完成。
  - **W4-T6** Tab 紅點邏輯：新 `draftDirty` 含 `inputLike`（藥師 medication-advice 改算 SOAP 4 段）+ `polishedHasUnfinishedWork` 條件，只在 input 有東西或 polished 與 polishedFrom 不一致時亮（不會永遠亮）。
  - **W4-T7 + P2-1** 藥事工具去裝飾：`pharmacist-soap-editor.tsx` 移除 Brain/Sparkles/Wand2/Pill 4 個裝飾 icon import；`medical-records.tsx` 加 `showDecorativeIcons = recordType !== 'medication-advice'` 條件 gating Brain/Sparkles/Wand2/ArrowRight；模板按鈕 trigger 改顯示「模板：選中名稱」（替代原來只在小 Badge 顯示）。
  - **W4-T8 + P2-2/8/11/12** 小修：右邊 CardDescription 改用 `config.polishLabel` 與「複製潤飾結果到 HIS」一致；`handleCopy` 加 markdown strip（`**bold**` / `__bold__`）；複製成功時設 `lastCopiedAt`，下方顯示「N 分鐘前複製」（Asia/Taipei）；polished 區包 `role="status" aria-live="polite"` for screen reader。
  - **W4-T4** 藥師 SOAP composed pane 上方依 `polishedFromSoap[k] !== soap[k]` 顯示「X 段已編輯，潤飾結果可能過時」橘色 badge（A 與 P 各自獨立）。
  - **W4-T2** 藥師 SOAP 加 sticky bottom bar（`-mx-4` 全寬 + `bottom-0` + backdrop blur），永遠看得到字數、A/P polish 狀態、「潤飾 A + P」、「複製貼到 HIS」。
  - **W4-T3** 加 `polishAandPParallel` 用 `Promise.allSettled`，A 與 P 同時跑（每段已有獨立 abort controller，不衝突）；只在兩段都空時 toast 拒絕。
  - **W4-T5** Insert toolbar 改 floating（grid 之前），加 `lastFocusedSection` state + 每段 textarea `onFocus` handler；toolbar label 顯示「一鍵帶入到 X 段：」。`insertWithDedup` 用 `=== Labs (HH:MM) ===` 純文字 sentinel 包覆插入內容，再次插入時 `window.confirm` 詢問替換或追加。
  - tsc + npm build 全綠。**W4 全部完成。** 4 個 PR 中的第 4 個（最後一個）準備好可以 commit + push。

- 2026-05-02：W3 hotfix + W3 整體 prod 驗證（用 nurse 帳號 B4372，bundle hash `DqSLPQdt`）：
  - **W3-T6** 用藥建議 popover 顯示「劑量調整建議、新增藥品建議」**無「藥師 SOAP」** ✅
  - **W3-T2** 在 Progress Note 草稿打 154 字 → 點 SOAP 格式 → Dialog 跳出（取消 / 附加到草稿後面 / 覆蓋目前草稿）✅；點「附加」結果 229 字（154 原 + `\n\n` + 75 SOAP scaffold）✅；換成 簡要紀錄 + 點「覆蓋」→ input 變成「主訴: / 目前狀況: / 處置計畫:」 ✅
  - **W3-T2 復原 chip** 「已套用「簡要紀錄」 還原上一版」chip 出現 ✅，按下 chip 後 input 還原為 101 字原稿 ✅
  - W3-T1/T3/T4/T5 由 tsc + 行為間接驗證（refine chip、polish snapshot freeze、selectedTemplate 持久化、另存為自訂模板入口都已部署）
  - **W3 真實 prod 穩定。**
