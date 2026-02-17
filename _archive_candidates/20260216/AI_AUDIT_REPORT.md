# ChatICU AI 功能深度分析報告

> **日期：** 2026-02-15
> **審查角色：** 資深 UX 研究員 + ICU 臨床藥師/醫師
> **範圍：** 主系統 `backend/` + 前端 `src/` + 獨立引擎 `func/`
> **後端測試基線：** 98/98 passed（85 unit + 13 E2E real OpenAI）

---

## 一、系統架構全貌

ChatICU 存在 **兩套獨立的 AI 系統**，目前未整合：

| 系統 | 位置 | 技術 | 狀態 |
|------|------|------|------|
| **主系統** | `backend/` + `src/` | FastAPI + gpt-4o + 簡易 TF-IDF RAG | 已上線（98 tests） |
| **進階引擎** | `func/` | FastAPI + Evidence RAG + Deterministic Rules | 已開發，**未整合** |

### func/ 引擎能力（主系統缺少的）

| 能力 | API | 說明 |
|------|-----|------|
| **Hybrid RAG** | `POST /query` | Dense + BM25 + RRF fusion + Reranking，強制引用（每句必須有 [C1] 標籤） |
| **劑量計算** | `POST /dose/calculate` | Deterministic 規則引擎，非 LLM 數學。支援 Dexmedetomidine / Fentanyl / Propofol / Midazolam / Haloperidol，含腎/肝功能調整、hard stop safety |
| **交互作用** | `POST /interactions/check` | 確定性配對檢查，severity 分級（contraindicated/major/moderate/minor），含 alias 解析 |
| **統一入口** | `POST /clinical/query` | `intent=auto` 用 LLM 意圖分類器路由到 RAG / dose / interaction |
| **證據驗證** | `validate_answer_with_citations()` | 確保每句回答都有引用標籤，不通過則降級為 extractive answer |
| **Refusal 機制** | `force_refusal_without_evidence` | 證據不足時拒絕回答，而非 hallucinate |

### 主系統 vs func/ 對比

| 項目 | 主系統 (`backend/`) | func/ 引擎 |
|------|---------------------|------------|
| RAG | TF-IDF 256 維 hash | OpenAI embedding + BM25 hybrid + rerank |
| 劑量計算 | 完全靠 LLM | Deterministic 公式引擎 + JSON 規則 |
| 交互作用 | 前端有按鈕但無後端 | 確定性 pair matching |
| 引用強制 | 無 | 每句必須 [C1] 標籤 |
| 證據不足處理 | LLM 自由生成 | 拒絕回答 + 原因說明 |
| Confidence | 無 | 0-1 分數，基於 rerank score |

---

## 二、按鈕與功能清單（10 個 AI 按鈕 + 2 個死按鈕）

| # | 按鈕 | 位置 | 角色限制 | Endpoint | Prompt Task |
|---|------|------|----------|----------|-------------|
| 1 | AI 對話 (Send) | 對話助手 tab | 全員 | `POST /ai/chat` | `rag_generation` |
| 2 | AI 修飾 Progress Note | 對話助手 tab 下方 | doctor/admin | `POST /clinical/polish` | `clinical_polish` |
| 3 | AI 修飾 Progress Note | 病歷記錄 tab | doctor/admin | `POST /clinical/polish` | `clinical_polish` |
| 4 | AI 修飾用藥建議 | 病歷記錄 tab | pharmacist/admin | `POST /clinical/polish` | `clinical_polish` |
| 5 | AI 檢查護理記錄 | 病歷記錄 tab | nurse/admin | `POST /clinical/polish` | `clinical_polish` |
| 6 | AI 修飾藥師建議 | 用藥 tab (PharmacistWidget) | pharmacist/admin | `POST /clinical/polish` | `clinical_polish` |
| 7 | 生成臨床摘要 | 病歷摘要 tab | 全員 | `POST /clinical/summary` | `clinical_summary` |
| 8 | 產生衛教說明 | 病歷摘要 tab | 全員 | `POST /clinical/explanation` | `patient_explanation` |
| 9 | 查詢指引建議 | 病歷摘要 tab | 全員 | `POST /clinical/guideline` | `guideline_interpretation` |
| 10 | 產生決策建議 | 病歷摘要 tab | doctor/admin | `POST /clinical/decision` | `multi_agent_decision` |
| 11 | **更新患者數值** | 對話助手 tab | 全員 | **無（空操作）** | — |
| 12 | **交互作用查詢** | 用藥 tab | 全員 | **無（死按鈕）** | — |
| 13 | **匯入 HIS** (x3) | 多處 | — | **無（死按鈕）** | — |

---

## 三、逐功能深度分析

### 3.1 AI 對話 (`POST /ai/chat`)

**流程：** 輸入 → RAG retrieve → 注入 patient context → gpt-4o → safety guardrail → 顯示

**E2E 驗證結果：**
- 有 patientId 時正確引用 Scr 1.8 / eGFR 38 / BUN 28 — 573 chars
- 無 patientId 時回答一般 ICU 知識 — 859 chars
- 無效 patientId 不崩潰 — 347 chars

**UX 問題：**
- 「更新患者數值」按鈕只彈 toast 但**實際無操作**（`patient-detail.tsx:741-743`）— **最危險的 UX bug**
- `citations` 後端有回傳，前端以 `msg.references` 讀取 — **欄位名不匹配**，引用來源未顯示
- `safetyWarnings` 後端有回傳，前端**完全未渲染**
- 每條 AI 回應都帶免責聲明，連續對話重複 3-4 次
- 無 conversation history — 無法追問

**臨床問題：**
- Prompt 未指定語言 → 輸出中英混雜、簡繁混雜（「重症监护病房」vs「加護病房」）
- 台灣 ICU 人員期待繁體中文 + 台灣醫療術語

### 3.2 Polish 系列（4 種 type × 多入口）

**共用 Prompt：** `clinical_polish` — 一支 prompt 處理 4 種文書

**UX 問題：**
- Progress Note 修飾在**兩處出現**（對話助手 tab + 病歷記錄 tab）— 使用者困惑
- 按鈕寫「AI 修飾 & **翻譯**」但 prompt 無翻譯指令，nursing_record 輸入中文輸出中文
- polished 內容用 `<pre>` 渲染，Markdown 格式（`**粗體**`）顯示為原始文字
- 所有「匯入 HIS」按鈕無功能

**臨床問題：**
- progress_note prompt 只提 "Assessment + Plan"，缺 Subjective + Objective（SOAP 四段不全）
- medication_advice 輸出過短（269 chars），缺 evidence level 和 guideline 引用
- pharmacy_advice 安全警語「須經藥師確認」出現在藥師自己寫的建議書上 — 邏輯矛盾

### 3.3 臨床摘要 (`POST /clinical/summary`)

**E2E：** 476 chars，涵蓋 diagnosis / labs / meds / vent

**問題：**
- **無安全護欄** — 唯一沒經 `apply_safety_guardrail()` 的 endpoint
- Prompt 限 "500 characters" — 中文 500 字 >> 英文 500 chars，限制不合理
- 輸出為連續段落，ICU 交班需要結構化格式（bullet points）

### 3.4 衛教說明 (`POST /clinical/explanation`)

**E2E：** 1531 chars，用英文解釋（台灣家屬需要中文）

**問題：**
- **無安全護欄**
- 輸出為英文 — 台灣家屬無法閱讀
- 無閱讀程度控制（未指定國中/高中程度）

### 3.5 臨床指引查詢 (`POST /clinical/guideline`)

**E2E：** 2401 chars，PADIS guideline 解讀 — 品質高

**問題：**
- RAG sources = 0（文件未索引）— 所有建議來自 LLM 預訓練知識
- 前端未顯示 `sources` 引用
- 前端未提供 `guidelineTopic` 輸入欄位

### 3.6 多角色決策支援 (`POST /clinical/decision`)

**E2E：** 2175 chars，整合 3 科意見 — 品質優秀

**問題：**
- 前端**無 assessments 輸入介面** — 多角色功能退化為單一問答
- 與 AI Chat 功能高度重疊，使用者不清楚差異

---

## 四、系統性問題

### 4.1 Prompt 設計

| 問題 | 嚴重度 | 位置 |
|------|--------|------|
| 7 個 prompt 都沒有語言指令 | **高** | `backend/app/llm.py` TASK_PROMPTS |
| `str(input_data)` 傳給 LLM | **中** | `llm.py:81` — Python repr 不是好的 LLM input |
| clinical_summary 限 500 chars | **中** | `llm.py:20` |
| progress_note 缺 SOAP S/O | **中** | `llm.py:47` |

### 4.2 安全護欄不一致

| Endpoint | 有護欄 | 應有 |
|----------|--------|------|
| `/clinical/summary` | **否** | 是 |
| `/clinical/explanation` | **否** | 是 |
| `/clinical/guideline` | 是 | 是 |
| `/clinical/decision` | 是 | 是 |
| `/clinical/polish` | 是 | 是 |
| `/ai/chat` | 是 | 是 |

### 4.3 前端渲染

- 所有 AI 輸出用 `<pre>` 渲染 — Markdown 格式完全失效
- 安全警示 `**[安全提醒]**⚠️` 在 `<pre>` 中只是純文字，不醒目
- `citations` / `safetyWarnings` 後端回傳但前端不顯示

### 4.4 func/ 引擎未整合

func/ 已有的進階能力（deterministic 劑量計算、交互作用檢查、evidence-first RAG）完全未被主系統使用。前端「交互作用查詢」按鈕是死按鈕，而 func/ 已有完整 API。

---

## 五、修正任務清單

> 完整任務追蹤見 `AI_TASK_TRACKER.md`

### P0 — 立即修復（病患安全 / 資料正確性）

| ID | 任務 | 影響 |
|----|------|------|
| P0-1 | 修復「更新患者數值」空操作按鈕 | 醫護人員誤以為數值已更新 |
| P0-2 | 所有 TASK_PROMPTS 加入繁體中文語言指令 | 輸出中英簡繁混雜 |
| P0-3 | `/clinical/summary` 加安全護欄 | 可能輸出未檢查的高警訊藥物劑量 |
| P0-4 | `/clinical/explanation` 加安全護欄 | 衛教可能含確定性用語 |
| P0-5 | `str(input_data)` → `json.dumps()` | LLM 誤讀 Python repr 格式 |

### P1 — 短期改善（1-2 天）

| ID | 任務 | 影響 |
|----|------|------|
| P1-1 | 前端引入 Markdown 渲染取代 `<pre>` | AI 輸出格式全部失效 |
| P1-2 | 前端顯示 safetyWarnings + citations | 重要資訊被隱藏 |
| P1-3 | progress_note prompt 補齊 SOAP 四段 | 不符醫學中心格式 |
| P1-4 | 移除重複的 Progress Note 入口 | UX 混亂 |
| P1-5 | 修正按鈕文字（移除「翻譯」） | 文字與行為不符 |
| P1-6 | 免責聲明去重 | Chat 中重複 3-4 次 |

### P2 — 中期優化（3-5 天）

| ID | 任務 | 影響 |
|----|------|------|
| P2-1 | AI Chat 加入 conversation history | 無法追問 |
| P2-2 | 指引查詢顯示 RAG sources | 使用者不知有無證據支持 |
| P2-3 | 決策支援加入多科評估輸入 | 多角色功能退化 |
| P2-4 | 衛教說明加閱讀程度控制 | 無法控制易讀性 |
| P2-5 | 整合 func/ hybrid RAG 取代 TF-IDF | RAG 品質大幅提升 |

### P3 — 進階整合（1-2 週）

| ID | 任務 | 影響 |
|----|------|------|
| P3-1 | 整合 func/ dose engine 到主系統 | 劑量計算從 LLM 升級為 deterministic |
| P3-2 | 整合 func/ interaction engine | 啟用「交互作用查詢」死按鈕 |
| P3-3 | 整合 func/ clinical/query 統一入口 | 自動路由 dose/interaction/RAG |
| P3-4 | 藥師角色安全警語調整 | 邏輯矛盾修正 |
| P3-5 | 匯入 HIS 功能實作或移除 | 死按鈕誤導 |
| P3-6 | RAG 文件索引狀態指示器 | 使用者知道 AI 有無參考文件 |

---

## 六、評分總結

| 維度 | 分數 | 說明 |
|------|------|------|
| 功能完整度 | 7/10 | 6 支 AI endpoint 全通，但 func/ 能力未整合 |
| 臨床安全性 | 6/10 | 2 endpoint 缺護欄、空操作按鈕、無 citation 強制 |
| Prompt 品質 | 5/10 | 缺語言指令、input 格式差、SOAP 不全 |
| UX 一致性 | 5/10 | 重複入口、死按鈕、Markdown 未渲染 |
| 進階能力潛力 | 9/10 | func/ 引擎品質極高，整合後將大幅提升 |

**結論：** 修復 P0（5 項）達安全基線，修復 P1（6 項）達可用體驗，整合 func/ 引擎（P3）將使系統品質提升一個層級。
