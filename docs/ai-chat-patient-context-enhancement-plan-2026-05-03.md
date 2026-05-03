# AI 對話助手病患資料讀取強化計畫

> 日期：2026-05-03
> 範圍：AI 問答 `/ai-chat` 與病人詳情頁「對話助手」
> 目標：讓 LLM 取得足夠且可追溯的病患臨床背景，同時避免把所有病歷全文無差別塞進 prompt。
> 後續追蹤：[`ai-chat-patient-context-followup-tasks-2026-05-03.md`](ai-chat-patient-context-followup-tasks-2026-05-03.md)
> Tool loop 決策：[`ai-chat-tool-loop-decision-2026-05-03.md`](ai-chat-tool-loop-decision-2026-05-03.md)（決定暫不做 F4，由 M1 metric 自動收集觸發訊號）
> **進度**：Phase 1-7 已上 prod（commit chain `aa116ac8c..c2ef77505`，2026-05-03 部署）；Phase 8 標記不做；前端 follow-up F1/F2/F3 + 自動 metric M1 全部上線。

## 1. 目前狀態

目前前端送出對話時只帶 `patientId`、`sessionId`、`message`，後端在 `/ai/chat/stream` 依 `patientId` 從資料庫查資料，組成 `Clinical Snapshot` 後放進 LLM system prompt。

### 1.1 目前 system prompt snapshot 已讀取（每輪都送）

- 病患基本資料：姓名、年齡、性別、床號、診斷、ICU 天數、呼吸器天數、插管狀態、DNR、過敏、警示。
- 最新生命徵象：體溫、心跳、呼吸速率、血壓、MAP、SpO2、CVP。
- 最新呼吸器設定：mode、FiO2、PEEP、tidal volume、PIP、compliance。
- 最新檢驗與 24 小時趨勢：腎功能、電解質、肝功能、CBC、凝血、發炎指標、血氣、lactate。
- 活動中用藥：`status == active` 的藥名、劑量、頻次、途徑，並依鎮靜、止痛、神肌、升壓劑、抗感染、外院/自備等分類。
- 自動重複用藥警示：critical / high / moderate，最多列 10 筆。
- 近期影像/報告：最新 3 筆 impression，沒有 impression 時截取 body text 前 100 字。
- 臨床評分：Pain、RASS。
- **【資料狀態】各區塊最後更新時間 + 缺口提示**（`aa116ac8c`，Phase 1）。
- **【腎功能/給藥摘要】Cockcroft-Gault CrCl + 需腎調整 active meds**（`aa116ac8c`，Phase 2）。
- **【用藥安全摘要】重複用藥 + 過敏衝突 + QT/出血/腎毒/CNS 堆疊**（`ee3469cd8`，Phase 3）。

### 1.2 依問題關鍵字預取（本輪 user message 才注入，不污染 system prompt）

由 `app/services/ai_question_prefetch.py:build_question_prefetch_context` 處理：

- **微生物培養 + susceptibility**（最近 14 天）— 命中 culture/抗生素/敗血/VAP/UTI 等關鍵字觸發（`e95634ac9`，Phase 4）。
- **最近 72 小時用藥變更**（started/discontinued/dose/route/frequency changed）— 命中 started/stopped/72h/dose change 等關鍵字觸發（`5400296ed`，Phase 5）。
- **藥師建議歷史搜尋**（限 admin/pharmacist；pharmacist 只看自己寫的；每次查寫 audit log）— 命中藥師建議/我之前寫過 等關鍵字觸發（`e0b7f1132`，Phase 6）。
- **影像/診斷報告完整內文**（最近 14 天）— 命中 報告/CT/CXR/影像 等關鍵字觸發（`c2ef77505`，Phase 7）。

### 1.3 仍未放進 snapshot 也未提供 tool

- MAR / 實際給藥紀錄。
- 留言板、團隊聊天室全文（`docs/ai-chat-patient-context-followup-tasks-2026-05-03.md` F5 標記不做）。
- 完整病歷紀錄全文、完整歷史檢驗趨勢、完整停用藥歷史。

### 1.4 架構現況

- `/ai/chat/stream` 仍是一次性組 prompt + `call_llm_stream()`，**沒有正式 LLM tool calling / agent loop**。
- Phase 4-7 的「依問題查資料」走 §3.2 過渡方案：後端用關鍵字判斷意圖，預取資料附到本輪 user message。
- 升級成正式 tool loop 是後續 follow-up（`docs/ai-chat-patient-context-followup-tasks-2026-05-03.md` F4），等 prod 用一陣子看 prefetch 漏什麼類型的問題再做。

## 2. 設計原則

1. 核心 snapshot 要小而準  
   每次都給 LLM 的資料只放「現在照護決策最需要」的資訊。

2. 長資料改成 tool 查詢  
   完整報告、藥師建議歷史、長期趨勢、留言紀錄不要預設塞進 system prompt，改成 LLM 依問題查詢。

3. 一定要帶資料時間與缺口  
   LLM 應該知道每段資料的最後更新時間、來源、以及缺哪些資料，避免用過期資料推論。

4. 避免不必要個資  
   LLM 不一定需要姓名與 MRN；UI 可以顯示，但 prompt 內應優先使用床號、年齡、性別、臨床資訊。

5. 臨床建議必須能回溯依據  
   回答若引用用藥、檢驗、培養、影像或藥師建議，應能指出資料區塊與時間。

## 3. 架構前置決策

Phase 3 以後若要支援「依問題查資料」，需要先選一種架構。

> **2026-05-03 決策**：採用 §3.2 **過渡方案（後端關鍵字預取）**。Phase 4-7 全部以此方式實作（`app/services/ai_question_prefetch.py`）。升級為 §3.1 正式 tool loop 列為後續 follow-up（見 `ai-chat-patient-context-followup-tasks-2026-05-03.md` F4），觸發條件為「prod 累積 1-2 週使用後實際看到關鍵字漏掉的問題類型」。

### 3.1 建議方案：LLM tool loop

新增 AI tool registry 與 agent loop，讓 LLM 可以在回答前呼叫受控工具。

優點：

- 抗生素問題才查 culture。
- 藥師歷史問題才查 pharmacy advice。
- 長報告不會每次塞進 system prompt。

缺點：

- 改動範圍較大，需要調整 `backend/app/routers/ai_chat.py` 與 `backend/app/llm.py` 串流流程。
- 需要新增 tool call audit log。
- 需要測試多輪 tool call 與失敗 fallback。

### 3.2 過渡方案：後端意圖判斷加資料預取

在正式 tool loop 前，可先由後端根據使用者問題關鍵字預先查資料，再把資料附到本輪 user message。

適合先做：

- 抗生素、culture、de-escalation、感染相關問題預取 culture。
- 「之前建議」「哪一床」「藥師建議」相關問題預取藥師建議搜尋。
- 「影像」「報告」「CT」「CXR」相關問題預取近期報告。

限制：

- 靠規則判斷，彈性較差。
- 容易漏掉語意相近但未命中關鍵字的問題。
- 後續仍建議改成正式 tool loop。

## 4. 建議新增給 LLM 的資料

### 4.1 第一優先：每次 snapshot 都應補強

#### A. 資料新鮮度與缺口

目的：避免 LLM 不知道資料是否過期。

建議內容：

- `snapshot_taken_at`
- 各資料區塊最後更新時間：
  - patient
  - lab_data
  - vital_signs
  - ventilator_settings
  - medications
  - diagnostic_reports
  - culture_results
  - clinical_scores
  - pharmacy_advices
- 缺資料提示：
  - 無生命徵象
  - 無呼吸器資料
  - 無 MAR
  - 無培養資料
  - 無近期檢驗

建議呈現：

```text
【資料狀態】
快照時間: 2026-05-03 14:20（台北）
檢驗: 2026-05-03 08:12 | 用藥: 2026-05-03 13:55 | 生命徵象: 無資料
缺口: 無 MAR / 無微生物培養資料
```

#### B. 腎功能給藥摘要

目的：藥物建議常需要依腎功能調整，單看 Cr/eGFR 不夠。

建議內容：

- Scr、eGFR、BUN。
- 若有 age / sex / weight / Scr，計算 Cockcroft-Gault CrCl。
- 若缺體重或 Scr，明確寫無法計算原因。
- 標記 active meds 中 `kidney_relevant == true` 或常見需腎調整藥。

建議呈現：

```text
【腎功能/給藥摘要】
Scr 1.8 mg/dL | eGFR 32 | CrCl 約 28 mL/min（Cockcroft-Gault，使用體重 60 kg）
需注意腎調整藥: vancomycin, meropenem, enoxaparin
```

#### C. 用藥安全摘要

目的：目前有重複用藥，但缺交互作用、過敏衝突、QT/出血/腎毒性等整合視角。

建議內容：

- 重複用藥警示。
- 重大交互作用 X/D 或 high-risk。
- 藥物過敏衝突。
- QT 延長堆疊。
- 出血風險堆疊。
- 腎毒性堆疊。
- CNS depressant / 鎮靜止痛堆疊。

建議呈現：

```text
【用藥安全摘要】
重複用藥: 1 筆 high - PPI x PPI
重大交互作用: warfarin + fluconazole（出血風險）
腎毒性堆疊: vancomycin + piperacillin/tazobactam
```

### 4.2 第二優先：依問題查詢，但要先做 tool 或後端預取

#### D. 微生物培養與感受性

目的：抗生素建議若沒有 culture / susceptibility，LLM 容易只靠 WBC、CRP 猜測。

建議新增 tool：

- `get_cultures(patient_id, days=14)`

建議回傳：

- specimen
- collected_at
- reported_at
- organism
- isolates
- susceptibility
- q_score
- result
- latest_only / all_recent

適用問題：

- 抗生素 de-escalation
- 發燒/感染來源判斷
- VAP / UTI / bloodstream infection
- culture-directed therapy

#### E. 最近 72 小時用藥變更

目的：active meds 只能看到現在有什麼，看不到剛停、剛加、剛調劑量的脈絡。

建議新增 tool：

- `get_medication_changes(patient_id, hours=72)`

建議回傳：

- started
- discontinued
- on_hold
- dose_changed
- route_changed
- frequency_changed

適用問題：

- 為什麼病人狀況變差
- 是否剛停抗生素/升壓劑/鎮靜止痛
- 藥物副作用與時間關聯

#### F. 藥師建議歷史

目的：使用者可能忘記「之前給過哪床、哪個建議」，這應該能查，而不是靠人工回床翻找。

建議新增 tool：

- `search_pharmacy_advice_history(query, patient_id?, days?, category?, accepted?)`
- `get_patient_pharmacy_advice_history(patient_id, days=14)`

建議回傳：

- patient_id
- bed_number
- patient_name masked
- advice_id
- category
- code
- content
- linked_medications
- accepted
- created_at / updated_at
- pharmacist_id / pharmacist_name

權限：

- `admin`：可查全院或全部紀錄。
- `pharmacist`：預設只查自己建立的紀錄；若要查所有藥師紀錄，需另訂權限。
- 其他角色：不開放跨病人搜尋，可只在單一病人頁顯示摘要或完全不給。

適用問題：

- 「我之前建議哪一床停 morphine？」
- 「我今天寫過哪些 vancomycin 建議？」
- 「這床之前藥師有沒有建議過腎調整？」

#### G. 完整報告查詢

目的：snapshot 只放最新 3 筆 impression，但有時需要完整報告。

建議新增 tool：

- `get_diagnostic_reports(patient_id, days=14, type?)`

規則：

- snapshot 只保留短摘要。
- LLM 需要影像細節時才查完整報告。
- 回答必須標明報告日期與 exam name。

### 4.3 暫時不建議預設送進 prompt

以下資料不應每次預設送進 LLM：

- 團隊聊天室全文。
- 病人留言板全文。
- 所有病歷紀錄全文。
- 所有歷史檢驗完整列表。
- 所有停用藥完整歷史。
- 所有影像報告 body text。

原因：

- token 成本高。
- 容易混入過期資訊。
- 容易受到自由文字 prompt injection 影響。
- 對大多數臨床問題不是必要資料。

若真的需要，應建立受控 tool，並限制時間範圍、筆數、權限與審計。

## 5. 修改步驟

### Phase 0：決定 tool 架構　✅ 完成（過渡方案）

目的：避免文件後半段寫 tool，但實作時發現現有 `/ai/chat/stream` 不支援 tool calling。

後端：

1. 確認採用正式 LLM tool loop，或先做後端意圖判斷加資料預取。
2. 若採用正式 tool loop：
   - 新增 tool registry。
   - 新增 tool handler envelope：`ok / no_data / denied / error`。
   - 新增 tool call audit log。
   - 調整 SSE 串流流程，支援 tool call 後再產生最終回答。
3. 若採用過渡方案：
   - 在 `/ai/chat/stream` 進 LLM 前依關鍵字預取資料。
   - 預取資料只附加到本輪 user message，不寫入 `ai_messages.content`。
   - 保留日後替換成 tool loop 的 service 邊界。

測試：

1. tool 回傳 `no_data` 時 LLM 不應編造資料。
2. tool 權限不足時不可洩漏資料是否存在。
3. 本輪預取資料不得污染後續歷史訊息。

驗收：

- 文件中 Phase 3 到 Phase 6 的 tool 類功能，有明確可落地的執行路徑。

### Phase 1：補資料狀態與腎功能摘要　✅ 完成（`aa116ac8c`）

目的：低風險、高臨床價值，先讓 LLM 知道資料時間與腎功能限制。

後端：

1. 在 `backend/app/services/patient_context_builder.py` 新增 `build_data_freshness_section()`。
2. 查各表最新 timestamp：
   - `lab_data.timestamp`
   - `vital_signs.timestamp`
   - `ventilator_settings.timestamp`
   - `medications.updated_at`
   - `diagnostic_reports.exam_date`
   - `clinical_scores.timestamp`
   - `culture_results.collected_at` 或 `culture_results.reported_at`
3. 新增 `build_renal_dosing_section()`。
4. 實作 CrCl 計算：
   - Cockcroft-Gault。
   - 需要 age、sex、weight、Scr。
   - 缺任一資料時輸出「無法計算」原因。
5. 在 snapshot 中加入：
   - `【資料狀態】`
   - `【腎功能/給藥摘要】`

測試：

1. 新增 `backend/tests/test_services/test_patient_context_builder_freshness.py`。
2. 測試資料完整時會顯示更新時間。
3. 測試缺 vital/MAR/culture 時會顯示缺口。
4. 測試 CrCl 正確計算。
5. 測試缺體重或 Scr 時不亂算。

驗收：

- AI 第一輪回答能看到資料時間。
- 問腎功能調整時，LLM 有 CrCl 或明確知道 CrCl 無法計算。

### Phase 2：補用藥安全摘要　✅ 完成（`ee3469cd8`）

目的：把藥師工作站已有的用藥安全資訊轉成 LLM 可讀摘要。

後端：

1. 整理目前重複用藥偵測輸出，保留 critical/high/moderate。
2. 若現有交互作用 API 可用，建立 snapshot 專用 formatter：
   - 只列重大交互作用。
   - 每類最多 5 筆。
3. 新增藥物過敏衝突檢查：
   - 比對 `patients.allergies` 與 active meds。
4. 新增高風險堆疊摘要：
   - QT prolongation。
   - bleeding risk。
   - nephrotoxic stacking。
   - CNS depressant stacking。
5. 在 snapshot 中加入 `【用藥安全摘要】`。

測試：

1. 重複用藥有警示時會輸出。
2. 無警示時不製造假警示。
3. 過敏與 active med 撞到時會輸出。
4. 大量警示會截斷並顯示「另有 N 筆」。

驗收：

- 問「這床用藥有沒有問題」時，LLM 能先提重大風險。
- 問單一藥物時，不會忽略已存在的重複用藥或交互作用。

### Phase 3：新增微生物培養 tool 或後端預取　✅ 完成（`e95634ac9`，過渡方案）

目的：讓抗生素建議能引用 culture / susceptibility。

後端：

1. 確認 `culture_results` model 與資料欄位。
2. 新增 service：
   - `get_recent_cultures(patient_id, days=14)`
3. 依 Phase 0 決策，新增 AI tool handler 或後端預取 handler：
   - `get_cultures`
4. tool 回傳需包含：
   - specimen
   - collected_at
   - reported_at
   - organism
   - isolates
   - susceptibility
   - q_score
   - result
5. 修改 LLM system prompt：
   - 抗生素、感染、de-escalation 問題應優先查 `get_cultures`。

測試：

1. 有培養資料時 tool 回傳正確。
2. 無培養資料時回傳 structured no_data。
3. 權限不符或病人不存在時不可洩漏資料。

驗收：

- 問抗生素調整時，LLM 會根據 culture 給建議。
- 無培養資料時，LLM 會明確說「沒有看到培養資料」。

### Phase 4：新增用藥變更 tool 或後端預取　✅ 完成（`5400296ed`，過渡方案）

目的：補足 active meds 看不到的時間脈絡。

後端：

1. 確認 medications 是否有足夠欄位判斷新增、停用、hold、調劑量。
2. 若目前沒有 medication history，先以 `updated_at/start_date/end_date/status` 做第一版。
3. 依 Phase 0 決策，新增 tool 或後端預取 handler：
   - `get_medication_changes(patient_id, hours=72)`
4. 回傳分組：
   - started
   - discontinued
   - on_hold
   - dose_changed
   - route_changed
   - frequency_changed

測試：

1. 最近新增藥物會出現在 started。
2. 最近停用藥物會出現在 discontinued。
3. 無資料時 structured no_data。

驗收：

- 問「這 2 天有改什麼藥」時，不需要人工翻用藥頁。
- 問病況變化時，LLM 能把近期用藥改變納入推理。

### Phase 5：新增藥師建議歷史搜尋　✅ 後端完成（`e0b7f1132`，過渡方案）｜⚠ 前端 deep link 未做（見 follow-up F3）

目的：解決「我之前給過的用藥建議寫在哪一床」這類跨病人搜尋需求。

後端：

1. 新增藥師建議搜尋 service：
   - `search_pharmacy_advice_history()`
2. 搜尋欄位：
   - bed number
   - patient name
   - advice content
   - medication name
   - category/code
3. 依 Phase 0 決策，新增 AI tool 或後端預取 handler：
   - `search_pharmacy_advice_history`
   - `get_patient_pharmacy_advice_history`
4. 權限：
   - admin 可查全部。
   - pharmacist 預設查自己建立的紀錄。
   - 其他角色不開放跨病人搜尋。
5. 搜尋結果必須遮蔽不必要個資。
6. 每次查詢寫 audit log。

前端：

1. 在 `/ai-chat` 若使用者是 pharmacist/admin，可支援這類問題。
2. 單一病人頁對話助手可自動提供該病人最近 14 天藥師建議摘要。
3. 回答中附上可點回的 deep link：
   - `/pharmacy/advice-statistics`
   - 或病人頁留言/紀錄位置。

測試：

1. pharmacist 只能查自己的紀錄。
2. admin 可查全部。
3. nurse/doctor 不可跨病人搜尋藥師建議。
4. 搜尋床號、藥名、內容都可找到結果。
5. 刪除或編輯後搜尋結果同步更新。

驗收：

- 使用者問「我之前給過 vancomycin 建議在哪床？」能查到。
- 使用者問「這床之前有沒有藥師建議？」能列出近期摘要。

### Phase 6：完整報告與長資料 tool 化或後端預取　✅ 完成（`c2ef77505`，過渡方案）

目的：保留查詢能力，但不污染核心 prompt。

後端：

1. 新增 `get_diagnostic_reports(patient_id, days=14, type?)`。
2. 規定回傳上限與截斷策略。
3. 將完整 body text 放 tool，不放核心 snapshot。

測試：

1. tool 回傳最新報告。
2. 報告太長時有截斷提示。
3. 回答引用報告時包含日期與 exam name。

驗收：

- 問影像細節時可以查完整報告。
- 一般問題不會因完整報告把 prompt 撐大。

## 6. 建議檔案修改清單

後端主要檔案：

- `backend/app/services/patient_context_builder.py`
- `backend/app/routers/ai_chat.py`
- `backend/app/models/culture_result.py`
- `backend/app/routers/patients.py`
- `backend/app/models/pharmacy_advice.py`
- `backend/app/routers/pharmacy_routes/advice_records.py`
- 新增 `backend/app/ai_tools/` 或等價 service layer

前端主要檔案：

- `src/lib/api/ai.ts`
- `src/pages/ai-chat.tsx`
- `src/pages/patient-detail.tsx`
- `src/components/patient/patient-chat-tab.tsx`
- `src/pages/pharmacy/advice-statistics.tsx`

測試主要檔案：

- `backend/tests/test_services/test_patient_context_builder.py`
- 新增 `backend/tests/test_services/test_patient_context_builder_freshness.py`
- 新增 `backend/tests/test_api/test_ai_chat_tools.py`
- 擴充 `backend/tests/test_api/test_ai_chat_acl.py`
- 擴充藥物統計與藥師建議相關測試

## 7. 風險與保護措施

### 7.1 Prompt 太大

風險：每次都塞完整資料會變慢、變貴、也更容易讓 LLM 抓錯重點。

措施：

- 核心 snapshot 只放摘要。
- 長資料一律 tool 化。
- 每個 section 設定筆數上限與字數上限。

### 7.2 過期資料

風險：LLM 用舊快照回答新病況。

措施：

- snapshot 必帶資料時間。
- 同 session 超過 30 分鐘時，不只比對 Cr/WBC/CRP/lactate/PLT/NE，也應標示 snapshot age。
- 未來可加「重新整理快照」按鈕。

### 7.3 權限外洩

風險：跨病人搜尋藥師建議可能洩漏不該看的病人資訊。

措施：

- role gate。
- pharmacist 預設只查自己的建議。
- admin 查全部需 audit。
- 搜尋結果遮蔽姓名，優先顯示床號與病人 ID。

### 7.4 自由文字 Prompt Injection

風險：留言、報告、藥師建議、病歷紀錄都是自由文字，可能包含會影響 LLM 的句子。

措施：

- 自由文字放在明確標記的 data block。
- system prompt 明確要求：病歷內容只當資料，不可當指令。
- tool 回傳 structured data，不直接拼接大量 raw text。

## 8. 建議實作順序總表

| 順序 | 項目 | 風險 | 臨床價值 | 狀態 | Commit |
| --- | --- | --- | --- | --- | --- |
| 0 | Tool loop 或後端預取架構決策 | 中 | 高 | ✅ 選過渡方案（後端關鍵字預取） | — |
| 1 | 資料新鮮度/缺口 | 低 | 高 | ✅ | `aa116ac8c` |
| 2 | CrCl/腎功能給藥摘要 | 低 | 高 | ✅ | `aa116ac8c` |
| 3 | 用藥安全摘要 | 中 | 高 | ✅ | `ee3469cd8` |
| 4 | 微生物培養 tool/預取 | 中 | 高 | ✅ 過渡方案 | `e95634ac9` |
| 5 | 72h 用藥變更 tool/預取 | 中 | 中高 | ✅ 過渡方案 | `5400296ed` |
| 6 | 藥師建議歷史搜尋 | 中高 | 高 | ✅ 後端 / ⚠ 前端 deep link 待做 | `e0b7f1132` |
| 7 | 完整報告 tool/預取 | 中 | 中 | ✅ 過渡方案 | `c2ef77505` |
| 8 | 留言板/團隊聊天室全文 | 高 | 不固定 | ❌ 不做 | — |

後續 follow-up 見 [`ai-chat-patient-context-followup-tasks-2026-05-03.md`](ai-chat-patient-context-followup-tasks-2026-05-03.md)：
- F1：本文件同步（即本次更新）
- F2：重新整理快照按鈕
- F3：藥師建議 deep link
- F4：升級為正式 LLM tool loop（等 prod 累積使用後決定）

## 9. 提交、Push 與部署細節

### 9.1 只提交本文件

目前工作目錄可能有其他未提交或未追蹤檔案。提交這份計畫時只 stage 本文件，不要把 datamock 刪除、其他 docs、reports、local folder 一起放進 commit。

建議命令：

```bash
git status -sb
git branch --show-current
git add docs/ai-chat-patient-context-enhancement-plan-2026-05-03.md
git diff --cached --stat
git diff --cached -- docs/ai-chat-patient-context-enhancement-plan-2026-05-03.md
git commit -m "Document AI chat patient context enhancement plan"
```

### 9.2 Push 到 GitHub PR branch

若沿用目前分支 `feature/advice-history-management`：

```bash
git push origin feature/advice-history-management
```

若另開新分支：

```bash
git checkout -b docs/ai-chat-patient-context-plan
git add docs/ai-chat-patient-context-enhancement-plan-2026-05-03.md
git commit -m "Document AI chat patient context enhancement plan"
git push -u origin docs/ai-chat-patient-context-plan
```

### 9.3 合併到 main 後的部署

本文件是 docs-only，不會觸發需要驗證的前端或後端 runtime 行為；推到 PR branch 即可供 review。

若後續開始實作：

- 只有後端變更：merge 到 `main` 後推 `personal main`，Railway 會自動部署。
- 只有前端變更：merge 到 `main` 後推 `railway main`，Vercel 會自動 build。
- 前後端都有變更：兩個 remote 都要 push。

部署命令範例：

```bash
git checkout main
git pull origin main
git merge <feature-branch> --no-edit
git push personal main
git push railway main
```

注意：pre-commit hook 禁止直接 commit 到 `main`，所有修改應先在 feature branch 完成。

## 10. Definition of Done

完成後至少要達到：

1. ✅ LLM 回答能明確知道資料時間與缺口。
2. ✅ 問腎功能或腎調整時，有 CrCl 或明確缺資料原因。
3. ✅ 問用藥安全時，能看到重複用藥、重大交互作用、過敏衝突與高風險堆疊。
4. ✅ 問抗生素時，能查培養與感受性；沒有資料時明確說明。
5. ✅ 問「我之前寫過哪床用藥建議」時，pharmacist/admin 可以查到藥師建議歷史。
6. ✅ 所有跨病人查詢都有權限限制與 audit log。
7. ✅ 核心 snapshot 不因長資料膨脹到不可控（Phase 4-7 走 user message prefetch，不進 system prompt）。

**Out of scope（轉 follow-up）**：
- F2 重新整理快照按鈕（覆蓋 §7.2「snapshot age 提示」的剩餘缺口）。
- F3 藥師建議 deep link（覆蓋 Phase 5 §5 frontend 的 deep link 需求）。
- F4 升級正式 LLM tool loop（替代 §3.2 過渡方案的長期路徑）。
- 計畫表 Phase 8 留言板/團隊聊天室全文（明確不做）。

**Prod 真人驗證仍未做**：見 follow-up V1（5 case 跑一輪）+ V2（4 個權限 case）。
