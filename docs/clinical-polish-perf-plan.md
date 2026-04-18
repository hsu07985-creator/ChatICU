# Clinical Polish 效能優化計畫

日期: 2026-04-18
範圍: `/api/v1/clinical/polish` endpoint（藥師 SOAP / medical-records 用藥建議的 AI 修飾按鈕）
目標: 將「套藥師格式 / 只修文法 / 再修一次」按鈕的體感延遲從 15–23 秒降到 <3 秒（或至少有 streaming 讓第一個字 <1 秒出現）

---

## 實測基線（2026-04-18, Vercel→Railway production）

| 指標 | 實測值 | 備註 |
|------|--------|------|
| `/health` 延遲 | ~600ms | Vercel proxy → Railway 基線，**排除冷啟動** |
| `/clinical/polish` 422 validation | 1.6s | 純 validation error 就有 1s overhead |
| `/clinical/polish` 200 成功（藥師 P 段） | **15–23 秒** | 全部是 TTFB（後端處理 + LLM） |
| Response body 大小 | 1.3KB | 下載時間可忽略 |

**瓶頸 100% 在後端**，非前端、非網路、非冷啟動。

---

## 五項優化（依 CP 值排序）

### P1 — 改 Streaming（體感改善最大）

**現況**
- `backend/app/llm.py:534-577` 的 `call_llm()` 是 non-streaming，等整段輸出回來才回 response
- `backend/app/routers/clinical.py:623-627` 用 `asyncio.to_thread(call_llm)` 封裝
- 前端 `src/lib/api/ai.ts:663` 用 axios POST，一次等完

**提案**
- 後端新增 `call_llm_stream()` 或改造現有 endpoint 支援 `Accept: text/event-stream`
- 使用 FastAPI `StreamingResponse` 回傳 SSE
- 前端改用 `fetch` + `ReadableStream`，逐段更新 `polishedSoap[key]`
- guardrail 在 stream 結束後才跑，UI 顯示「正在檢查安全性」提示

**預期**
- TTFB 從 15s → <1s（第一個 token）
- 總時間不變，但使用者感知大幅改善
- 用戶可以邊讀邊等

**風險**
- guardrail 目前在完整 response 後才檢查，streaming 下需決定「stream 途中發現違規」的處理策略
- 前端 SoapEditor 需處理「逐字追加」的 state 更新
- axios 不支援 streaming body，要改用原生 fetch

**檔案清單**
- `backend/app/llm.py`（新增 stream 函數）
- `backend/app/routers/clinical.py:569-697`（endpoint 改 StreamingResponse）
- `src/lib/api/ai.ts:617-667`（前端改 fetch + reader）
- `src/components/pharmacist-soap-editor.tsx:161-203`（runPolish 接收 stream chunks）
- `src/components/medical-records.tsx:362-426`（非 pharmacist mode 的 polish/refine 也要支援）

---

### P2 — 關掉 grammar_only 模式的 reasoning

**現況**
- `backend/app/routers/clinical.py:587-621` 根據 `polish_mode` 切 prompt
- 但所有模式都走同一條 LLM 呼叫路徑，**reasoning 未關**
- `grammar_only` 只需改錯字文法，根本不需要深度推理
- `gpt-5.4-mini` reasoning token 估計佔 3–5 秒

**提案**
- 在 `call_llm()` 加參數 `disable_reasoning: bool = False`
- `clinical.py` 判斷 `polish_mode == 'grammar_only'` 時傳入 `True`
- OpenAI API 對應參數：設低 `reasoning_effort` 或直接切 `gpt-4o-mini`

**預期**
- grammar_only 呼叫省 3–5 秒
- full / refinement 模式不受影響

**檔案清單**
- `backend/app/llm.py:534-577, 785-828`（call_llm + _call_openai）
- `backend/app/routers/clinical.py:587-621`

---

### P3 — 啟用 Prompt Caching（ephemeral）

**現況**
- `backend/app/llm.py:233-373` 的 pharmacist_polish system prompt 長 6,957 字元
- 每次呼叫都重新計算 token（無 cache）
- 近期 commit `c5b709b` 已加 cache hit ratio log，顯示目前 hit rate = 0

**提案**
- 在 `_call_openai` system message 加 `cache_control: {"type": "ephemeral"}`（Anthropic）或 OpenAI 對應機制
- 把「system prompt」和「patient context 前綴」設為可 cache 段落
- 只有「使用者輸入（S/O/A/P 草稿）」是每次不同

**預期**
- 相同 prompt 重複呼叫時省 20–30% latency
- 藥師在同一病患連續 polish 多次時效果最明顯
- token 成本也會降

**風險**
- Prompt 順序與內容需調整：穩定段在前、變動段在後
- cache 命中率受同一病患呼叫頻率影響

**檔案清單**
- `backend/app/llm.py:785-828`（_call_openai）
- `backend/app/llm.py:233-373`（重新排序 prompt 段落）

---

### P4 — Guardrail 並行化

**現況**
- `backend/app/routers/clinical.py:651` 的 `_guardrail_sections` 對 pharmacist_polish 的 S/O/A/P **4 段逐一檢查**
- 每段都是一次 LLM 呼叫
- 4 段序列執行 = 4 倍延遲

**提案**
- 改用 `asyncio.gather(*[guardrail_one(s) for s in sections])` 並行跑 4 段
- 若某段 return violation，其他段仍完成但最後聚合決定是否阻擋

**預期**
- guardrail 階段從 ~3 秒降到 ~1 秒
- 省 2 秒

**風險**
- DB session 在 gather 內要注意是否共用（目前 guardrail 應該只打 LLM 不打 DB）
- 錯誤處理：一段失敗不應讓其他段都 rollback

**檔案清單**
- `backend/app/routers/clinical.py:638, 651`（apply_safety_guardrail + _guardrail_sections）

---

### P5 — 裁剪 patient context

**現況**
- `backend/app/routers/clinical.py:577` 用 selectinload 抓 patient + labs + vital_signs + medications + ventilator_settings
- 整包塞進 prompt（pharmacist_polish）
- 藥師 SOAP 模式中，S/O 是逐字保留、AI 不動，**完全不需要 patient context**
- 只有 A（assessment）和 P（plan）階段需要

**提案**
- 根據 `target_section` 決定載入哪些欄位：
  - `target_section == 's'` 或 `'o'`: patient context 可完全省略
  - `target_section == 'a'` 或 `'p'`: 載入必要的 labs + meds，省掉 ventilator / vital signs（除非藥師明確需要）
- 前端 SOAP editor 已有「插入 Labs / 插入用藥」按鈕讓藥師主動選擇，後端不需重複帶

**預期**
- prompt token 數可降 30–50%
- LLM latency 省 1–3 秒
- cache 命中率更高（短 prompt 更穩定）

**風險**
- AI 品質：若裁過頭，修飾結果可能少參考關鍵數據
- 需跑 eval 驗證（`backend/tests/evals/`）

**檔案清單**
- `backend/app/routers/clinical.py:260-331, 569-697`（_get_patient_dict + polish endpoint）
- `backend/app/llm.py:233-373`（pharmacist_polish prompt 的 context 組裝）
- `backend/tests/evals/`（新增 regression 案例）

---

## 建議執行順序

| 順序 | 項目 | 改善幅度 | 風險 | 實作時間估計 |
|------|------|---------|------|-------------|
| 1 | **P1 Streaming** | 體感 15s → <1s | 中 | 1 天 |
| 2 | **P2 Grammar_only 關 reasoning** | 3–5 秒 | 低 | 2 小時 |
| 3 | **P3 Prompt Caching** | 20–30% | 低 | 4 小時 |
| 4 | **P4 Guardrail 並行** | 2 秒 | 低 | 2 小時 |
| 5 | **P5 裁 patient context** | 1–3 秒 + token | 中（需 eval） | 1 天 |

---

## 驗收指標

每項完成後用 Playwright 或 `curl` 重跑相同 probe，記錄到本文件的驗收表：

| 項目 | 完成日期 | probe 測得 TTFB | 首 token 時間 | Commit / 備註 |
|------|---------|----------------|--------------|--------|
| 基線 | 2026-04-18 | 15–23s | N/A | — |
| P1 | 2026-04-18 | 待部署驗證 | 待部署驗證 | 已實作：新增 `POST /api/v1/clinical/polish/stream` (SSE, `StreamingResponse`)；前端新 `streamPolishClinicalText()` + pharmacist editor 增量顯示目標段。原 `/polish` 保留相容。 |
| P2 | 2026-04-18 | 待部署驗證 | N/A（未 streaming） | 已實作：`llm.py` 加 `disable_reasoning`；`clinical.py` grammar_only 時傳入 True |
| P3 | 2026-04-18 | 待部署驗證 | N/A | 已實作：`_call_openai` / `_call_openai_multi` 加 cached_tokens 日誌（`[LLM][CACHE]`）。OpenAI 自動快取，因 pharmacist prompt 2319 tokens ≥ 1024 閾值。 |
| P4 | 2026-04-18 | 取消 | — | **錯誤目標**：`apply_safety_guardrail` 是純 regex（非 LLM），4 段序列執行為微秒級，並行化無效益。 |
| P5 | 2026-04-18 | 待部署驗證 | — | 已實作：pharmacist_polish 時，`vital_signs` / `ventilator_settings` 一律剔除；target_section ∈ {s,o} 進一步剔除 `lab_data` / `medications` / `symptoms`。`_trim_patient_for_pharmacist` in `clinical.py`。 |

Probe 指令（從瀏覽器 DevTools Console 或 Playwright 跑）:

```js
const body = {
  patient_id: 'pat_e3846ac7',
  content: '',
  polish_type: 'medication_advice',
  task: 'pharmacist_polish',
  polish_mode: 'full',
  soap_sections: {
    s: '', o: '', a: 'ARF, Cr 1.8 from 0.9 in 2 days',
    p: '1.Please consider D/C aspirin\n2.Continue to monitor renal function'
  },
  target_section: 'p',
};
const t0 = performance.now();
const res = await fetch('/api/v1/clinical/polish', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-request-id': `probe-${Date.now()}` },
  body: JSON.stringify(body),
  credentials: 'include',
});
const text = await res.text();
console.log('ttfb_ms:', Math.round(performance.now() - t0));
```

---

## 不做的事（刻意排除）

- **不升級到更大模型**：gpt-5.4-mini 已經夠用，升級只會更慢更貴
- **不新增平行度（multiple LLM providers fallback）**：徒增複雜度，還沒必要
- **不動 Railway plan**：已排除冷啟動，不是資源問題
- **不改 Vercel proxy 配置**：proxy 只佔 0.6s 基線，無明顯優化空間

---

## 相關檔案索引

| 層 | 檔案 | 關鍵行 |
|----|------|--------|
| 後端 endpoint | `backend/app/routers/clinical.py` | 569–697 (polish), 260–331 (patient fetch), 587–621 (mode switch), 638/651 (guardrail) |
| 後端 LLM | `backend/app/llm.py` | 534–577 (call_llm), 785–828 (_call_openai), 233–373 (pharmacist prompt) |
| 後端 audit | `backend/app/middleware/audit.py` | 35–62 |
| 前端 API | `src/lib/api/ai.ts` | 617–667 (polishClinicalText) |
| 前端 UI | `src/components/pharmacist-soap-editor.tsx` | 161–203 (runPolish) |
| 前端 UI | `src/components/medical-records.tsx` | 362–426 (handlePolish / handleRefine) |
