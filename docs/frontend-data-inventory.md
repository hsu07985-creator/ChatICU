# ChatICU 前端資料完整盤點

> 文件產生日期：2026-02-15
> 版本：v1.0
> 涵蓋範圍：所有前端頁面的資料來源分類、角色權限差異

---

## 目錄

1. [資料來源分類說明](#1-資料來源分類說明)
2. [依頁面/分頁盤點](#2-依頁面分頁盤點)
3. [依角色盤點](#3-依角色盤點)
4. [AI 功能現況與缺口](#4-ai-功能現況與缺口)

---

## 1. 資料來源分類說明

| 圖示 | 分類 | 說明 |
|------|------|------|
| **[DB]** | 資料庫直接顯示 | 由後端 API 取得，原樣呈現在前端（數值、文字、時間戳） |
| **[AI]** | AI 生成內容 | 經 LLM 處理後產生的文字（摘要、翻譯、建議） |
| **[RULE]** | 規則引擎計算 | 由純邏輯規則計算（CKD 分期、異常值判定） |
| **[FE]** | 前端本地計算 | 前端 JavaScript 即時計算（住院天數、異常閾值判定） |
| **[HARD]** | 寫死/Hardcode | 目前寫死在前端程式碼中，未從 API 取得 |
| **[TPL]** | 模板 | 預定義模板，使用者填入內容 |

---

## 2. 依頁面/分頁盤點

### 2.1 Dashboard 總覽頁 (`/dashboard`)

所有角色均可看到完整內容。

| 資料 | 來源 | 欄位 | 說明 |
|------|------|------|------|
| 病患姓名 | **[DB]** | `patient.name` | Patient API |
| 床號 | **[DB]** | `patient.bedNumber` | Patient API |
| 年齡 | **[DB]** | `patient.age` | Patient API |
| 入院診斷 | **[DB]** | `patient.diagnosis` | Patient API |
| 入院日期 | **[DB]** | `patient.admissionDate` | Patient API |
| 住院天數 | **[FE]** | `now - admissionDate` | 前端即時計算 |
| 插管狀態 | **[DB]** | `patient.intubated` | Badge 顯示 |
| S/A/N 藥物 | **[DB]** | `patient.sanSummary` | 鎮靜/止痛/NMB 藥物名稱 |
| 警示訊息 | **[DB]** | `patient.alerts[]` | 紅色 Badge |
| 最後更新 | **[DB]** | `patient.lastUpdate` | 時間戳 |

---

### 2.2 病人清單頁 (`/patients`)

| 資料 | 來源 | 欄位 | 說明 |
|------|------|------|------|
| 床號 | **[DB]** | `bedNumber` | 表格欄位 |
| 病歷號碼 | **[DB]** | `medicalRecordNumber` | 表格欄位 |
| 姓名 | **[DB]** | `name` | 表格欄位 |
| 性別 | **[DB]** | `gender` | 男/女 |
| 年齡 | **[DB]** | `age` | 表格欄位 |
| 主治醫師 | **[DB]** | `attendingPhysician` | 彩色 Badge（內科藍/外科橙） |
| 入院診斷 | **[DB]** | `diagnosis` | 文字截斷 |
| ICU 入院日期 | **[DB]** | `icuAdmissionDate` | 含住院天數 |
| ICU 住院天數 | **[FE]** | `now - icuAdmissionDate` | 前端計算 |
| 呼吸器天數 | **[DB]** | `ventilatorDays` | 紫色 Badge |
| DNR 狀態 | **[DB]** | `hasDNR` | 有/無 |
| 隔離狀態 | **[DB]** | `isIsolated` | 隔離/無 |
| 插管狀態 | **[DB]** | `intubated` | 插管中/未插管 |
| 未讀留言 | **[DB]** | `hasUnreadMessages` | 紅色圖示 |
| 科別底色 | **[FE]** | `department` | 內科藍底/外科橙底 |

---

### 2.3 病患詳情頁 (`/patient/:id`)

#### 2.3.1 頁首資訊條（所有角色可見）

| 資料 | 來源 | 說明 |
|------|------|------|
| 床號 | **[DB]** | 圓形頭像 |
| 姓名 | **[DB]** | 大字標題 |
| 插管 Badge | **[DB]** | `patient.intubated` |
| 住院天數 | **[FE]** | `now - admissionDate` |

#### 2.3.2 對話助手 Tab（所有角色可見）

| 資料 | 來源 | 說明 |
|------|------|------|
| 使用者訊息 | 使用者輸入 | 右對齊紫色氣泡 |
| AI 回覆 | **[AI]** | 左對齊白色氣泡，呼叫 `POST /ai/chat` |
| 參考依據 (citations) | **[AI]** | RAG 檢索結果，可展開/收合 |
| 對話記錄列表 | **[DB]** | `GET /ai/sessions`，左側面板 |
| 對話標題 | **[DB]** | session.title |
| 對話日期/時間 | **[DB]** | session.createdAt |
| 檢驗快照 | — | （未實作；目前不存 session 快照） |

> ✅ 現況：`POST /ai/chat` 在有 `patientId` 時會查詢該病患完整臨床資料（檢驗、生命徵象、用藥、呼吸器）並注入 LLM；同時支援多輪對話 history（含自動摘要壓縮）。前端會顯示 `safetyWarnings` 與 `requiresExpertReview`。

#### 2.3.3 Progress Note 輔助（已移除：避免與「病歷記錄」重複入口）

- 原先位於「對話助手」Tab 下方，現已移除。
- 目前入口：病歷記錄 Tab → Progress Note → `POST /api/v1/clinical/polish`（`polish_type=progress_note`）。

#### 2.3.4 留言板 Tab（所有角色可見）

| 資料 | 來源 | 說明 |
|------|------|------|
| 作者姓名 | **[DB]** | `message.authorName` |
| 作者角色 | **[DB]** | `message.authorRole` → 圖示（醫/護/藥/管） |
| 留言類型 | **[DB]** | general(藍) / medication-advice(綠) / alert(紅) |
| 留言內容 | **[DB]** | `message.content` |
| 時間戳 | **[DB]** | `message.timestamp` |
| 關聯藥品 | **[DB]** | `message.linkedMedication` |
| 已讀/未讀 | **[DB]** | `message.isRead` |
| 未讀數量 | **[FE]** | 前端 filter 計算 |

角色差異：
- **藥師**：額外顯示「標記為用藥建議」按鈕
- **其他角色**：該按鈕 disabled

#### 2.3.5 病歷記錄 Tab

| 資料 | 來源 | 角色限定 | 說明 |
|------|------|---------|------|
| Progress Note 草稿 | 使用者輸入 | 醫師/管理員 | 中文草稿 |
| AI 修飾後 Note | **[AI]** | 醫師/管理員 | 呼叫 `POST /api/v1/clinical/polish`（`progress_note`） |
| 用藥建議草稿 | 使用者輸入 | 藥師 | 中文草稿 |
| AI 修飾後建議 | **[AI]** | 藥師 | 呼叫 `POST /api/v1/clinical/polish`（`medication_advice`） |
| 護理記錄草稿 | 使用者輸入 | 護理師 | 可用模板 |
| AI 檢查/修飾結果 | **[AI]** | 護理師 | 呼叫 `POST /api/v1/clinical/polish`（`nursing_record`） |
| 護理模板 | **[TPL]** | 護理師 | 一般交班/鎮靜評估/管路評估/傷口護理 |
| 歷史記錄列表 | **[FE]** | 依角色過濾 | 目前存在前端 state，未持久化 |

> 補充：病歷記錄的「AI 修飾」會回傳 `safetyWarnings`，前端以獨立警示區塊顯示（不混入正文）。

#### 2.3.6 檢驗數據 Tab（所有角色可見）

**生命徵象 Vital Signs：**

| 資料 | 來源 | 單位 | 異常判定 |
|------|------|------|---------|
| 呼吸速率 | **[DB]** | rpm | **[FE]** <12 或 >25 |
| 體溫 | **[DB]** | °C | **[FE]** <36 或 >37.5 |
| 血壓 | **[DB]** | mmHg | **[FE]** SBP <90 或 >140 |
| 心率 | **[DB]** | bpm | **[FE]** <60 或 >100 |
| SpO₂ | **[DB]** | % | **[FE]** <94 |
| EtCO₂ | **[DB]** | mmHg | **[FE]** >45 或 <35（選擇性） |
| CVP | **[DB]** | mmHg | **[FE]** >12 或 <2（選擇性） |
| ICP | **[DB]** | mmHg | **[FE]** >20（選擇性） |

**呼吸器設定（僅插管病人顯示）：**

| 資料 | 來源 | 單位 | 異常判定 |
|------|------|------|---------|
| 呼吸器模式 | **[DB]** | — | — |
| FiO₂ | **[DB]** | % | **[FE]** >60 |
| PEEP | **[DB]** | cmH₂O | **[FE]** >12 |
| 潮氣量 Vt | **[DB]** | mL | **[FE]** >500 |
| 設定 RR | **[DB]** | /min | — |
| PIP | **[DB]** | cmH₂O | **[FE]** >30（選擇性） |
| 平台壓 Pplat | **[DB]** | cmH₂O | **[FE]** >30（選擇性） |
| 肺順應性 | **[DB]** | mL/cmH₂O | **[FE]** <30（選擇性） |

**脫機評估 Weaning（僅插管病人顯示）：**

| 資料 | 來源 | 說明 |
|------|------|------|
| RSBI | **[DB]** | >105 紅色 / ≤105 綠色 |
| NIF | **[DB]** | >-25 紅色 / ≤-25 綠色 |
| 準備度分數 | **[DB]** | <70% 橙色 / ≥70% 綠色 |
| 脫機建議 | **[DB]** | 可以脫機 / 暫不脫機 Badge |

**檢驗值 Lab Data（50+ 項目）：**

| 分類 | 欄位 | 來源 | 異常判定 | 趨勢圖 |
|------|------|------|---------|--------|
| **電解質** | Na, K, Ca, freeCa, Mg | **[DB]** | **[DB]** isAbnormal | K(有), Na(有) |
| **血液學** | WBC, RBC, Hb, Hct, PLT | **[DB]** | **[DB]** isAbnormal | WBC, Hb, PLT(有) |
| **生化/炎症** | Alb, CRP, PCT, DDimer | **[DB]** | **[DB]** isAbnormal | Alb, CRP(有) |
| **血氣分析** | pH, PCO2, PO2, HCO3, Lactate | **[DB]** | **[DB]** isAbnormal | Lactate(有) |
| **肝腎功能** | AST, ALT, TBil, INR, BUN, Scr, eGFR, Clcr | **[DB]** | **[DB]** isAbnormal | BUN, Scr, eGFR(有) |
| **心臟標記**（選擇性） | TnT, CKMB, CK, NTproBNP | **[DB]** | **[DB]** isAbnormal | — |
| **血脂代謝**（選擇性） | TCHO, TG, LDLC, HDLC, UA, P | **[DB]** | **[DB]** isAbnormal | — |
| **其他**（選擇性） | HbA1C, LDH, NH3, Amylase, Lipase | **[DB]** | **[DB]** isAbnormal | — |
| **甲狀腺**（選擇性） | TSH, freeT4 | **[DB]** | **[DB]** isAbnormal | — |
| **荷爾蒙**（選擇性） | Cortisol | **[DB]** | **[DB]** isAbnormal | — |

每個檢驗項目結構：`{ value, unit, referenceRange, isAbnormal }`

趨勢圖來源：**[DB]** `GET /patients/{id}/lab-data/trends?days=7`

#### 2.3.7 用藥 Tab（所有角色可見）

| 資料 | 來源 | 說明 |
|------|------|------|
| 藥品名稱 | **[DB]** | `medication.name` |
| 劑量 + 單位 | **[DB]** | `dose` + `unit` |
| 頻率 | **[DB]** | `frequency` (q4h, daily, etc.) |
| 給藥途徑 | **[DB]** | `route` (IV, PO, etc.) |
| S/A/N 分類 | **[DB]** | `sanCategory` → 藍(S)/綠(A)/紫(N) Badge |
| PRN 標記 | **[DB]** | `prn` boolean |
| 適應症 | **[DB]** | `indication` |
| 藥物警告 | **[DB]** | `warnings[0]` |
| S/A/N 藥物分組 | **[FE]** | 前端 filter by sanCategory |

角色差異：
- **藥師/管理員**：額外顯示「藥師用藥建議」Widget（見 2.3.8）
- **其他角色**：不顯示

#### 2.3.8 藥師用藥建議 Widget（僅藥師/管理員可見）

| 資料 | 來源 | 說明 |
|------|------|------|
| 建議草稿輸入 | 使用者輸入 | 中文或英文 |
| AI 修飾後建議 | **[AI]** | 呼叫 `POST /api/v1/clinical/polish`（`pharmacy_advice`） |
| 建議分類代碼 | **[FE]** | 4 大類 23 個子代碼（建議處方/主動建議/建議監測/用藥適真性） |
| 醫師回應代碼 | **[FE]** | A-W 4 類 10 個代碼（Accept/Warning/Controversy/Adverse） |
| 關聯藥品 | **[DB]** | `linkedMedication`（可選） |

#### 2.3.9 病歷摘要 Tab（所有角色可見）

| 資料 | 來源 | 說明 |
|------|------|------|
| 年齡 | **[DB]** | `patient.age` |
| 性別 | **[DB]** | `patient.gender` |
| BMI | **[DB]** | `patient.bmi` |
| 身高 | **[DB]** | `patient.height` |
| 體重 | **[DB]** | `patient.weight` |
| 入院診斷 | **[DB]** | `patient.diagnosis` |
| 症狀列表 | **[DB]** | `patient.symptoms[]` |
| 風險與警示 | **[DB]** | `patient.alerts[]` |
 
> ✅ 已修正：性別/BMI/身高/體重/症狀改由後端病患資料顯示，不再為 hardcode。

---

## 3. 依角色盤點

### 3.1 醫師 (doctor)

| 頁面/功能 | 可見 | 特殊功能 |
|----------|------|---------|
| Dashboard 總覽 | 全部 | — |
| 病人清單 | 全部 | 無編輯權限 |
| 對話助手 | 全部 | — |
| 留言板 | 全部 | 一般留言（無用藥建議按鈕） |
| 病歷記錄 | Progress Note 類型 | 撰寫 + AI 修飾（`POST /api/v1/clinical/polish`） |
| 檢驗數據 | 全部 | 生命徵象 + 呼吸器 + 檢驗值 |
| 用藥 | 藥物列表 | 無藥師建議 Widget |
| 病歷摘要 | 全部 | — |

### 3.2 護理師 (nurse)

| 頁面/功能 | 可見 | 特殊功能 |
|----------|------|---------|
| Dashboard 總覽 | 全部 | — |
| 病人清單 | 全部 | 無編輯權限 |
| 對話助手 | 全部 | — |
| 留言板 | 全部 | 一般留言（無用藥建議按鈕） |
| **病歷記錄** | **護理記錄類型** | 4 種模板（交班/鎮靜/管路/傷口） + AI 修飾/校正（`POST /api/v1/clinical/polish`） |
| 檢驗數據 | 全部 | 生命徵象 + 呼吸器 + 檢驗值 |
| 用藥 | 藥物列表 | 無藥師建議 Widget |
| 病歷摘要 | 全部 | — |

### 3.3 藥師 (pharmacist)

| 頁面/功能 | 可見 | 特殊功能 |
|----------|------|---------|
| Dashboard 總覽 | 全部 | — |
| 病人清單 | 全部 | 無編輯權限 |
| 對話助手 | 全部 | — |
| 留言板 | 全部 | **「標記為用藥建議」按鈕啟用** |
| **病歷記錄** | **用藥建議類型** | 撰寫 + AI 修飾（`POST /api/v1/clinical/polish`） |
| 檢驗數據 | 全部 | 生命徵象 + 呼吸器 + 檢驗值 |
| **用藥** | 藥物列表 + **藥師建議 Widget** | 23 分類代碼 + A-W 回應代碼 |
| 病歷摘要 | 全部 | — |

### 3.4 管理員 (admin)

| 頁面/功能 | 可見 | 特殊功能 |
|----------|------|---------|
| Dashboard 總覽 | 全部 | **編輯病患按鈕**（hover 出現） |
| 病人清單 | 全部 | **編輯按鈕** + 新增/封存病人按鈕 |
| 對話助手 | 全部 | — |
| 留言板 | 全部 | 一般留言 |
| **病歷記錄** | **全部 3 類型** | 可切換 Progress Note / 用藥建議 / 護理記錄 |
| 檢驗數據 | 全部 | 生命徵象 + 呼吸器 + 檢驗值 |
| **用藥** | 藥物列表 + **藥師建議 Widget** | 同藥師功能 |
| 病歷摘要 | 全部 | — |
| **病患詳情頁首** | — | **「編輯基本資料」按鈕** |

### 3.5 角色差異矩陣

| 功能 | 醫師 | 護理師 | 藥師 | 管理員 |
|------|------|--------|------|--------|
| 編輯病患資料 | - | - | - | **可** |
| 新增/封存病人 | - | - | - | **可** |
| 病歷記錄：Progress Note | **可** | - | - | **可** |
| 護理記錄模板 | - | **可** | - | **可** |
| 用藥建議標記 | - | - | **可** | - |
| 藥師建議 Widget | - | - | **可** | **可** |
| 切換病歷記錄類型 | - | - | - | **可** |
| 閱覽所有病歷類型 | 僅 Note | 僅護理 | 僅用藥 | **全部** |

---

## 4. AI 功能現況與缺口

### 4.1 真正呼叫 AI API 的功能

| 功能 | 觸發方式 | 後端 API | LLM Task | 狀態 |
|------|---------|---------|----------|------|
| AI 對話 | 對話助手 Tab → 發送訊息 | `POST /ai/chat` | `rag_generation` | **已實作** |
| AI 文書修飾 | 病歷記錄/用藥建議/護理記錄/藥師建議 → AI 修飾 | `POST /api/v1/clinical/polish` | `clinical_polish` | **已實作** |
| AI 臨床摘要 | 病歷摘要 Tab → 生成臨床摘要 | `POST /api/v1/clinical/summary` | `clinical_summary` | **已實作** |
| 衛教說明 | 病歷摘要 Tab → 產生衛教說明 | `POST /api/v1/clinical/explanation` | `patient_explanation` | **已實作** |
| 指引查詢 | 病歷摘要 Tab → 查詢指引建議 | `POST /api/v1/clinical/guideline` | `guideline_interpretation` | **已實作** |
| 決策支援 | 病歷摘要 Tab → 產生決策建議 | `POST /api/v1/clinical/decision` | `multi_agent_decision` | **已實作** |
| 知識庫狀態 | 病歷摘要 Tab → Badge 顯示 | `GET /api/v1/rag/status` | — | **已實作** |

### 4.2 已消除的「假 AI」（已改為真實呼叫後端 LLM）

| 功能 | 舊現況 | 現況 |
|------|--------|------|
| Progress Note 修飾 | 前端模板拼接 | 改為 `POST /api/v1/clinical/polish`（`progress_note`） |
| 用藥建議修飾 | 前端模板拼接 | 改為 `POST /api/v1/clinical/polish`（`medication_advice`） |
| 病歷記錄 AI 修飾 | 固定模板 | 改為 `POST /api/v1/clinical/polish`（含 `nursing_record`） |
| 藥師建議 AI 修飾 | 前端模板拼接 | 改為 `POST /api/v1/clinical/polish`（`pharmacy_advice`） |

### 4.3 後端有但前端未使用的 AI/規則 API（仍可後續串接）

| 後端 API | 用途 | 前端使用 |
|---------|------|---------|
| `POST /api/v1/rag/query` | RAG 獨立問答 | **未使用** |
| `POST /api/v1/rag/index` | RAG 文件索引 | **未使用**（目前僅後端啟動可自動索引） |
| `POST /api/v1/rules/ckd-stage` | CKD 分期 | **未使用** |
| `POST /ai/messages/{id}/review` | AI 回覆專家審閱 | **未使用**（已提供 API，尚未做 UI） |

### 4.4 AI 最大缺口（已修正）：病患臨床資料注入 LLM

```
後端 AI 實際接收（/ai/chat + /api/v1/clinical/*）
────────────────────────────────────────
patient 基本資料 + 最新 lab/vitals + active meds + 最新 ventilator settings
```

> ✅ 已完成：`_get_patient_dict()` 擴充並被 clinical endpoints 與 chat 注入使用。

### 4.5 Hardcode 問題

> ✅ 已修正：病歷摘要 Tab 的性別/BMI/身高/體重/症狀已改為來自 `patient` 後端資料，不再為 hardcode。

---

## 附錄：API 端點對照表

| 前端呼叫 | 後端端點 | 資料類型 |
|---------|---------|---------|
| `patientsApi.getPatients()` | `GET /patients` | 病人列表 |
| `patientsApi.getPatient(id)` | `GET /patients/{id}` | 單一病人 |
| `patientsApi.updatePatient(id, data)` | `PATCH /patients/{id}` | 更新病人 |
| `labDataApi.getLatestLabData(id)` | `GET /patients/{id}/lab-data/latest` | 最新檢驗 |
| `labDataApi.getLabTrends(id, {days})` | `GET /patients/{id}/lab-data/trends` | 檢驗趨勢 |
| `medicationsApi.getMedications(id)` | `GET /patients/{id}/medications` | 藥物列表 |
| `messagesApi.getMessages(id)` | `GET /patients/{id}/messages` | 留言列表 |
| `messagesApi.sendMessage(id, msg)` | `POST /patients/{id}/messages` | 新增留言 |
| `vitalSignsApi.getLatestVitalSigns(id)` | `GET /patients/{id}/vital-signs/latest` | 最新生命徵象 |
| `ventilatorApi.getLatestVentilatorSettings(id)` | `GET /patients/{id}/ventilator/latest` | 最新呼吸器 |
| `ventilatorApi.getWeaningAssessment(id)` | `GET /patients/{id}/ventilator/weaning-assessment` | 脫機評估 |
| `sendChatMessage(msg, opts)` | `POST /ai/chat` | AI 對話 |
| `getChatSessions(opts)` | `GET /ai/sessions` | 對話記錄（session list） |
| `getChatSession(id)` | `GET /ai/sessions/{id}` | 對話歷史 |
| `updateChatSessionTitle(id, title)` | `PATCH /ai/sessions/{id}` | 更新對話標題 |
| `polishClinicalText(...)` | `POST /api/v1/clinical/polish` | AI 文書修飾 |
| `getClinicalSummary(patientId)` | `POST /api/v1/clinical/summary` | 臨床摘要 |
| `getPatientExplanation(patientId, topic)` | `POST /api/v1/clinical/explanation` | 病情衛教 |
| `getGuidelineInterpretation(...)` | `POST /api/v1/clinical/guideline` | 指引解讀 |
| `getDecisionSupport(...)` | `POST /api/v1/clinical/decision` | 會診決策 |
| `getRAGStatus()` | `GET /api/v1/rag/status` | RAG 索引狀態 |
| — (未使用) | `POST /api/v1/rules/ckd-stage` | CKD 分期 |
| — (未使用) | `POST /ai/messages/{id}/review` | AI 專家審閱 |
