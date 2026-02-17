# ChatICU AI 修正任務追蹤

> **建立日期：** 2026-02-15
> **來源文件：** `AI_AUDIT_REPORT.md`
> **基線：** 98/98 tests passed（85 unit + 13 E2E）

---

## 修改規則

1. 每次開工前先讀此檔確認狀態
2. 完成一項就打 `[x]` 並記錄日期
3. 每個任務完成後跑 `cd backend && python3 -m pytest tests/ -v --tb=short` 確認不破壞
4. P0 全部完成才能做 P1，P1 全部完成才能做 P2

---

## P0 — 立即修復（病患安全）

> **目標：** 消除所有可能誤導臨床判斷的問題
> **預估：** 2-3 小時

- [x] **P0-1** 修復「更新患者數值」按鈕（改為實際刷新） ✅ 2026-02-15
  - 檔案：`src/pages/patient-detail.tsx:736`
  - 做法：點擊後重新載入病患 bundle（patient / labs / vitals / meds / vent / weaning + sessions）
  - 成功提示：toast「已更新患者數值」；失敗提示：toast「更新患者數值失敗…」

- [x] **P0-2** 所有 TASK_PROMPTS 加入繁體中文語言指令 ✅ 2026-02-15
  - 檔案：`backend/app/llm.py` — 6 個 prompt 全部加入 `_LANG_DIRECTIVE`
  - 同時補齊 clinical_polish 的 SOAP 四段（S/O/A/P）— 原先只有 A+P

- [x] **P0-3** `/clinical/summary` 加安全護欄 ✅ 2026-02-15
  - 檔案：`backend/app/routers/clinical.py` — `clinical_summary()`
  - 做法：`apply_safety_guardrail(raw_summary)` + 回傳 `safetyWarnings`

- [x] **P0-4** `/clinical/explanation` 加安全護欄 ✅ 2026-02-15
  - 檔案：`backend/app/routers/clinical.py` — `patient_explanation()`
  - 做法：`apply_safety_guardrail(raw_explanation)` + 回傳 `safetyWarnings`

- [x] **P0-5** `str(input_data)` → `json.dumps()` ✅ 2026-02-15
  - 檔案：`backend/app/llm.py:93` 和 `llm.py:160`
  - 做法：`json.dumps(input_data, ensure_ascii=False, default=str)`

---

## P1 — 短期改善（UX 品質）

> **目標：** AI 輸出可正確渲染、重要資訊可見
> **預估：** 4-6 小時
> **前置：** P0 全部完成

- [x] **P1-1** 前端引入 Markdown 渲染取代 `<pre>` ✅ 2026-02-15
  - 安裝 `react-markdown`，建立 `AiMarkdown` + `SafetyWarnings` 共用元件
  - 替換 8 處 `<pre>` + 1 處 chat `<p>` 為 `<AiMarkdown>`
  - 新檔：`src/components/ui/ai-markdown.tsx`

- [x] **P1-2** 前端顯示 safetyWarnings ✅ 2026-02-15
  - 4 個臨床 AI 結果（摘要/衛教/指引/決策）均新增 `SafetyWarnings` 元件
  - 新增 4 個 `xxxWarnings` state，從 API 回應捕獲 `safetyWarnings`
  - `ClinicalSummaryResponse` 型別補上 `safetyWarnings` 欄位

- [x] **P1-3** progress_note prompt 補齊 SOAP 四段 ✅ 2026-02-15（已在 P0-2 完成）

- [x] **P1-4** 移除重複的 Progress Note 入口 ✅ 2026-02-15
  - 刪除對話助手 tab 下方的 Progress Note 輔助區（約 60 行）
  - 移除未使用的 `progressNoteInput`/`polishedNote`/`medAdviceInput`/`polishedAdvice` state
  - 移除 `handlePolishProgressNote`/`handlePolishMedAdvice` handler

- [x] **P1-5** 修正按鈕文字 ✅ 2026-02-15
  - `medical-records.tsx` — "AI 修飾成英文 Progress Note" → "AI 修飾 Progress Note"
  - `medical-records.tsx` — "AI 修飾成英文" → "AI 修飾用藥建議"
  - `pharmacist-advice-widget.tsx` — "AI 修飾 & 翻譯成英文" → "AI 修飾藥師建議"
  - 同步修正描述文字（移除「英文」相關說明）

- [x] **P1-6** 免責聲明去重 ✅ 2026-02-15（採方案 B）
  - `safety_guardrail.py` — 新增 `include_disclaimer` 參數 + `disclaimer` 回傳欄位
  - `ai_chat.py` — 傳入 `include_disclaimer=False`
  - 前端 chat 區頂部加入永久性免責聲明 banner
  - 移除舊的「更新患者數值」按鈕提示文字

---

## P2 — 中期優化（功能提升）

> **目標：** 提升 AI 功能的實用性
> **預估：** 1-2 天
> **前置：** P1 全部完成

- [x] **P2-1** AI Chat 加入 conversation history + 壓縮摘要 ✅ 2026-02-15
  - `llm.py`：新增 `call_llm_multi_turn()` + `conversation_compress` prompt + 常數 RECENT_MSG_WINDOW/COMPRESS_THRESHOLD
  - `ai_chat.py`：`_build_chat_messages()` 組裝 [摘要]+[近期歷史]+[當前問題+RAG+病患]
  - `ai_chat.py`：`_maybe_compress_history()` 增量壓縮舊訊息為摘要
  - `ai_session.py`：新增 `summary`(Text) + `summary_up_to`(Integer) 欄位
  - Alembic 004：`004_ai_session_summary.py`
  - 測試：7 tests（3 原有更新 + 4 新增：history follow-up, session-id, compression trigger, summary injection）

- [x] **P2-2** 指引查詢顯示 RAG sources + 未索引警示 ✅ 2026-02-15
  - `patient-detail.tsx`：新增 `guidelineSources` state + 引用來源列表（doc_id + score% + category）
  - sources=0 時顯示黃色警示：「此建議來自 AI 預訓練知識，未引用院內文件庫」
  - import `GuidelineSource` type from `ai.ts`

- [x] **P2-3** 決策支援加入多科評估輸入 ✅ 2026-02-15
  - `patient-detail.tsx`：可收合 ChevronDown 面板，3 個 Textarea（腎臟科/藥師/護理）
  - 傳給後端：`assessments: [{agent:"nephrologist", opinion:...}, ...]`（僅傳有值者）

- [x] **P2-4** 衛教說明加閱讀程度控制 ✅ 2026-02-15
  - 後端：`ExplanationRequest` 新增 `reading_level`（simple/moderate/detailed）
  - 後端：`patient_explanation.py` 新增 `_READING_LEVEL_MAP` 對應繁中指令
  - 前端：`patient-detail.tsx` 新增 `<select>` 選擇說明程度
  - 前端：`ai.ts` `getPatientExplanation()` 新增 `readingLevel` 參數

- [x] **P2-5** 整合 func/ hybrid RAG 取代主系統 TF-IDF ✅
  - 新增 `evidence_client.py` HTTP 客戶端連接 func/ 服務
  - `ai_chat.py`：嘗試 hybrid RAG，失敗退回 TF-IDF
  - `clinical.py`：guideline + decision 也改用 hybrid RAG + fallback
  - `rag.py`：query/index/status 三端點皆優先使用 func/
  - `config.py`：新增 `FUNC_API_URL` 設定（default: http://127.0.0.1:8001）

---

## P3 — 進階整合（func/ 引擎）

> **目標：** 將 func/ 的 deterministic 引擎整合進主系統
> **預估：** 1-2 週
> **前置：** P2 完成

- [x] **P3-1** 整合劑量計算引擎 ✅
  - 後端：`POST /api/v1/clinical/dose` → 代理到 func/ `/dose/calculate`
  - Schema：`DoseCalculateRequest` + `PatientContext`（age, weight, crcl, hepatic 等）
  - 前端：`dosage.tsx` 全面改用 `calculateDose()` API，顯示 computed_values/steps/warnings
  - 前端 API：`ai.ts` 新增 `calculateDose()` 函式

- [x] **P3-2** 整合交互作用引擎 ✅
  - 後端：`POST /api/v1/clinical/interactions` → 代理到 func/ `/interactions/check`
  - Schema：`InteractionCheckRequest`（drug_list + patient_context）
  - 前端：`interactions.tsx` 改用 `checkInteractions()` API，顯示 severity badge
  - 前端：`patient-detail.tsx` 「交互作用查詢」按鈕加 `navigate('/pharmacy/interactions')`

- [x] **P3-3** 整合 clinical/query 統一入口 ✅
  - 後端：`POST /api/v1/clinical/clinical-query` → 代理到 func/ `/clinical/query`
  - Schema：`ClinicalQueryRequest`（question + intent + drug/drug_list/patient_context）
  - 前端 API：`ai.ts` 新增 `clinicalQuery()` 函式（auto intent routing）

- [x] **P3-4** 藥師角色安全警語邏輯修正 ✅
  - `safety_guardrail.py`：新增 `user_role` 參數
  - `role == "pharmacist"` → 「此計算結果僅供參考，請依臨床判斷」
  - 其他角色 → 保留「須經藥師/醫師雙重確認」
  - 所有 5 支 callers（clinical.py×4 + ai_chat.py×1）皆傳入 `user_role`

- [x] **P3-5** HIS 匯入改為 JSON 匯出 ✅
  - HIS 尚無 API，改為「匯出 JSON」按鈕
  - `medical-records.tsx`：匯出病歷 JSON（patient_id, record_type, content, timestamps）
  - `pharmacist-advice-widget.tsx`：匯出藥事建議 JSON（category, codes, content）

- [x] **P3-6** RAG 文件索引狀態指示器 ✅
  - 後端：`GET /api/v1/rag/status` 回傳 is_indexed / total_documents / total_chunks
  - 前端 API：`getRAGStatus()` in `ai.ts`
  - 前端 UI：AI 臨床輔助工具標題旁顯示 Badge（綠色已索引 / 琥珀色未索引）

## P4 — 藥事工作流程（Workstation）

> **目的：** 修正藥師工作台中「假功能」問題，確保所有操作都有真實後端行為或清楚降級訊息。

- [x] **P4-1** Workstation 全面評估改為真實 API 呼叫 ✅ 2026-02-15
  - 交互作用：優先 `POST /api/v1/clinical/interactions`（func/ 引擎），失敗 fallback 到 `GET /pharmacy/drug-interactions`
  - 相容性：`GET /pharmacy/iv-compatibility`（DB 查詢）
  - 劑量：`POST /api/v1/clinical/dose`（func/ 引擎），未啟動 func 時顯示明確訊息

- [x] **P4-2** Workstation 用藥建議送出改為持久化 ✅ 2026-02-15
  - `POST /pharmacy/advice-records` 寫入資料庫（含分類代碼、內容、linkedMedications）

- [x] **P4-3** 藥師側邊欄補齊工具入口 ✅ 2026-02-15
  - `/pharmacy/interactions` `/pharmacy/dosage` `/pharmacy/compatibility` `/pharmacy/error-report` `/pharmacy/advice-statistics`

- [x] **P4-4** PharmacistAdviceWidget 儲存改為持久化 ✅ 2026-02-15
  - `POST /pharmacy/advice-records`（避免「看似儲存但其實沒存」）

## P0-addendum — LLM 設定與錯誤呈現

- [x] **P0-A1** Chat 缺少 `OPENAI_API_KEY` 時不回傳 raw provider error ✅ 2026-02-15
  - `POST /ai/chat` 回傳可理解的系統訊息，避免前端直接顯示 OpenAI 401 payload
- [x] **P0-A2** 其他 LLM endpoint 缺 key 時回傳 503 + actionable message ✅ 2026-02-15
  - `/api/v1/clinical/summary` `/explanation` `/guideline` `/decision` `/polish`

---

## 進度統計

| 等級 | 總數 | 完成 | 進度 |
|------|------|------|------|
| P0 | 7 | 7 | 100% |
| P1 | 6 | 6 | 100% |
| P2 | 5 | 5 | 100% |
| P3 | 6 | 6 | 100% |
| P4 | 4 | 4 | 100% |
| **合計** | **28** | **28** | **100%** |

---

## 變更日誌

| 日期 | 動作 | 備註 |
|------|------|------|
| 2026-02-15 | 建立任務清單 | 基於 AI_AUDIT_REPORT.md 分析結果 |
| 2026-02-15 | P0 全部完成 | 5/5 — 移除空按鈕、繁中指令、安全護欄×2、json.dumps — 85 passed |
| 2026-02-15 | P1 全部完成 | 6/6 — Markdown渲染、safetyWarnings、SOAP四段、移除重複入口、按鈕文字、免責去重 — 85/85 + build pass |
| 2026-02-15 | P2 4/5 完成 | P2-1 對話歷史+壓縮摘要、P2-2 RAG sources、P2-3 多科評估、P2-4 閱讀程度 — 89/89 + build pass |
| 2026-02-15 | P3 2/6 完成 | P3-5 HIS→JSON匯出（medical-records + pharmacist-advice）、P3-6 RAG狀態指示器（badge UI） — 89/89 + build pass |
| 2026-02-15 | P0-P3 全部完成 22/22 | P2-5 hybrid RAG + P3-1 劑量計算 + P3-2 交互作用 + P3-3 統一入口 + P3-4 藥師警語 — 96/96 + build pass |
| 2026-02-15 | **全部完成 28/28** | P4 Workstation 真串接 + 用藥建議持久化 + 藥事側邊欄入口 + Chat 缺 key 友善訊息 — backend/pytest + frontend/build + Playwright pass |
