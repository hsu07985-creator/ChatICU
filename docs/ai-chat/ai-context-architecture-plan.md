# ChatICU AI 對話助手 — 資料架構重構規劃書

> 文件產生日期：2026-04-28
> 文件狀態：**草案 v2（含架構審查修訂）**
> 範圍：AI 對話助手（`/ai-chat` 與病人詳情頁內嵌 chat）的後端資料管線、prompt 組裝、與長期可擴展性
> 前置文件：[`docs/ai-chat/ai-integration-plan.md`](ai-integration-plan.md)（Phase 0–4 已完成）
> 本文件定位：**Phase 5+** — 從「硬編碼 builder」遷移到「資料字典 + Tool Calling」的目標架構
>
> **v2 變更摘要**（2026-04-28）：經 3 個 agent 並行做基礎設施可行性、I-01 端對端、風險審查後，
> 補上以下原 v1 缺漏：(1) Schema Registry 的 computed/virtual fields 設計、(2) ai_sessions
> backfill SQL 與 NULL 兼容、(3) Feature flag framework 為 P0 前置、(4) 重排 phase 順序
> （P5+P6 並行、P8 提前到 P7 之前、P9 拆 P9a/P9b）、(5) 與 backend-tasks.md `B15` TTFT
> SLA 的取捨、(6) 前端改動派工到 `docs/coordination/frontend-tasks.md`、(7) 時程從 7–8 週
> 修正為 8–10 週。詳見 §1.4。

---

## 目錄

- [0. TL;DR](#0-tldr)
- [1. 背景與觸發事件](#1-背景與觸發事件)
- [2. 現狀架構盤點](#2-現狀架構盤點)
- [3. 目標架構](#3-目標架構)
- [4. 核心元件設計](#4-核心元件設計)
- [5. 遷移計畫（Phase 5–10）](#5-遷移計畫phase-510)
- [6. 工程紀律](#6-工程紀律)
- [7. 涉及的檔案](#7-涉及的檔案)
- [8. 成功指標（KPI）](#8-成功指標kpi)
- [9. 待決定事項](#9-待決定事項)
- [10. 附錄](#10-附錄)

---

## 0. TL;DR

**目標**：讓未來 DB 任何新欄位、新類別、新資料源都能**不改 Python 程式碼**就被 AI 看到。

**核心翻轉**：
- 舊：把所有資料**預先 dump** 進 system prompt（`patient_context_builder.build_clinical_snapshot()`）
- 新：給 AI **動態查詢工具（tools）**＋一份**最小核心 snapshot**；AI 視 user 問題決定要查什麼

**四層架構**：
1. LLM Agent Loop（Claude / GPT 帶 tool use）
2. Tool / Capability Layer（FastAPI service：`get_lab_panel / get_cultures / compute_crcl / search_rag …`）
3. Domain Service + **Schema Registry**（YAML 資料字典：unit / range / priority / aliases）
4. DB（Postgres + JSONB + pgvector）

**漸進遷移**：Phase 5（registry 抽出）→ 6（builder 重構為 generator）→ 7（tool layer）→ 8（snapshot TTL）→ 9（RAG hook）→ 10（observability + eval）。**完全不需要 big bang 重寫**。

---

## 1. 背景與觸發事件

### 1.1 觸發案例（2026-04-28，I-01 廖剛賢）

使用者在 patient detail chat tab 詢問 CrCl，AI 回覆「快照沒有看到 CrCl 值」，但：

1. DB 中 I-01 確實有 lab 資料（`pat_5219befc`，30 筆）
2. raw lab JSON 沒有 `CrCl` 欄位 — HIS 只報 `Scr`（0.48 mg/dL）和 `eGFR`（134.7 mL/min/1.73m²）
3. `ai_sessions.snapshot_metadata` 中該 session 的 `snapshot_taken_at = 2026-04-24 02:56`（4 天前），且當時 DB 尚無 biochem 資料 → 快照中【關鍵檢驗】是空的
4. AI 無法解釋什麼是「快照」、為什麼空 — 因為 system prompt 沒給 meta-awareness

### 1.2 系統性問題（不只 CrCl）

這次調查暴露了 5 類問題（每類在 §2.3 有完整盤點）：

| 類別 | 問題 |
|---|---|
| **Builder 漏抓** | `_LAB_KEY_ALIASES` 只涵蓋 5/11 個 lab JSON 子類別（`venous_blood_gas / cardiac / thyroid / hormone / lipid / other` 全部忽略）；`hematology` 25 個 keys 只抓 3 個（漏 Segment%/Band 左移指標）|
| **整張表沒進 prompt** | `culture_results` 201 筆從未被查；discontinued 醫囑 3,273 筆完全忽略（停藥史） |
| **Snapshot 不刷新** | 第一次拍照後永不更新（除非 ≥30 分鐘的 delta block，且只比較 6 個 key_values） |
| **上游資料缺** | `vital_signs / ventilator_settings / medication_administrations / symptom_records` 四表全空 |
| **架構缺乏擴展性** | 加任何新欄位都要改 `patient_context_builder.py`，沒有 declarative metadata 機制；新工具/能力沒有 pluggable 接口 |

### 1.3 為什麼這是架構問題、不是資料問題

> **修補式做法的死路**：每次發現缺什麼就改 builder 加一段 if，半年後 builder 變成不可維護的 2000 行怪物，仍會繼續漏新欄位。

> **真正的根因**：「資料的意義（unit / range / 重要性 / alias）」跟「Python 程式碼」綁死。新欄位 = 改程式碼 = 需 PR + review + 部署 = 高摩擦 = 永遠跟不上。

### 1.4 架構審查發現（v2 新增，2026-04-28）

v1 草案完成後，由 3 個 agent 並行做：(A) 後端基礎設施可行性、(B) I-01 案例端對端驗證、(C) 風險與隱藏阻礙審查。結論：**plan 是 roadmap 但不是解法 — 7 項關鍵缺口需在執行前補齊**。

#### 1.4.1 五個 HIGH/CRITICAL 風險

| # | 嚴重度 | 問題 | v2 對應修正 |
|---|---|---|---|
| R1 | 🔴 HIGH | **Feature flag 基礎設施不存在** — `backend/app/config.py` 80+ settings 但無 flag framework；前端無 A/B toggle。Plan 寫「加 feature flag」一句帶過 | 新增 §5.2 P0「前置工作」：1 週建 flag framework + frontend toggle |
| R2 | 🔴 CRITICAL | **Tool calling 與 `backend-tasks.md:B15` TTFT SLA 矛盾** — B15 是 in-flight 任務，要求壓縮 snapshot、parallel DB query、prompt cache 來改善 TTFT；本 plan 的 multi-turn tool calling 每次 +1 LLM round trip，方向相反 | 新增 §3.4「TTFT 取捨設計」：minimal core 80% case 不觸發 tool；tool 只在 LLM 主動需要時呼叫；目標 p95 TTFT ≤ baseline + 800ms |
| R3 | 🔴 HIGH | **既有 100+ ai_sessions 沒 backfill 策略** — `snapshot_metadata` 是舊 JSONB 格式；新加 `snapshot_version / snapshot_expires_at / snapshot_stale` 三欄全 NULL；renderer 若不防呆會炸 | 更新 §4.4.3 加 backfill SQL；P6 renderer 強制 null-coalescing |
| R4 | 🟠 HIGH | **Schema Registry 對「computed/virtual fields」描述不清** — CrCl 不在 raw lab JSON，靠 `compute_crcl` tool 算；v1 §4.1.2 YAML 範例只示範 alias lookup，沒寫 derived/computed/virtual_field 機制 | 更新 §4.1.2 新增 `kind: computed` 範例（CrCl 直接示範） |
| R5 | 🟠 HIGH | **RAG 知識庫資料源出範圍** — `rag_chunks` 表 orphaned；P9 寫「知識庫匯入」但沒寫資料來源 / 版權 / 誰負責 | 拆 P9 為 P9a（資料源前置，外部依賴）+ P9b（tool 接入）|

#### 1.4.2 違反 backend session scope rule

`backend/CLAUDE.md` 明訂「frontend 改動需派到 `docs/coordination/frontend-tasks.md`」。v1 plan 包含：A/B toggle、refresh 按鈕、`tool_call` SSE 顯示 — **皆未派工**。v2 在 §7.2 補上完整協調項目。

#### 1.4.3 時程低估

| Phase | v1 估時 | v2 修正估時 | 原因 |
|---|---|---|---|
| P5 (Registry) | 1 週 | **2–3 週** | 60–80 條 lab 欄位需臨床 review |
| P7 (Tool + Loop) | 2 週 | **4–5 週** | 12 tools × (schema + handler + test) + 整合測試矩陣 |
| P10 (Eval) | 1 週 | **2–3 週** | 50 題 hand-authored + baseline 收集 + judge.py 實作 |
| **總計** | **7–8 週** | **8–10 週** | + P0 前置 1 週 |

#### 1.4.4 Phase 順序錯誤

| v1 順序 | v2 修正 | 原因 |
|---|---|---|
| P5 → P6 sequential | **P5 + P6 並行** | P6 byte-equal regression 本來就需 P5 registry |
| P8 在 P7 之後 | **P8 提前到 P7 之前** | TTL 解 staleness 跟 tool calling 完全獨立；先做能立刻解 I-01 |
| P9 直接執行 | **P9 拆成 P9a (資料源) + P9b (tool 接入)** | 資料源是外部依賴，不該卡 tool 開發 |

#### 1.4.5 Agent A 找到的 3 個 hidden gotchas

| # | Gotcha | 修正位置 |
|---|---|---|
| G1 | `llm.py:38-43` lazy client init 在 API key 缺失時返回 `"[ERROR]"` 文字而非 structured，tool handler 無法 retry | §4.3.5 加 tool error wrapping pattern |
| G2 | `ToolDefinition.input_schema` 是 raw JSON Schema，但 tool handler 期望 typed args，**缺 adapter layer** | §4.3.5 新增 JSON Schema → Pydantic 轉換 helper |
| G3 | `snapshot_metadata` JSONB 內部未版本化；deployment 期間兩版可能共存，renderer 必須兩版都吃 | §4.4.3 backfill 加 `snapshot_metadata.version` 內部欄位 |

#### 1.4.6 端對端驗證 — 不通過

Agent B 對 I-01 廖剛賢做完整 walk-through，verdict：**❌ Plan 在 P5–P8 完工前無法解 I-01**。好消息是 weight 68.5kg 與 eGFR 134.7 都在 DB（資料層 OK），壞消息是 tool 層、judge.py、tool-aware system prompt 全部 0 → 1。

→ **若要立即解 I-01**，建議走 §5.4「快速版路徑」：只做 P5（Registry）+ P8（TTL），跳過 tool calling，2–3 週內可上線。

---

## 2. 現狀架構盤點

### 2.1 資料流程（現況）

```
Frontend (/ai-chat)
   │ POST /ai/chat/stream { message, sessionId?, patientId? }
   ▼
backend/app/routers/ai_chat.py
   │ • 取 / 建 ai_session
   │ • 第一次：build_clinical_snapshot() → 存 snapshot_metadata
   │ • 後續：build_delta() → 附加在 user message 前
   │ • 載入最後 10 對話對 (20 messages)
   ▼
backend/app/services/patient_context_builder.py
   │ • _get_patient / _get_latest_lab / _get_lab_before_24h
   │ • _get_active_medications / _get_latest_vital
   │ • _get_latest_vent / _get_recent_reports / _get_latest_scores
   │ • _safe_duplicate_warnings
   │ → 組成 ~1.9KB 純文字 snapshot
   ▼
backend/app/llm.py call_llm_stream()
   │ system_prompt = TASK_PROMPTS["icu_chat"] + "\n[病患臨床快照]\n" + snapshot
   │ messages = [...10 turns..., {"role": "user", "content": delta + msg}]
   ▼
LLM (gpt-5.4-mini, temp 0.3, max 4096) → SSE stream → Frontend
```

### 2.2 主要檔案與職責

| 檔案 | 職責 | 痛點 |
|---|---|---|
| `backend/app/routers/ai_chat.py` | SSE endpoint、session 管理、history 重播 | 與 builder 緊耦合；snapshot 不會主動 refresh |
| `backend/app/services/patient_context_builder.py` | 組 clinical snapshot；建 delta；計算 key_values | 硬編碼欄位、硬編碼排版、硬編碼 alias map |
| `backend/app/models/ai_session.py` | `ai_sessions` + `ai_messages` ORM | `snapshot_metadata` 結構未版本化 |
| `backend/app/models/rag_chunk.py` | pgvector 向量表（1536d） | **chat 不查它** — 表存在但功能閒置 |
| `backend/app/llm.py` | LLM 呼叫、`TASK_PROMPTS["icu_chat"]` 系統提示 | 系統提示未提及「snapshot 是什麼」、「能用什麼工具」 |

### 2.3 DB ↔ Snapshot 落差表（完整盤點）

**圖例**：✅ 已進 prompt｜⚠️ DB 有但只抓部分｜❌ DB 有但完全沒進 prompt｜⛔ 來源就沒資料

#### 病人主檔 `patients`（15/15）

| 欄位 | 填寫率 | 進 prompt | 備註 |
|---|---|---|---|
| `name / age / gender / bed_number / diagnosis / icu_admission_date / ventilator_days / intubated / has_dnr / unit` | 15/15 | ✅ |  |
| `allergies` | 0/15 | ✅（空） | HIS 不送，需護理輸入 |
| `alerts` | 8/15 | ✅ |  |
| `weight / height / bmi` | 11/15 | ❌ | **能算 CrCl 但 builder 沒帶** |
| `code_status` | 15/15 | ❌ | 與 DNR 互補的 full code/limited 資訊 |
| `blood_type` | 12/15 | ❌ | 輸血、transfusion reaction 評估 |
| `tracheostomy / tracheostomy_date` | 15/15 | ❌ | 氣切狀態（脫機評估必需） |
| `consent_status` | 8/15 | ❌ | DNR 細節 bitmask |
| `is_isolated` | 15/15 | ❌ | 隔離狀態（感控） |
| `discharge_type / discharge_date / discharge_reason` | varies | ❌ | 已出院病人問答 |

#### `lab_data`（1,128 筆 / 11 個 JSON 子類別）

| 子類別 | 筆數 | 實際 keys | 進 prompt 的 keys | 缺口 |
|---|---|---|---|---|
| `biochemistry` | 302 | 27 | 10（Cr/BUN/eGFR/K/Na/Cl/AST/ALT/TBil/Alb） | ⚠️ 漏 **Ca / Mg / Phos / Glucose / LDH / AlkP / rGT / DBil / Ferritin / Iron / TIBC / NH3-無 / Uric / freeCa / BUN_Cr_ratio / AG_ratio / TotalProtein / Ketone** |
| `hematology` | 207 | 25 | 3（WBC/Hb/PLT） | ⚠️ 漏 **Segment% / Band / Lymph / Mono / Eos / Baso / NRBC / RDW_CV / RDW_SD / MCV / MCH / MCHC / RBC / Hct / ESR / AtyLymph / Myelo / Promyelo / Meta / EoCount / BloodType / RhType** ← 左移指標是敗血症 critical |
| `blood_gas` | 68 | 8 | 5 | ⚠️ 漏 BE / BEecf / SaO₂ |
| `venous_blood_gas` | 128 | 7 | 0 | ❌ **整類別忽略**；ICU 中央靜脈導管病人 VBG 比 ABG 更常見 |
| `inflammatory` | 110 | 2 | 2 | ✅ 100% |
| `coagulation` | 45 | 4 | 3 | ⚠️ 漏 PT |
| `cardiac` | 58 | 4 | 0 | ❌ **TnT / CK / CKMB / NTproBNP 全黑**（心肌損傷判讀） |
| `thyroid` | 19 | 3 | 0 | ❌ TSH / T3 / freeT4 |
| `hormone` | 14 | 7 | 0 | ❌ Cortisol / ACTH / iPTH / Insulin / C-Peptide / VitD25OH |
| `lipid` | 15 | 4 | 0 | ❌ TCHO / HDLC / LDLC / TG |
| `other` | 457 | 130+ | 0 | ❌ **builder 最大盲區**：HbA1C / NH3 / Amylase / Lipase / HBsAg / AntiHCV / U_*（尿沉渣） / PF_*（體液） / IGRA / ANA / cANCA …|

#### `medications`（active 559 筆 / discontinued 3,273 筆）

| 欄位 | 填寫率 | 進 prompt | 備註 |
|---|---|---|---|
| `name / generic_name / dose / unit / frequency / route / san_category / is_external / source_type` | 高 | ✅ |  |
| `atc_code` | 305/307 (99.3%) | ❌ | 重複用藥、跨藥分類分析必需 |
| `is_antibiotic` | 28/307 (9.1%) | ❌ | 抗生素降階決策標記偏低且未帶入 |
| `kidney_relevant` | 58/307 (18.9%) | ❌ | **直接告訴 AI「這藥需看 CrCl」**，現在完全沒用到 |
| `warnings` | 307/307 (100%) | ❌ | 藥品警示文字全有，但完全浪費 |
| `prescribing_doctor_name / order_code` | 100% | ❌ |  |
| `start_date / end_date` | 大部分 | ❌（只列 active）| 無法回答「這藥用了幾天」、「上次停 vasopressin 是何時」 |
| `prescribing_hospital / prescribing_department` | 部分 | ❌ | 外院藥源辨識 |
| `indication / concentration / days_supply` | 0–7/307 | ⛔ | HIS 不送 |
| **discontinued 紀錄** | 3,273 筆 | ❌ | **完全忽略停藥史**（抗生素 de-escalation、vasopressor wean 時機判讀必需） |

#### 其他臨床表

| 表 | 筆數 | 進 prompt | 缺口 |
|---|---|---|---|
| `culture_results` | 201（12/15 病人） | ❌ | **completely ignored**；isolates + susceptibility 對 ICU 抗生素決策最關鍵 |
| `diagnostic_reports` | 319 | ⚠️ 取最新 3 筆，body_text 截 100 字 | 截斷常切到中段、impression 沒抓到；reporter / status 沒帶 |
| `clinical_scores` | 3（1/15） | ⚠️ pain / RASS only | 缺 GCS / SOFA / APACHE II / CAM-ICU pipeline |
| `vital_signs` | 0 | ⛔ | HIS 無床邊 monitor，需護理 EMR 補 |
| `ventilator_settings` | 0 | ⛔ | HIS 無呼吸器資料，需 vent vendor 整合 |
| `medication_administrations` | 0 | ⛔ | HIS 無 MAR；AI 不知實際給藥 |
| `symptom_records` | 0 | ⛔ |  |
| `rag_chunks` | (向量) | ❌ | 表在但 chat 完全沒查；orphaned |

### 2.4 問題分級（L1–L4）

| L | 類型 | 解法 | 工程量 |
|---|---|---|---|
| **L1** | Builder 漏抓 | 改 backend code（registry 化） | 低 |
| **L2** | Snapshot 生命週期 | 改 backend + 前端按鈕 | 低–中 |
| **L3** | 上游資料缺 | 跨團隊整合 HIS / 護理 / vendor | 高（多週–數月）|
| **L4** | 架構升級 | RAG hook、tool calling、observability | 中 |

本規劃書聚焦 **L1 + L2 + L4**。L3 列為依賴項，由獨立工作流推動。

---

## 3. 目標架構

### 3.1 四層架構圖

```
┌──────────────────────────────────────────────────────────────────┐
│ ① LLM Agent Loop                                                  │
│     Claude 4.x / GPT-5.x with tool use                            │
│     • system prompt = 角色 + 最小 core snapshot + 工具清單描述     │
│     • 多輪：LLM 自行決定 tool_call → 結果 → 繼續推理               │
└────────────────┬─────────────────────────────────────────────────┘
                 │ tool_call("get_lab_panel", { patient_id, category, days })
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ ② Tool / Capability Layer (FastAPI internal services)             │
│     • get_demographics                                            │
│     • get_lab_panel(category, days)                               │
│     • get_active_meds / get_med_history                           │
│     • get_cultures                                                │
│     • get_imaging_reports                                         │
│     • compute_crcl                                                │
│     • check_drug_interactions                                     │
│     • search_guidelines_rag                                       │
│     • refresh_snapshot                                            │
│     ─ 每個工具有 declarative schema、回傳 structured JSON ─        │
└────────────────┬─────────────────────────────────────────────────┘
                 │ 讀
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ ③ Domain Service + Schema Registry                                │
│     • PatientContextService（純 ORM 查詢，不負責格式化）           │
│     • SnapshotRenderer（讀 registry 動態 render markdown）         │
│     • SchemaRegistry（YAML 資料字典：unit / range / priority /     │
│       aliases / clinical_use_cases / prompt_visibility）           │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ ④ DB（Postgres + JSONB + pgvector）                                │
│     patients / lab_data / medications / culture_results /         │
│     diagnostic_reports / ai_sessions / rag_chunks ...             │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 設計原則

1. **Single source of truth — Schema Registry**
   一個 YAML（或 DB 表）描述每個欄位/lab key 的：canonical name、aliases、unit、reference range、clinical priority、用途。前端 label、後端格式化、AI prompt、alert engine 都讀同一份。

2. **Declarative over imperative**
   加新 lab key = **加 YAML 一段**；不需動 Python 程式碼、不需 PR review 邏輯。

3. **Tool-driven retrieval over pre-bundled prompt**
   System prompt 只放 minimal core（demographics + 異常 lab 5 個 + critical meds）；其餘讓 LLM 用 tool 主動拉。
   - Context 不會無限膨脹（LLM 注意力 / token 成本 / 延遲都好）
   - 加新 tool = 多一個能力，LLM 自動知道（從 description）

4. **Observable by default**
   每個 tool call、snapshot rebuild、RAG retrieval 都 log 到 `ai_telemetry` 表。後續可 dashboard 化。

5. **Meta-aware AI**
   System prompt 教 AI：
   - 你看到的 minimal snapshot 是 X 時點的快照
   - 你有 N 個工具可以查更多資料
   - 若資料缺，先呼叫 tool；tool 也回 None，明確告訴 user「DB 中無 X」而非編造

6. **Graceful degradation**
   工具失敗 / 資料缺時，回傳 structured `{ "status": "no_data", "reason": "..." }` 而非 throw。AI 用 reason 文字回應。

7. **Backward compatibility**
   舊 `/ai/chat/stream` 端點不變，schema 不破壞性升級；P5–P8 階段並行運作。

### 3.3 TTFT 取捨設計（v2 新增 — 回應 R2 / `backend-tasks.md:B15`）

**衝突點**：B15 要求壓縮 prompt、parallel DB、prompt cache 來改善 TTFT；本 plan 引入 multi-turn tool calling，每多一個 tool round trip ≈ +800–1200ms LLM TTFT。

**解法**：tool calling **不是預設行為**，而是「LLM 自己判斷 minimal core 不夠時才用」：

| 情境 | 是否觸發 tool call | 期望 turn 數 |
|---|---|---|
| 一般問診（病情詢問、用藥確認）：minimal core 足夠 | ❌ 不呼叫 | 1 turn |
| 特殊面向（cardiac、感染、內分泌）：core 沒帶 | ✅ 呼叫 1 個 tool | 2 turns |
| 跨域決策（renal dosing 用 vancomycin）：要 CrCl + lab + meds | ✅ 呼叫 2–3 tools | 2–3 turns |
| 需要外部知識（指引引用）：呼叫 RAG | ✅ 呼叫 RAG tool | 2 turns |

**SLA 目標**：
- p50 turns: ≤ 1.3（多數情境不需 tool）
- p95 first-meaningful-token latency: ≤ baseline + 800ms
- p95 final-token latency: ≤ baseline + 2.5s

**工程手段**：
- minimal core 控制在 1.5–2KB（B15 對齊）
- tool handler 內部 DB query parallel（`asyncio.gather`）
- 啟用 Anthropic / OpenAI prompt cache（minimal core + tool definitions 都進 cache 段）
- tool 結果 ≤ 500 tokens（避免吃完 cache window）
- LLM 拒呼叫 tool（懶惰）→ eval set 把這類 case 設為失敗，回去調 prompt

**降級路徑**：若實測 p95 latency 超 SLA，啟用 `TOOL_CALLING_ENABLED=false` flag 回退到 v1 行為。

### 3.4 為什麼是「tool calling + 小 snapshot」而非「更大 snapshot」

| 思路 | 「全部塞進 prompt」 | 「Tool calling」 |
|---|---|---|
| 加新欄位 | 改 builder + 重部署 | 加 YAML，下一輪請求生效 |
| Token 成本 | 每次 turn 重送整份 ~10KB → ~50KB | core ~2KB + 必要時 tool 結果 ~3KB |
| 延遲 (TTFT) | snapshot 越大越慢 | 第一輪 minimal 很快；tool call 才付代價 |
| LLM 注意力 | context 太長會忽略中段（lost-in-middle） | 工具結果剛拉就在最近，注意力高 |
| 過時資料 | 第一次拍照不刷新就一直用舊的 | tool 一定拉即時資料 |
| 觀測性 | 看不出 AI 有沒有「用」這個欄位 | tool log 直接告訴你 |
| 知識庫整合 | 沒辦法塞 1000 筆指引 | RAG tool top-K 即可 |

→ **2026 業界標準姿勢**：Anthropic Tool Use、OpenAI Function Calling、MCP、Vercel AI SDK 都走這條路。

---

## 4. 核心元件設計

### 4.1 Schema Registry（資料字典）

#### 4.1.1 儲存位置

```
backend/app/schema_registry/
  ├── lab_panel.yaml           # 11 大類 lab 欄位
  ├── medication_panel.yaml    # 藥物欄位
  ├── patient_panel.yaml       # 病人主檔欄位
  ├── vital_panel.yaml         # 生命徵象（即使現在空）
  ├── ventilator_panel.yaml
  ├── culture_panel.yaml
  └── _loader.py               # YAML loader + Pydantic schema 驗證
```

選用 **YAML 而非 DB 表**的理由：
- 版本控管（git diff 可見）
- 部署時 atomic 載入
- 不需要寫 admin UI
- Pydantic 可在 CI 階段驗證 schema 正確

未來若需要 medical staff 線上編輯，再升級為 DB 表 + admin UI。

#### 4.1.2 YAML schema 範例

```yaml
# backend/app/schema_registry/lab_panel.yaml

version: "1.0"

fields:
  # ─── biochemistry ──────────────────────────
  - canonical: creatinine
    category: biochemistry
    aliases: [Scr, Cr, creatinine]
    display_name: { zh: 血清肌酸酐, en: Serum Creatinine }
    unit: mg/dL
    ref_range: { low: 0.7, high: 1.3 }
    clinical_priority: critical          # critical | important | situational
    trend_window_hours: 24
    use_cases: [renal_dosing, aki_workup, ckd_staging]
    prompt_visibility: always            # always | on_demand | excluded
    abnormal_flags:
      high: { threshold: 1.5, severity: warning }
      very_high: { threshold: 3.0, severity: critical }

  - canonical: nh3
    category: other                      # 注意 HIS 把它放在 other
    aliases: [NH3, Ammonia]
    display_name: { zh: 氨, en: Ammonia }
    unit: μg/dL
    ref_range: { low: 11, high: 32 }
    clinical_priority: situational
    use_cases: [hepatic_encephalopathy, urea_cycle_disorders]
    prompt_visibility: on_demand         # 不在 minimal core，等 tool 拉

  - canonical: troponin_t
    category: cardiac
    aliases: [TnT, Troponin-T]
    display_name: { zh: 肌鈣蛋白 T, en: Troponin T }
    unit: ng/mL
    ref_range: { low: 0, high: 0.014 }
    clinical_priority: critical
    use_cases: [acs, cardiac_injury, post_arrest]
    prompt_visibility: always_if_present  # 有值才進 core

  # ─── hematology ─────────────────────────────
  - canonical: segment_pct
    category: hematology
    aliases: [Segment, Seg, "Seg%"]
    display_name: { zh: 中性球分節核, en: Segmented Neutrophils }
    unit: "%"
    ref_range: { low: 41.2, high: 74.7 }
    clinical_priority: important
    use_cases: [sepsis_left_shift, infection]
    prompt_visibility: always
    derived:
      - name: left_shift_warning
        when: { Band: { gt: 10 } }       # 觸發 alert 條件
        message: "⚠️ 左移：Band {Band}%"

  # ... (餘略，約 60–80 個 lab 條目涵蓋目前 DB 11 大類所有實際使用的 keys)

  # ─── computed / virtual fields（v2 新增 — 解 I-01 CrCl 案例）──────────
  # 這類 field 在 raw lab JSON 中不存在，靠 tool 計算
  - canonical: crcl
    kind: computed                       # ← 區分於 stored 的 lab keys
    source_tool: compute_crcl
    display_name: { zh: 肌酸酐廓清率, en: Creatinine Clearance }
    unit: mL/min
    ref_range: { low: 90, high: 120 }
    clinical_priority: critical
    use_cases: [renal_dosing]
    prompt_visibility: on_demand         # 不進 minimal core，等 LLM 呼叫
    inputs_required: [serum_creatinine, age, weight, gender]
    formula: cockcroft_gault
    fallback_when_missing:
      - condition: { weight: null }
        action: return_status
        status: missing_weight
        suggest_alternative: egfr        # 退而求其次顯示 eGFR
      - condition: { serum_creatinine: null }
        action: return_status
        status: no_recent_creatinine

  - canonical: bsa
    kind: computed
    source_tool: compute_bsa
    formula: dubois
    inputs_required: [height, weight]

  - canonical: anion_gap
    kind: computed
    source_tool: compute_anion_gap
    formula: "Na - (Cl + HCO3)"
    inputs_required: [sodium, chloride, hco3]
```

#### 4.1.3 三類 field 的對照（v2 新增）

| `kind` | 來源 | Visibility 預設 | 範例 |
|---|---|---|---|
| `stored` | DB lab JSONB（HIS sync 進來）| `always` / `always_if_present` | Scr, K, eGFR, Hb |
| `computed` | tool 動態計算（不在 DB） | `on_demand`（除非 minimal core 必需）| **CrCl**, BSA, anion_gap |
| `derived_alert` | 條件式衍生警示（不是值） | `auto`（達條件即印） | 左移 (Band > 10%)、急性腎損傷 |

#### 4.1.4 Tool ↔ Registry 對應規則（v2 新增）

每個 `kind: computed` field 必須：
1. 指定 `source_tool` — 對應 §4.3.2 tool registry 中的 tool name
2. 列出 `inputs_required` — 工具會用 registry alias 解析這些輸入
3. 提供 `fallback_when_missing` — 缺輸入時的 graceful degradation 規則

`source_tool` 的 handler 從 registry 讀 `formula` 與 `fallback_when_missing`，**不在 Python 程式碼裡寫公式邏輯**。新增公式 = 加 YAML + 註冊 formula identifier，公式實作放 `backend/app/clinical_formulas/` pluggable module。


#### 4.1.3 Pydantic schema 驗證

```python
# backend/app/schema_registry/_loader.py

class LabFieldSpec(BaseModel):
    canonical: str
    category: Literal[
        "biochemistry", "hematology", "blood_gas", "venous_blood_gas",
        "inflammatory", "coagulation", "cardiac", "thyroid",
        "hormone", "lipid", "other"
    ]
    aliases: List[str]
    display_name: Dict[Literal["zh", "en"], str]
    unit: Optional[str]
    ref_range: Optional[Dict[str, float]]
    clinical_priority: Literal["critical", "important", "situational"]
    trend_window_hours: Optional[int] = None
    use_cases: List[str] = []
    prompt_visibility: Literal["always", "always_if_present", "on_demand", "excluded"]
    # ...

class LabPanelSchema(BaseModel):
    version: str
    fields: List[LabFieldSpec]

@lru_cache(maxsize=1)
def load_lab_registry() -> LabPanelSchema:
    path = Path(__file__).parent / "lab_panel.yaml"
    return LabPanelSchema.model_validate(yaml.safe_load(path.read_text()))
```

啟動時呼叫 `load_lab_registry()`；YAML 格式錯誤直接讓服務啟動失敗（fail-fast）。

### 4.2 Snapshot Renderer（讀 registry 動態 render）

取代現在 `_fmt_lab_section` 的硬編碼，改成 generator pattern：

```python
# backend/app/services/snapshot_renderer.py

def render_lab_section(
    lab: LabData,
    prev_lab: Optional[LabData],
    visibility_filter: Set[str] = {"always", "always_if_present"},
) -> str:
    """讀 registry，依 priority 分組輸出 markdown。"""
    registry = load_lab_registry()
    sections: Dict[str, List[str]] = {}

    for spec in registry.fields:
        if spec.prompt_visibility not in visibility_filter:
            continue
        val = _extract(lab, spec.category, spec.aliases)
        if val is None and spec.prompt_visibility == "always_if_present":
            continue
        prev = _extract(prev_lab, spec.category, spec.aliases) if prev_lab else None
        flag = _compute_flag(val, spec.ref_range, spec.abnormal_flags)
        trend = _format_trend(val, prev) if spec.trend_window_hours else ""
        line = f"{spec.display_name['zh']} {val}{spec.unit or ''}{flag}{trend}"
        sections.setdefault(spec.use_cases[0] if spec.use_cases else "其他", []).append(line)

    return "\n".join(f"【{k}】\n  " + " | ".join(v) for k, v in sections.items())
```

> **以後加 NH₃ / TnT / TSH 完全不改這份程式碼**，只需更新 `lab_panel.yaml`。

### 4.3 Tool Layer

#### 4.3.1 工具註冊機制

```python
# backend/app/ai_tools/__init__.py

@dataclass
class ToolDefinition:
    name: str
    description: str
    input_schema: Dict[str, Any]   # JSON schema (LLM 看得懂)
    handler: Callable[..., Awaitable[Dict[str, Any]]]
    requires_patient_context: bool = True
    rate_limit_per_session: Optional[int] = None
    log_level: str = "info"

TOOL_REGISTRY: Dict[str, ToolDefinition] = {}

def register_tool(tool: ToolDefinition) -> None:
    TOOL_REGISTRY[tool.name] = tool
```

#### 4.3.2 第一批工具（Phase 7 交付）

| Tool | 用途 | 何時呼叫 |
|---|---|---|
| `get_demographics` | 病人主檔（含 weight/height/code_status/blood_type） | 需要計算 CrCl、判斷 BSA |
| `get_lab_panel` | 取指定 category 與時間範圍的 lab | user 問特定面向（心、肝、腎、感染） |
| `get_lab_trend` | 單一 canonical key 的時間序列 | user 問「Cr 趨勢」 |
| `get_active_medications` | 全部 active 醫囑（含 atc/kidney_relevant/warnings） | 開始臨床推理時 |
| `get_medication_history` | 過去 N 天用藥（含 discontinued）| user 問「上次用過什麼抗生素」 |
| `get_cultures` | 近 N 天細菌培養 + 藥敏 | user 問抗生素選擇、感染 |
| `get_imaging_reports` | 近 N 天影像（impression + 全文）| user 問影像 |
| `compute_crcl` | Cockcroft-Gault；缺 weight 回傳 `{ "status": "missing_weight" }` | 任何 renal dosing |
| `check_drug_interactions` | 包裝既有 `DuplicateDetector.analyze()` | user 問藥物交互 |
| `search_guidelines_rag` | 向量檢索 `rag_chunks` | 引用院內指引、藥典 |
| `refresh_snapshot` | 手動重拍 minimal snapshot | user 明說「最新狀況」 |
| `get_clinical_scores` | GCS / RASS / SOFA / APACHE II | 嚴重度評估（依 L3 上游補資料）|

#### 4.3.3 工具 schema 範例（Anthropic / OpenAI 通用）

```python
register_tool(ToolDefinition(
    name="get_lab_panel",
    description=(
        "Retrieve lab values for a patient within a time range. "
        "Use category='cardiac' for troponin/BNP, 'thyroid' for TSH, "
        "'biochemistry' for renal/liver/electrolytes, 'all' for everything. "
        "Returns structured JSON with values, units, abnormal flags, and timestamps."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "patient_id": {"type": "string"},
            "category": {
                "type": "string",
                "enum": [
                    "biochemistry", "hematology", "blood_gas", "venous_blood_gas",
                    "inflammatory", "coagulation", "cardiac", "thyroid",
                    "hormone", "lipid", "other", "all",
                ],
            },
            "days": {"type": "integer", "default": 7, "minimum": 1, "maximum": 90},
        },
        "required": ["patient_id", "category"],
    },
    handler=handle_get_lab_panel,
))
```

#### 4.3.4 Agent loop 整合

```python
# backend/app/services/ai_agent_loop.py

async def run_chat_turn(
    session: AISession,
    user_message: str,
    db: AsyncSession,
) -> AsyncIterator[StreamEvent]:
    """新版主流程，取代 ai_chat.py 直呼 call_llm_stream 的單次模式。"""
    minimal_core = await build_minimal_core(session.patient_id, db)
    system_prompt = _build_system_prompt(minimal_core)
    messages = await _load_history(session, db)
    messages.append({"role": "user", "content": user_message})

    max_iterations = 5
    for _ in range(max_iterations):
        async for event in call_llm_stream_with_tools(
            system=system_prompt,
            messages=messages,
            tools=[t.input_schema for t in TOOL_REGISTRY.values()],
        ):
            if event.type == "tool_use":
                result = await TOOL_REGISTRY[event.name].handler(
                    db=db, session=session, **event.input
                )
                await _log_tool_call(session.id, event.name, event.input, result)
                messages.append({"role": "assistant", "content": event.raw})
                messages.append({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": event.id, "content": result},
                ]})
                yield StreamEvent(type="tool_call", name=event.name, input=event.input)
                break  # 重新進迴圈讓 LLM 看 tool result
            elif event.type == "delta":
                yield event
            elif event.type == "done":
                return
        else:
            break  # 沒跑到 break 表示 LLM 已 done
```

### 4.3.5 Tool Error Wrapping & Schema Adapter（v2 新增 — G1 / G2）

#### Tool Result Envelope（強制 structured）

`backend/app/llm.py:38-43` 的 lazy client init 在 API key 缺時返回 `"[ERROR] ..."` 純文字 — agent loop 拿到後無法判斷是 tool 結果還是 LLM 出錯。**所有 tool handler 強制返回 envelope**：

```python
class ToolResult(TypedDict):
    status: Literal["success", "no_data", "missing_input", "error", "rate_limited", "timeout"]
    data: Optional[Dict[str, Any]]
    reason: Optional[str]            # 給 LLM 看的中文說明
    machine_code: Optional[str]      # 給 telemetry / retry 用
    suggest_alternative: Optional[str]  # 例：missing_weight → suggest "egfr"
```

範例：

```python
async def handle_compute_crcl(patient_id: str, db: AsyncSession) -> ToolResult:
    pat = await get_patient(db, patient_id)
    scr = await get_latest_creatinine(db, patient_id)
    if pat.weight is None:
        return {
            "status": "missing_input",
            "data": None,
            "reason": "DB 中無體重資料；無法用 Cockcroft-Gault 計算 CrCl。建議改看 eGFR 或請護理人員補體重。",
            "machine_code": "missing_weight",
            "suggest_alternative": "egfr",
        }
    if scr is None:
        return {"status": "no_data", "reason": "近 7 天無 Scr 資料", "machine_code": "no_recent_creatinine"}
    crcl = cockcroft_gault(scr.value, pat.age, pat.weight, pat.gender)
    return {
        "status": "success",
        "data": {"crcl_ml_per_min": round(crcl, 1), "method": "Cockcroft-Gault",
                 "inputs": {"scr": scr.value, "age": pat.age, "weight": pat.weight, "gender": pat.gender}},
    }
```

**System prompt 規則**：「拿到 `status != success` 的 tool 結果時，必須把 `reason` 原文告訴 user，不可編造數值。」

#### JSON Schema → Pydantic Adapter

`ToolDefinition.input_schema` 是 raw JSON Schema（給 LLM 看），但 handler 要 typed args。新增 helper：

```python
# backend/app/ai_tools/registry.py
def validate_tool_input(tool: ToolDefinition, raw_input: Dict) -> Dict:
    """
    Pydantic v2 動態建模 — 把 JSON Schema 轉成 model 做 validation。
    失敗回傳 ToolResult{status: 'error', machine_code: 'invalid_input'} 而非 throw。
    """
    try:
        Model = pydantic.create_model_from_jsonschema(tool.input_schema)
        return Model.model_validate(raw_input).model_dump()
    except pydantic.ValidationError as e:
        return {"status": "error", "machine_code": "invalid_input", "reason": str(e)}
```

→ 工具實作層永遠不會收到非法 args；agent loop 的失敗會被 telemetry 記下而非 crash。

### 4.4 Snapshot 新生命週期

#### 4.4.1 「Minimal Core」內容（每輪都帶）

僅約 1–2KB：
- 病人 demographics（10 欄）
- 異常 lab 5 個（priority=critical 且 abnormal=true 的最新值）
- 升壓藥 / 抗生素 / 鎮靜劑（active）
- 最新 vital + vent（若有）
- 簡短「資料缺口」聲明（例：「無 vital_signs 資料」、「快照拍於 X，需即時請呼叫 refresh_snapshot」）

#### 4.4.2 失效機制

| 觸發 | 動作 |
|---|---|
| Session 開新 | 拍 minimal core，存 `snapshot_metadata.taken_at + expires_at` |
| 距 `taken_at` ≥ 6 小時 | 下一輪自動 rebuild（lazy） |
| HIS sync 完一輪 | publish event `patient.data_updated` → 標記相關 session `stale=true` |
| User 明說「最新」 | LLM 呼叫 `refresh_snapshot` tool |
| 前端按「重新整理」按鈕 | API `POST /ai/sessions/{id}/refresh` |

#### 4.4.3 ai_sessions 結構升級（Migration，v2 修訂 — 含 backfill）

> **背景（v2 R3）**：DB 中已有 100+ 既存 sessions，新欄位若 NULL 且 renderer 沒防呆會 crash。
> Migration 必須包含明確 backfill 策略，且 `snapshot_metadata` JSONB 內部要加版本標籤（G3）。

**Migration 071（雙向相容）**：

```sql
-- 1. 加新欄位，舊資料用 SQL 直接 backfill（不靠應用層）
ALTER TABLE ai_sessions
  ADD COLUMN snapshot_version INT NOT NULL DEFAULT 1,
  ADD COLUMN snapshot_expires_at TIMESTAMPTZ,           -- 可 NULL = 待下次互動 lazy 重建
  ADD COLUMN snapshot_stale BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. 既存 sessions backfill：標記為「即將過期」，下一輪互動 rebuild
--    NOT 設成 now() - 1 day（會觸發 day-1 mass refresh storm）
--    NOT 設成 now() + 6 hr（舊 snapshot 又被誤認為新鮮）
--    ✅ 設成 NULL + stale=true：lazy rebuild、無 thundering herd
UPDATE ai_sessions
SET snapshot_expires_at = NULL,
    snapshot_stale = TRUE
WHERE snapshot_metadata IS NOT NULL
  AND created_at < now();

-- 3. 在 snapshot_metadata JSONB 內部加 version 欄位（G3 雙版本共存）
UPDATE ai_sessions
SET snapshot_metadata = snapshot_metadata || jsonb_build_object('schema_version', 1)
WHERE snapshot_metadata IS NOT NULL
  AND NOT (snapshot_metadata ? 'schema_version');
```

**Migration 072 — ai_tool_calls table**：

```sql
CREATE TABLE ai_tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES ai_messages(id),
  tool_name TEXT NOT NULL,
  input_json JSONB NOT NULL,
  output_json JSONB,
  duration_ms INT,
  status TEXT NOT NULL,         -- success | error | rate_limited | timeout
  error_message TEXT,
  llm_iteration INT NOT NULL DEFAULT 1,  -- agent loop 第幾輪呼叫
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_tool_calls_session ON ai_tool_calls(session_id, created_at DESC);
CREATE INDEX idx_ai_tool_calls_tool ON ai_tool_calls(tool_name, created_at DESC);
```

**應用層 NULL 兼容（v2 新增）**：

```python
# backend/app/services/snapshot_renderer.py
def is_snapshot_fresh(session: AISession) -> bool:
    """處理 v1（NULL 欄位）與 v2 sessions。"""
    if session.snapshot_stale:
        return False
    if session.snapshot_expires_at is None:
        # v1 session（migration 71 backfill 後仍 NULL 的）→ 視為過期
        return False
    return session.snapshot_expires_at > datetime.now(timezone.utc)


def read_snapshot_text(session: AISession) -> Optional[str]:
    """雙 schema 兼容讀取。"""
    meta = session.snapshot_metadata or {}
    schema_v = meta.get("schema_version", 1)
    if schema_v == 1:
        return meta.get("clinical_snapshot")  # v1 結構
    if schema_v == 2:
        return meta.get("core") or meta.get("clinical_snapshot")  # v2 minimal core
    raise ValueError(f"Unknown snapshot schema version: {schema_v}")
```

**Rollback 策略**：
- Migration 071 / 072 **必須是冪等且可回滾**（用 `IF NOT EXISTS` + 對應 `DROP COLUMN IF EXISTS`）
- 部署後 24 小時觀察期：若新 renderer 在舊 session 上失敗率 > 1%，啟用 `SNAPSHOT_USE_REGISTRY=false` flag 回退
- 既有 `snapshot_metadata` JSONB 結構不變（只加 `schema_version` 欄位），舊版 builder 仍能讀

### 4.5 System Prompt 升級

```text
你是 ChatICU 的 ICU 臨床決策輔助 AI。以實證醫學為依據，給出直接、可執行的建議。

## 你看到的資料

你會收到一份「Minimal Core Snapshot」，包含病人 demographics、目前的異常 lab、active 升壓/抗生素/鎮靜劑、最新生命徵象。
這份 snapshot 是 {{snapshot_taken_at}} 拍的。

## 你能呼叫的工具

當 minimal core 的資料不夠回答 user 的問題，你可以呼叫工具：
- get_lab_panel(category, days)：取完整 lab（心臟 cardiac、甲狀腺 thyroid、肝功能 biochemistry…）
- get_cultures：細菌培養與藥敏
- get_medication_history：過去 N 天用藥（含已停）
- compute_crcl：算 CrCl
- search_guidelines_rag(query)：查院內指引、藥典
- refresh_snapshot：當 user 明說「最新」時呼叫
- ...

## 行為規則

1. **資料缺時**：先呼叫對應工具；若工具回 `{ "status": "no_data" }`，明確告訴 user「DB 中無 X」，不要編造。
2. **快照可能過時**：如果你的回答涉及最近 1 小時內的數值，建議呼叫 `refresh_snapshot`。
3. **腎/肝功能**：開藥前若需 dose adjustment，先呼叫 `compute_crcl` 與 `get_lab_panel('biochemistry', 1)`。
4. **抗生素決策**：先呼叫 `get_cultures` 看藥敏，再 `get_medication_history` 看過去 14 天用過什麼。

[安全規則... 同舊版]
[回覆格式... 同舊版]
[語言... 同舊版]
```

---

## 5. 遷移計畫（Phase 0 + Phase 5–10）

### 5.1 階段總覽（v2 修訂 — 含 P0、phase 並行、P9 拆解）

| Phase | 主題 | 工程量 | 並行 | 風險 | 是否會影響使用者 |
|---|---|---|---|---|---|
| **P0** | **前置基礎設施**（feature flag framework + frontend toggle infra + 知識庫資料源討論） | **1 週** | — | 中 | 不影響（內部工具）|
| **P5** | Schema Registry 建立（含 computed/virtual fields 設計） | **2–3 週** | ⇄ P6 | 低 | 不影響（純文件）|
| **P6** | Snapshot Renderer 重構（讀 registry） | **2 週** | ⇄ P5 | 中 | 行為一致（regression test 把關） |
| **P8** | **Snapshot TTL + 主動刷新**（提前到 P7 之前）| **半週** | — | 低 | UX 加按鈕、解 staleness |
| **P7** | Tool Layer + Agent Loop（含 12 tools + error wrapping）| **4–5 週** | — | 中–高 | A/B 測試切換 |
| **P9a** | **RAG 知識庫資料源前置**（外部依賴 — Sanford / 院內 SOP / ATC kidney dosing 表） | TBD | 非阻塞 | 高（外部） | 不影響 |
| **P9b** | RAG tool 接入 chat（依 P9a） | 1 週 | 等 P9a | 中 | 啟用後可引用指引 |
| **P10** | Telemetry + Eval Harness | **2–3 週** | 可隨 P7 並行起 | 低 | 內部工具 |

**總時程修正**：P0 + P5 + P6 + P8 + P7 + P10 ≈ **8–10 週**（v1 寫 7–8 週為低估）。
**快速版路徑**（解 I-01 燃眉之急）：見 §5.4 — 只跑 P0 + P5 + P8，**2–3 週可上線**，跳過 tool calling。

### 5.1.1 Phase 依賴關係圖（v2 新增）

```
P0 (1 週) ──┬─→ P5 (2–3 週) ──┐
            │                  ├─→ P8 (0.5 週) ──→ P7 (4–5 週) ──→ P10 收尾
            └─→ P6 (2 週) ────┘                          │
                                                          │
            P9a (外部，非阻塞) ─────────────→ P9b (1 週) ──┘
```

### 5.2 各階段交付物

#### Phase 0：前置基礎設施（v2 新增）

**目標**：補齊 v1 plan 沒寫到、但是 P5–P10 必要的基礎工具。

**交付**：
- **Feature flag framework**
  - `backend/app/feature_flags.py`：簡易 env-var-driven flag service（不引入 LaunchDarkly 等外部依賴）
  - 規格：支援 `bool`、`percentage rollout`、`per-user-id allowlist`
  - 至少實作這些 flag：`SNAPSHOT_USE_REGISTRY`、`TOOL_CALLING_ENABLED`、`SNAPSHOT_TTL_HOURS`
  - 前端 helper（接續任務）：`src/lib/feature-flags.ts` 透過 `/feature-flags` API 取得 flag → frontend-tasks.md 新增任務
- **API contract 預先草稿**
  - 在 `docs/coordination/api-contracts.md` 寫好 `POST /ai/chat/v2/stream`、`POST /ai/sessions/{id}/refresh`、`GET /feature-flags` 的 request/response schema
  - 新 SSE event types：`tool_call`、`tool_result`、`snapshot_refreshed`
- **P9a kickoff**（非阻塞）：開 ticket 跟 PM 對齊知識庫資料源（Sanford 授權 / 院內 SOP 蒐集 / ATC kidney dosing 表來源）
- **frontend-tasks 派工**：A/B toggle UI、refresh 按鈕、tool_call 顯示 placeholder

**Acceptance**：
- [ ] feature flag 在 backend 三個地方可用（router / service / config）
- [ ] api-contracts.md 有完整 v2 endpoint schema 章節
- [ ] frontend-tasks.md 有 3 條 `[READY]` 任務（A/B toggle、refresh button、tool_call SSE 渲染）
- [ ] P9a ticket 有 owner 與 ETA

#### Phase 5：Schema Registry（不破壞現狀）

**目標**：把 builder 中所有硬編碼的「欄位意義」抽成 YAML，但 builder 仍照舊運作。

**交付**：
- `backend/app/schema_registry/lab_panel.yaml`（涵蓋目前 DB 11 類別所有實際使用的 lab keys，約 60–80 條）
- `backend/app/schema_registry/medication_panel.yaml`
- `backend/app/schema_registry/patient_panel.yaml`
- `backend/app/schema_registry/_loader.py` + Pydantic 驗證
- 啟動時 fail-fast 驗證
- Unit tests：`backend/tests/test_schema_registry.py`

**Acceptance**：
- [ ] `pytest backend/tests/test_schema_registry.py` 全綠
- [ ] 啟動時 log 印出載入的欄位數量
- [ ] `_LAB_KEY_ALIASES` 與 YAML 內容一致（用 script 比對）

#### Phase 6：Snapshot Renderer 重構

**目標**：`patient_context_builder.py` 改用 registry 動態生成，輸出與舊版**逐字節一致**（可選擇性新增 keys 但用 feature flag）。

**交付**：
- 新檔 `backend/app/services/snapshot_renderer.py`
- 重構 `patient_context_builder.py:_fmt_lab_section / _fmt_patient_section / ...` 改 delegate 給 renderer
- 加 feature flag `SNAPSHOT_USE_REGISTRY=true|false`
- Regression test：對 5 位 ICU 病人比對「舊 builder 輸出」vs「新 renderer 輸出」必須 byte-equal（feature flag off 時）

**Acceptance**：
- [ ] feature flag off：與舊版 byte-equal
- [ ] feature flag on：可看到 venous_blood_gas / cardiac / thyroid 等新類別
- [ ] PR review 通過、merge 後監控 24h 無 regression

#### Phase 7：Tool Layer + Agent Loop

**目標**：建 12 個工具、建 agent loop，並行運作（舊 endpoint 不變）。

**交付**：
- `backend/app/ai_tools/` 12 個 handler
- `backend/app/services/ai_agent_loop.py`
- 新 endpoint `POST /ai/chat/v2/stream` （v1 保留）
- DB migration: `ai_tool_calls` 表
- Frontend：`/ai-chat` 加「使用新版」開關（A/B test）

**Acceptance**：
- [ ] Eval set 20 題（§附錄 A）在 v2 答得不比 v1 差（LLM-as-judge ≥ v1）
- [ ] tool call success rate ≥ 95%
- [ ] p95 first-token latency ≤ v1 + 500ms

#### Phase 8：Snapshot TTL + 主動刷新

**目標**：解決 I-01 案例的「快照 4 天前」問題。

**交付**：
- DB migration：ai_sessions 加 `snapshot_expires_at / snapshot_stale`
- Endpoint：`POST /ai/sessions/{id}/refresh`
- Frontend：chat header 加「最近更新 2 小時前 [重新整理]」UI
- 後端：HIS sync 完成後 publish event，標記 stale
- LLM tool：`refresh_snapshot`

**Acceptance**：
- [ ] 6 小時後 session 自動 rebuild
- [ ] HIS sync 後相關 session 在下一輪對話自動拿到最新資料
- [ ] User 點按鈕後 5 秒內看到新資料

#### Phase 9：RAG 接入 chat

**目標**：`rag_chunks` 表終於被 chat 用到。

**交付**：
- 知識庫匯入 pipeline（院內指引、Sanford、ATC kidney dosing 表）
- Tool `search_guidelines_rag(query, top_k=5)` 上線
- System prompt 加「引用指引」規則

**Acceptance**：
- [ ] `rag_chunks` 至少 1,000 筆有意義 chunks
- [ ] 抽 10 個指引相關問題，AI 引用率 ≥ 80%

#### Phase 10：Telemetry + Eval Harness

**目標**：可觀測、可回歸。

**交付**：
- `ai_tool_calls` dashboard（Grafana 或 Supabase view）
- `backend/eval/icu_chat_eval.py`：每週自動跑 50 題、LLM-as-judge 給分
- CI gate：PR 改 prompt 或 builder 必須跑 eval

**Acceptance**：
- [ ] Dashboard 看得到「過去 7 天 tool call 分佈、失敗率、p95 延遲」
- [ ] Eval set 50 題、自動跑、輸出 markdown 報告

### 5.3 風險與緩解（v2 修訂 — 含 1.4 五大風險）

| # | 風險 | 影響 | 緩解 |
|---|---|---|---|
| R1 | **Feature flag framework 不存在**（HIGH） | P5+P6 卡住 | P0 完成前不啟動 P5；framework 為硬性前置 |
| R2 | **Tool calling 與 B15 TTFT SLA 矛盾**（CRITICAL）| 違反 latency UX | §3.3 設計：tool 預設不觸發、p50 turn ≤ 1.3；超 SLA 啟用 `TOOL_CALLING_ENABLED=false` 回退 |
| R3 | **既有 100+ ai_sessions 無 backfill**（HIGH） | 舊 session crash | Migration 071 含 SQL backfill；renderer 含 NULL coalescing；24h 觀察期 |
| R4 | **Registry 缺 computed fields 設計**（HIGH） | CrCl 等 tool 計算值無法表達 | §4.1.2 加 `kind: computed`；§4.1.3 三類 fields 對照；§4.1.4 tool↔registry 對應規則 |
| R5 | **RAG 知識庫資料源外部依賴**（HIGH） | P9 卡住 | 拆 P9a / P9b；P9a 列為非阻塞外部任務；P9b 等 P9a ready |
| R6 | YAML registry 爆量、無法維護（MED） | 維護成本高 | 每個 panel 限 100 條；超過拆檔；CI 驗 schema |
| R7 | Tool calling 額外 LLM 成本（MED） | 月成本上升 | minimal core 涵蓋 80% 常見問題；P10 telemetry 監控 |
| R8 | LLM 不主動呼叫 tool（懶惰）（MED） | 答案品質下降 | system prompt 明寫「資料缺時必須呼叫」；eval set 強制覆蓋 |
| R9 | Migration 期間 v1/v2 行為不一致（LOW） | A/B 結果失準 | feature flag + regression test + byte-equal baseline |
| R10 | `snapshot_stale` event 與 HIS sync 競態（LOW） | 偶發過期判斷錯誤 | event 用 transactional outbox pattern |
| R11 | **Lazy LLM client 錯誤格式**（G1 LOW） | tool retry 邏輯失效 | §4.3.5 強制 ToolResult envelope |
| R12 | **JSON Schema↔Pydantic 缺 adapter**（G2 LOW） | tool input validation 不一致 | §4.3.5 提供 `validate_tool_input` helper |
| R13 | **snapshot_metadata JSONB 內部沒版本化**（G3 MED） | 部署期間雙版共存會炸 | Migration 071 加 `schema_version` JSONB key；renderer 雙版兼容讀 |
| R14 | **TASK_PROMPTS 其他任務（clinical_summary, safety_check）未升級**（MED） | 架構不一致 | 標為 P11 未來工作；本 plan 範圍只 `icu_chat` |

### 5.4 快速版路徑（v2 新增 — 解 I-01 燃眉之急）

**目標**：2–3 週內讓 I-01 案例的問題消失，不等 tool calling。

**範圍**：只跑 P0 + P5（簡化版）+ P8。

| 階段 | 動作 | 何時解 I-01 |
|---|---|---|
| Week 1 | P0：feature flag framework + frontend refresh button 派工 | — |
| Week 1–2 | P5-Lite：只把 §2.3 表中 ❌ 缺漏的 lab keys（venous_blood_gas / cardiac / NH3 / Amylase）寫進 registry，其他延後 | — |
| Week 2 | P6-Lite：renderer 改成讀 registry，舊輸出 byte-equal 為前提下加新類別 | snapshot 內容變多，但仍可能過期 |
| Week 2–3 | P8：snapshot TTL（6h）+ refresh 按鈕 + HIS sync event | ✅ I-01 解決：4 天前快照會被自動 invalidate，下次互動拉到 4/26 lab |

**跳過**：tool calling、agent loop、judge.py、RAG。CrCl 仍由 builder 直接從 weight + Scr 算出來塞進 snapshot（不走 tool 路徑）。

**何時走完整 plan**：
- 快速版上線並穩定 1–2 週後
- B15 TTFT 改善任務完成（避免兩個衝突任務同時改）
- 有資源做 P7 的 4–5 週投入


---

## 6. 工程紀律

### 6.0 Feature Flag Framework（v2 新增 — P0 交付）

**為何要做**：v1 plan 多處寫「加 feature flag」但 `backend/app/config.py` 80+ settings 全是 hard config，沒有 runtime toggle 機制。P5–P9 全部依賴此 framework。

**最小可行設計**：

```python
# backend/app/feature_flags.py

class FeatureFlag(BaseModel):
    name: str
    enabled: bool = False
    rollout_percentage: int = 0           # 0–100；用 user_id hash 決定
    user_allowlist: List[str] = []
    description: str = ""

def is_enabled(flag_name: str, user_id: Optional[str] = None) -> bool:
    flag = _get_flag(flag_name)             # 從 ENV / DB 讀
    if not flag.enabled: return False
    if user_id and user_id in flag.user_allowlist: return True
    if flag.rollout_percentage >= 100: return True
    if flag.rollout_percentage == 0: return False
    return _hash_to_bucket(user_id, 100) < flag.rollout_percentage
```

**初期 flag 清單**：

| Flag | 用途 | Phase |
|---|---|---|
| `SNAPSHOT_USE_REGISTRY` | P6 切換新 renderer | P5/P6 |
| `TOOL_CALLING_ENABLED` | P7 切換 tool calling agent loop | P7 |
| `SNAPSHOT_TTL_HOURS` | P8 控制 TTL（int，預設 6） | P8 |
| `RAG_TOOL_ENABLED` | P9b 切換 RAG | P9b |
| `EVAL_HARNESS_AUTORUN` | P10 weekly run on/off | P10 |

**前端整合**：透過 `GET /feature-flags` API（含 user context）取得目前 flag 狀態；frontend-tasks.md 派工。

### 6.1 「新增資料時的 PR Checklist」

任何 PR 新增 DB 欄位、新 lab key、新工具，必須勾選：

```markdown
- [ ] Schema Registry 已更新（lab_panel.yaml / medication_panel.yaml / ...）
- [ ] 至少一個 tool 能查到此資料
- [ ] 若是 critical 等級，已加入 minimal core
- [ ] 已加 Eval set 一題涵蓋此資料
- [ ] CI 通過（schema 驗證 + eval 不退化）
```

CI gate（GitHub Actions）：
```yaml
- name: Schema Registry validation
  run: python3 -m backend.app.schema_registry._loader --validate
- name: ICU chat eval (regression)
  run: python3 -m backend.eval.icu_chat_eval --baseline main --threshold 0.95
```

### 6.2 Eval Set

#### 6.2.1 設計原則

- 50 題涵蓋 ICU 常見問題（renal dosing / sepsis / vent weaning / drug interaction / refresh）
- 每題定義「期望涵蓋的資料點」（必須出現在回答中或 tool call 中）
- LLM-as-judge：用 Claude 4.x 對「答案 vs 期望點」打分 0–5

#### 6.2.2 範例題目（完整 50 題見 §附錄 A）

```yaml
- id: eval_001
  patient_id: pat_a86cb503  # I-05 吳佳旺（J18.9 肺炎、有 cultures）
  question: "他這次 sputum 培養結果如何？建議怎麼選抗生素？"
  expected_data_points:
    - tool_called: get_cultures
    - mentions: ["isolates", "susceptibility", "敏感", "抗藥"]
    - mentions_active_med_check: true
  judge_criteria: |
    回答中應該：
    1. 引用具體菌種與藥敏（從 get_cultures 結果）
    2. 對照目前 active 抗生素（從 get_active_medications）
    3. 給降階或升階建議

- id: eval_007
  patient_id: pat_5219befc  # I-01 廖剛賢
  question: "他的 CrCl 多少？開 vancomycin 怎麼算劑量？"
  expected_data_points:
    - tool_called: compute_crcl
    - tool_called: get_demographics  # 拿 weight
    - mentions: ["Cockcroft-Gault", "mL/min", "weight"]
    - if_missing_weight: explicit_acknowledgment
  judge_criteria: |
    若 weight 缺（DB 中為 NULL），AI 必須：
    1. 明確告訴 user「缺體重，無法精準算 CrCl」
    2. 用 eGFR 134.7 mL/min/1.73m² 給粗略估算
    3. 不能自己編造一個 weight 值
```

#### 6.2.3 跑法

```bash
cd backend
python3 -m eval.icu_chat_eval \
  --eval-set tests/eval/icu_chat_eval_set.yaml \
  --judge-model claude-opus-4-7 \
  --output reports/eval_$(date +%Y%m%d).md
```

### 6.3 Telemetry / 觀測

#### 6.3.1 必收的 metrics

| Metric | 收哪 | 用途 |
|---|---|---|
| `ai_tool_calls` rows | DB | 每天哪些 tool 被叫、失敗率 |
| `snapshot_rebuilds_per_day` | DB | TTL 機制是否有效 |
| `session_avg_tool_calls` | DB | LLM 是否「夠主動」（< 0.5 表示懶惰） |
| `eval_score_weekly` | CI | regression 偵測 |
| `first_token_latency_p95` | log | TTFT 健康度 |
| `total_tokens_per_session` | DB | cost monitoring |

#### 6.3.2 Dashboard（建議用 Grafana 或 Supabase view）

```sql
-- 每天 tool 呼叫分佈
SELECT
  DATE(created_at AT TIME ZONE 'Asia/Taipei') AS day,
  tool_name,
  COUNT(*) AS calls,
  AVG(duration_ms) AS avg_ms,
  SUM(CASE WHEN status='error' THEN 1 ELSE 0 END)::FLOAT / COUNT(*) AS error_rate
FROM ai_tool_calls
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

---

## 7. 涉及的檔案

### 7.1 新增

```
backend/app/schema_registry/
  __init__.py
  _loader.py
  lab_panel.yaml
  medication_panel.yaml
  patient_panel.yaml
  vital_panel.yaml
  ventilator_panel.yaml
  culture_panel.yaml

backend/app/services/
  snapshot_renderer.py
  ai_agent_loop.py

backend/app/ai_tools/
  __init__.py
  registry.py
  patient.py            # get_demographics
  labs.py               # get_lab_panel, get_lab_trend
  medications.py        # get_active_medications, get_medication_history
  cultures.py           # get_cultures
  imaging.py            # get_imaging_reports
  computations.py       # compute_crcl, check_drug_interactions
  rag.py                # search_guidelines_rag
  snapshot.py           # refresh_snapshot

backend/app/routers/
  ai_chat_v2.py         # 新版 endpoint（並行運作）

backend/alembic/versions/
  XXX_add_snapshot_lifecycle.py
  XXX_add_ai_tool_calls.py

backend/tests/
  test_schema_registry.py
  test_snapshot_renderer_regression.py
  test_ai_tools/
    test_get_lab_panel.py
    test_compute_crcl.py
    test_get_cultures.py

backend/eval/
  icu_chat_eval.py
  judge.py
  icu_chat_eval_set.yaml

docs/coordination/
  api-contracts.md       # 新增 v2 endpoint schema
```

### 7.2 修改

#### Backend（本 session 直接改）

| 檔案 | 修改 |
|---|---|
| `backend/app/services/patient_context_builder.py` | `_LAB_KEY_ALIASES` 改 deprecated；`_fmt_*` 改 delegate 給 renderer |
| `backend/app/routers/ai_chat.py` | 加 feature flag；保留 v1 行為 |
| `backend/app/llm.py` | `TASK_PROMPTS["icu_chat"]` 加工具與 meta-awareness 段；`call_llm_stream_with_tools` 新增 |
| `backend/app/models/ai_session.py` | 加 `snapshot_version / snapshot_expires_at / snapshot_stale` 欄位 |
| `backend/app/config.py` | 加 LLM tool calling 相關 setting（max_iterations、tool_timeout） |
| `backend/requirements.txt` | 加 `pyyaml` |

#### Frontend（v2 新增 — 派工到 `docs/coordination/frontend-tasks.md`，禁止本 session 直接改）

| 檔案 | 修改 | 對應 Phase |
|---|---|---|
| `src/lib/api/ai.ts` | 加 `refreshSession()` API；新 SSE event types `tool_call / tool_result / snapshot_refreshed` 解析 | P0、P7、P8 |
| `src/lib/feature-flags.ts` | 新檔；透過 `GET /feature-flags` 取得 flag | P0 |
| `src/pages/ai-chat.tsx` | header 顯示「快照拍於 X、[重新整理]」；`tool_call` 進度提示 UI | P7、P8 |
| `src/pages/patient-detail.tsx` | chat tab 同上 | P7、P8 |

**派工格式**（依 `backend/CLAUDE.md`）：
```markdown
### [READY] AI chat refresh button + tool_call SSE 渲染
- **Phase**: P8 / P7
- **Endpoint dependency**: POST /ai/sessions/{id}/refresh, SSE event types
- **Schema**: docs/coordination/api-contracts.md#ai-chat-v2
- **Notes**: tool_call event 顯示「正在查 cultures…」placeholder
```

#### Coordination 文件（v2 新增）

| 檔案 | 內容 |
|---|---|
| `docs/coordination/api-contracts.md` | 新增 `/ai/chat/v2/stream`、`/ai/sessions/{id}/refresh`、`/feature-flags`、SSE event schemas |
| `docs/coordination/backend-tasks.md` | 把本 plan 拆成可勾選任務、與 B15 對齊 |
| `docs/coordination/frontend-tasks.md` | P0 / P7 / P8 frontend 工作項目 |

> **強制**：本 plan 每個 Phase 完成時，依 `backend/CLAUDE.md` 協議：(1) 更新 api-contracts.md、(2) 標 backend-tasks.md 為 `[DONE]`、(3) 推 `[READY]` 任務到 frontend-tasks.md。

### 7.3 廢棄/遷移

- `_LAB_KEY_ALIASES` dict（移到 YAML 後保留 1 個 release 作為 fallback，下版移除）
- `build_clinical_snapshot()` 在 P7 之後改用 `build_minimal_core()`，舊函式 deprecated 1 個 release

---

## 8. 成功指標（KPI）

### 8.1 量化指標

| 指標 | 現況 | P8 後目標 | 衡量方式 |
|---|---|---|---|
| Lab JSON 子類別覆蓋率 | 5/11 | **11/11** | registry 條目數 |
| Active medications 欄位覆蓋率 | 6/30 | **15/30** | registry 條目數 |
| Snapshot 過期時間 | ∞（永不更新）| **≤ 6 小時** | TTL 設定 |
| 加新 lab key 所需檔案改動 | 1 (`*.py`) | **1 (`*.yaml`)** | PR 統計 |
| Eval set 通過率 | N/A（無 baseline）| **≥ 80%** | 自動跑 |
| Cultures 進 prompt 比例 | 0% | **100%（透過 tool）** | tool call log |

### 8.2 質化指標

- AI 不再說「快照沒有 X」而是主動呼叫 tool 或承認「DB 中無 X」
- 加新欄位的 PR：YAML 一段 + 一個 eval test，無需改 builder
- 病人詳情 chat 有「最近更新 X 小時前」UI，user 可主動刷新

---

## 9. 待決定事項（Open Questions）

| # | 議題 | 候選答案 | 何時決定 |
|---|---|---|---|
| Q1 | YAML 還是 DB 表存 registry？ | YAML 起步，未來需 admin UI 再升級 | P5 開始前 |
| Q2 | Tool call 是否同步串流回前端？ | 是（透過 SSE event `tool_call`）讓 UI 顯示「正在查 cultures…」 | P7 設計階段 |
| Q3 | LLM 廠商：keep OpenAI 還是換 Claude 4.x？ | 兩家都支援 tool use；偏好 Claude（traceable thinking） | P7 啟動前 |
| Q4 | RAG 知識庫範圍 | (a) 院內 SOP (b) Sanford/Lexicomp 外部來源 (c) 教科書 | P9 設計階段（涉及版權） |
| Q5 | Snapshot TTL 設多久？ | 6 hr 起步，依使用情境調整 | P8 上線後 1 週調整 |
| Q6 | 是否上 MCP（Model Context Protocol）標準？ | 自訂 tool 起步；MCP 在生態成熟後再遷移 | P10 之後 |
| Q7 | `vital_signs / ventilator_settings` 上游補資料的負責團隊？ | 待確認（可能護理 EMR / vendor） | 與 PM 對齊 |
| Q8 | **與 `backend-tasks.md:B15` TTFT SLA 取捨：先做 B15 還是先做本 plan？** | (a) 先 B15 再 plan（單線）(b) 並行（風險高）(c) 走快速版 §5.4 跳 tool calling | P0 啟動前必決 |
| Q9 | **快速版（§5.4）vs 完整 plan：先做哪個？** | 強烈建議先快速版上線、解 I-01 燃眉 | P0 啟動前必決 |
| Q10 | **既有 `TASK_PROMPTS["clinical_summary" / "safety_check" / ...]` 是否一併升級？** | (a) 留 v1（本 plan 範圍只 icu_chat）(b) 平行升級 | P10 後決定 |
| Q11 | **P9a 知識庫資料源負責人？** | (a) 醫療團隊蒐集院內 SOP (b) 外部授權（Sanford / Lexicomp） (c) 兩者 | P0 開 ticket 即決 |
| Q12 | **Feature flag 持久化方式？** | (a) ENV 變數 only（簡單但無 runtime 切換）(b) DB 表 + admin UI（彈性高、工程多） | P0 設計階段 |
| Q13 | **既有 100+ ai_sessions 是否一律標 stale？** | (a) 全標（v2 §4.4.3 預設）(b) 只標 7 天前的 (c) 全保留靠 lazy expire | Migration 前必決 |

---

## 10. 附錄

### A. Eval Set 範例（前 10 題；完整 50 題見 `backend/eval/icu_chat_eval_set.yaml`）

```yaml
version: "1.0"
cases:
  - id: eval_001
    category: sepsis_antibiotics
    patient: pat_a86cb503  # I-05 吳佳旺 J18.9
    question: "他這次 sputum 培養結果如何？建議怎麼選抗生素？"
    expected_tools: [get_cultures, get_active_medications]
    must_mention: [isolates, susceptibility]

  - id: eval_002
    category: renal_dosing
    patient: pat_5219befc  # I-01 廖剛賢
    question: "他的 CrCl 多少？開 vancomycin 該怎麼算劑量？"
    expected_tools: [compute_crcl, get_demographics, get_lab_panel]
    must_mention: [Cockcroft-Gault, weight]
    edge_case: missing_weight_must_acknowledge

  - id: eval_003
    category: cardiac
    patient: pat_e89d7678  # I-21 洪高悅治 I46.9 cardiac arrest
    question: "他的 troponin 趨勢如何？"
    expected_tools: [get_lab_panel(cardiac), get_lab_trend(troponin_t)]
    must_mention: [TnT, 趨勢]

  - id: eval_004
    category: vent_weaning
    patient: pat_a745e02b  # I-09 賴美玲 vent dependency 949 days
    question: "可以開始 weaning 嗎？"
    expected_tools: [get_clinical_scores, get_lab_panel(blood_gas)]
    must_mention: [RSBI, ABG, 脫機]
    edge_case: vital_signs_empty_must_acknowledge

  - id: eval_005
    category: drug_interaction
    patient: pat_46f2cc19  # I-12 陳秀梅
    question: "目前用藥有沒有交互作用問題？"
    expected_tools: [check_drug_interactions, get_active_medications]
    must_mention: [交互, ATC]

  - id: eval_006
    category: refresh_intent
    patient: pat_5219befc
    question: "幫我看他現在最新的數值"
    expected_tools: [refresh_snapshot, get_lab_panel]
    must_mention: [更新, 最新]

  - id: eval_007
    category: hepatic
    patient: pat_e89d7678
    question: "他有 hepatic encephalopathy 風險嗎？NH3 多少？"
    expected_tools: [get_lab_panel(other)]
    must_mention: [NH3, ammonia]

  - id: eval_008
    category: missing_data
    patient: pat_5219befc
    question: "他的 SpO2 多少？"
    expected_response_pattern: explicit_no_data
    must_mention: [vital_signs, 無資料]

  - id: eval_009
    category: med_history
    patient: pat_26290720  # I-02 魏秋葵 (long-stay, lots of meds)
    question: "他過去兩週用過什麼抗生素？降階了嗎？"
    expected_tools: [get_medication_history]
    must_mention: [discontinued, 停藥]

  - id: eval_010
    category: combined
    patient: pat_a86cb503
    question: "依他現況，下一步建議？"
    expected_tools: [get_lab_panel(all), get_cultures, get_active_medications, get_clinical_scores]
    must_mention: [SOFA, 培養, 抗生素]
```

### B. 完整資料盤點表

見 §2.3。所有未來新增欄位請以該表格式追加。

### C. 估算 token 成本對比

| 模式 | Per turn input tokens | Per turn output | 月成本（1000 sessions × 5 turns）|
|---|---|---|---|
| **舊（full snapshot）** | ~3000（snapshot 含全部）| ~500 | ~$XX |
| **新（minimal + tool）** | ~800 (core) + tool 結果 ~600 = ~1400 平均 | ~500 | **~$YY (約省 50%)** |

> 數字待 P10 telemetry 實測確認。

### D. 與既有 `docs/ai-chat/ai-integration-plan.md` 的關係

| 文件 | 範圍 | 狀態 |
|---|---|---|
| `ai-integration-plan.md` | Phase 0–4：把後端資料**串接到** AI（解決「AI 收不到任何資料」） | ✅ 完成 |
| **本文件** | Phase 5–10：把 AI 資料管線**架構化**（解決「加新欄位不可擴展」） | 草案 |

### E. 變更歷史

| 版本 | 日期 | 作者 | 變更 |
|---|---|---|---|
| v1 草案 | 2026-04-28 | Claude (with @chun) | 初稿（10 章、1064 行） |
| **v2 修訂** | 2026-04-28 | Claude (with @chun) | 經 3 個 agent（基礎設施 / 端對端 / 風險審查）並行 review 後補：(1) §1.4 架構審查發現 — 5 大 HIGH/CRITICAL 風險 + 3 hidden gotchas；(2) §3.3 TTFT 取捨設計（對齊 `backend-tasks.md:B15`）；(3) §4.1.2 加 `kind: computed` 設計（CrCl 範例）；(4) §4.1.3/4.1.4 三類 fields 對照與 tool↔registry 規則；(5) §4.3.5 ToolResult envelope + JSON Schema adapter；(6) §4.4.3 Migration 071/072 含 backfill SQL + NULL 兼容；(7) §5.1 加 P0 前置 + P5/P6 並行 + P8 提前 + P9 拆 P9a/P9b；(8) §5.2 加 Phase 0 交付；(9) §5.3 風險表擴充至 R1–R14；(10) §5.4 快速版路徑（解 I-01 燃眉）；(11) §6.0 Feature flag framework；(12) §7.2 frontend coordination；(13) §9 加 Q8–Q13。**時程從 7–8 週修為 8–10 週**。 |

### F. v2 審查報告摘要

#### F.1 三 agent 驗證結論

| Agent | 角度 | 結論 |
|---|---|---|
| A | 後端基礎設施可行性 | 多數 GO（Pydantic v2、pgvector、test fixture 齊備）；3 個 hidden gotchas（lazy client error、JSON Schema adapter、JSONB 內部版本化）|
| B | I-01 端對端能否解 | **❌ NO** — plan 是 roadmap 不是解法；資料層 OK（weight 68.5kg、eGFR 134.7 都在 DB）但 tool 層、judge.py、tool-aware system prompt 全部 0 → 1 |
| C | 風險與隱藏阻礙 | **❌ Yes-with-critical-revisions** — 5 大 HIGH/CRITICAL 風險、3 個 phase 嚴重低估、phase 順序錯排、違反 backend session scope |

#### F.2 v2 已處理 / 未處理 對照

| 議題 | 來源 Agent | v2 處理位置 |
|---|---|---|
| Feature flag 不存在 | C | §6.0、§5.2 P0 |
| TTFT vs B15 矛盾 | C | §3.3、§9 Q8 |
| ai_sessions backfill | C | §4.4.3 |
| Computed/virtual fields | B | §4.1.2、§4.1.3、§4.1.4 |
| RAG 資料源外部依賴 | C | §5.1 P9a/P9b 拆分 |
| Backend scope 違規 | C | §7.2 Frontend Coordination |
| 時程低估 | C | §1.4.3、§5.1 |
| Phase 順序錯誤 | C | §1.4.4、§5.1.1 依賴圖 |
| Hidden gotchas G1–G3 | A | §4.3.5、§4.4.3 |
| Other TASK_PROMPTS 升級 | C | §9 Q10（標為 future P11） |
| Snapshot meta-awareness 缺 | B | §4.5（v1 已有，v2 強化）|

#### F.3 強烈建議

**走快速版 §5.4 先上線**（P0 + P5-Lite + P8，2–3 週）解 I-01；完整 plan 等 B15 完成、且資源到位再啟動 P7。


---

**End of document.**
