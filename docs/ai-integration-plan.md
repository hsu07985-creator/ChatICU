# ChatICU AI 資料整合開發計畫

> 文件產生日期：2026-02-15
> 狀態：Phase 0 ✅ → Phase 1 ✅ → Phase 2 ✅ → Phase 3 ✅ → Phase 4 ✅（另：P1 UX/安全呈現 ✅）
> 前置文件：`docs/frontend-data-inventory.md`（前端資料完整盤點）

---

## 背景

經過前端完整盤點，發現以下問題：

| # | 問題 | 嚴重度 | 影響範圍 |
|---|------|--------|----------|
| 1 | 前端 `Patient` TypeScript interface 缺少 `height/weight/bmi/symptoms/allergies/bloodType/codeStatus` 欄位 | 高 | 總覽頁硬編碼、前端無法顯示已有的後端資料 |
| 2 | 病患總覽 Summary tab 有 5 個硬編碼值（gender/BMI/height/weight/symptoms） | 高 | 所有病患看到同一組假資料 |
| 3 | `_get_patient_dict()` 僅回傳 12 欄位，AI 收不到檢驗值/生命徵象/藥物/呼吸器 | 高 | 所有 4 支 clinical AI endpoint 都缺乏臨床資料 |
| 4 | `/ai/chat` 接收 `patientId` 但不查詢病患資料 | 高 | AI 對話助手對病患一無所知（✅ 已修正：chat 注入病患上下文） |
| 5 | 前端 4 個「AI 修飾」函式全是假的模板字串拼接 | 中 | 使用者以為是 AI 生成，實際是固定模板（✅ 已修正：改串 `/api/v1/clinical/polish`） |
| 6 | 後端 9 支 AI API 建好但前端完全未串接 | 低 | 功能閒置（✅ 已修正：summary/explanation/guideline/decision/polish 已串接） |

---

## 現況確認（已盤點完成）

### 前端資料串接狀態

| 資料類型 | 前端 API 函式 | 後端 Endpoint | 呼叫位置 | 狀態 |
|----------|--------------|---------------|----------|------|
| 病患基本資料 | `getPatient(id)` | `GET /patients/{id}` | patient-detail.tsx:232 | **已串接** |
| 檢驗值 | `getLatestLabData(id)` | `GET /patients/{id}/lab-data/latest` | patient-detail.tsx:233 | **已串接** |
| 用藥 | `getMedications(id)` | `GET /patients/{id}/medications` | patient-detail.tsx:234 | **已串接** |
| 生命徵象 | `getLatestVitalSigns(id)` | `GET /patients/{id}/vital-signs/latest` | patient-detail.tsx:236 | **已串接** |
| 呼吸器 | `getLatestVentilatorSettings(id)` | `GET /patients/{id}/ventilator/latest` | patient-detail.tsx:237 | **已串接** |
| 脫機評估 | `getWeaningAssessment(id)` | `GET /patients/{id}/ventilator/weaning-assessment` | patient-detail.tsx:238 | **已串接** |
| 檢驗趨勢 | `getLabTrends(id)` | `GET /patients/{id}/lab-data/trends` | patient-detail.tsx:289, lab-data-display.tsx:185 | **已串接** |
| AI 對話 | `sendChatMessage()` | `POST /ai/chat` | patient-detail.tsx:422 | **已串接** |

**結論：前端→後端 API 串接已完成。** 問題不在串接，而在：
1. 前端 TypeScript type 沒接收後端回傳的部分欄位
2. Summary tab 使用硬編碼值而非 API 回傳的資料
3. 後端 AI endpoint 收到的病患資料不完整

### 後端 AI 功能現況

| Endpoint | 位置 | 前端串接 | 問題 |
|----------|------|----------|------|
| `POST /ai/chat` | ai_chat.py | **有** | ✅ 已注入病患上下文（有 `patientId` 時）+ multi-turn history（含自動摘要壓縮）+ safety guardrail |
| `POST /api/v1/clinical/summary` | clinical.py | **有** | ✅ 已注入完整病患資料（lab/vitals/meds/vent）+ safety guardrail |
| `POST /api/v1/clinical/explanation` | clinical.py | **有** | ✅ 同上 |
| `POST /api/v1/clinical/guideline` | clinical.py | **有** | ✅ 同上（含 sources） |
| `POST /api/v1/clinical/decision` | clinical.py | **有** | ✅ 同上 |
| `POST /api/v1/clinical/polish` | clinical.py | **有** | ✅ 取代前端假 AI 模板（progress/med/nursing/pharmacy） |
| `POST /api/v1/rag/index` | rag.py | 無 | Admin 功能，暫不需前端 |
| `POST /api/v1/rag/query` | rag.py | 無 | 獨立 RAG 查詢，未來可串 |
| `GET /api/v1/rag/status` | rag.py | **有** | ✅ 病歷摘要 Tab 顯示知識庫索引狀態 |
| `POST /api/v1/rules/ckd-stage` | rules.py | 無 | 規則引擎，未來可串 |
| `POST /ai/messages/{id}/review` | ai_chat.py:227 | 無 | 專家審閱，T30 功能 |

### 前端假 AI 函式清單（已移除）

| 舊函式 | 舊位置 | 狀態 | 取代方案 |
|------|----------|------|-----------|
| `handlePolishProgressNote()` | patient-detail.tsx | ✅ 已移除 | 病歷記錄 Tab → `polishClinicalText()` |
| `handlePolishMedAdvice()` | patient-detail.tsx | ✅ 已移除 | 病歷記錄 Tab → `polishClinicalText()` |
| `handlePolishContent()` | medical-records.tsx | ✅ 已改造 | `POST /api/v1/clinical/polish` |
| `handlePolishAdvice()` | pharmacist-advice-widget.tsx | ✅ 已改造 | `POST /api/v1/clinical/polish` |

---

## 執行計畫

### Phase 0：修正前端顯示（不涉及 AI）

**目的：** 確保前端正確顯示後端已回傳的完整病患資料，消除硬編碼值。

**優先於 AI 開發的原因：** 如果基礎資料顯示都有問題，AI 功能做再多也沒意義。

#### 0A. 擴充前端 Patient TypeScript interface

**檔案：** `src/lib/api/patients.ts`

**現況：** Patient interface 缺少 7 個後端已回傳的欄位
**後端 `patient_to_dict()` 已回傳但前端未定義：**
- `height: number | null`
- `weight: number | null`
- `bmi: number | null`
- `symptoms: string[]`
- `allergies: string[]`
- `bloodType: string | null`
- `codeStatus: string | null`

**做法：** 在 Patient interface 加入這 7 個 optional 欄位

**驗收標準：**
- [x] `Patient` interface 包含 `height?`, `weight?`, `bmi?`, `symptoms?`, `allergies?`, `bloodType?`, `codeStatus?` ✅ 2026-02-15
- [x] 前端無 tsc 安裝（Vite+SWC 專案），由 IDE 型別檢查確認 ✅ 2026-02-15

#### 0B. 修正 Summary tab 硬編碼值

**檔案：** `src/pages/patient-detail.tsx`（line 1600-1676）

**5 個修正：**

| 行號 | 欄位 | 硬編碼原值 | 改為 |
|------|------|-----------|------|
| 1614 | Gender | `"male"` | `patient.gender` |
| 1618 | BMI | `"16.4 kg/m²"` | `patient.bmi ? \`${patient.bmi} kg/m²\` : 'N/A'` |
| 1622 | Height | `"164 cm"` | `patient.height ? \`${patient.height} cm\` : 'N/A'` |
| 1626 | Weight | `"44 kg"` | `patient.weight ? \`${patient.weight} kg\` : 'N/A'` |
| 1638-1642 | Symptoms | 3 個硬編碼英文症狀 | `patient.symptoms?.map(...)` 動態列表 |

**驗收標準：**
- [x] Summary tab 的 Gender/BMI/Height/Weight 來自 `patient` state，不同病患顯示不同值 ✅ 2026-02-15
- [x] Symptoms 列表來自 `patient.symptoms`，無資料時顯示「尚無症狀記錄」 ✅ 2026-02-15
- [x] 後端 `patient_to_dict()` 已回傳這些欄位（已確認 ✓ — patients.py:28-32） ✅ 2026-02-15
- [x] 後端 76/76 tests 全過，無回歸 ✅ 2026-02-15

---

### Phase 1：擴充 `_get_patient_dict()`（後端 AI 資料基礎）

**目的：** 讓所有 clinical AI endpoint 收到完整的病患臨床資料。

**檔案：** `backend/app/routers/clinical.py`（line 32-51）

**現況（12 欄位）：**
```
id, name, age, gender, diagnosis, symptoms, sedation, analgesia, nmb,
critical_status, ventilator_days, alerts
```

**目標（擴充至完整）：**
```
現有 12 欄位
+ Patient 表欄位：height, weight, bmi, allergies, blood_type, intubated,
  attending_physician, department, admission_date, icu_admission_date,
  code_status, has_dnr, is_isolated
+ 最新 LabData（JSONB：biochemistry, hematology, blood_gas, inflammatory, coagulation）
+ 最新 VitalSign（heart_rate, blood_pressure, respiratory_rate, spo2, temperature）
+ Active Medication 列表（name, dose, frequency, route, san_category, warnings...）
+ 最新 VentilatorSetting（mode, fio2, peep, tidal_volume...）
```

**做法：**
1. 使用 `selectinload` 載入 Patient 的 4 個 relationship
2. 加入 Patient 表遺漏的 13 個欄位
3. 取最新一筆 LabData/VitalSign/VentilatorSetting（sorted by timestamp desc）
4. 取所有 status="active" 的 Medication
5. 重用已有的 helper：`lab_to_dict()`、`vital_to_dict()`、`med_to_dict()`、`vent_to_dict()`

**重用的既有函式：**
- `backend/app/routers/lab_data.py:20` → `lab_to_dict()`
- `backend/app/routers/vital_signs.py:24` → `vital_to_dict()`
- `backend/app/routers/medications.py:21` → `med_to_dict()`
- `backend/app/routers/ventilator.py:19` → `vent_to_dict()`

**測試（+2 tests）：**
- `test_patient_dict_includes_related_data` — seed Patient + LabData + VitalSign + Medication + VentilatorSetting，呼叫 `/clinical/summary`，驗證 mock `call_llm` 的 `input_data` 包含 `lab_data`/`vital_signs`/`medications`/`ventilator_settings`
- `test_patient_dict_handles_empty_related_data` — 僅 seed Patient，無關聯資料，驗證回傳 `lab_data=None`、`medications=[]`

**驗收標準：**
- [x] `_get_patient_dict()` 回傳的 dict 包含 `lab_data`、`vital_signs`、`medications`、`ventilator_settings` 鍵 ✅ 2026-02-15
- [x] 有關聯資料時：`lab_data` 為 dict（含 biochemistry/hematology 等）、`medications` 為 list of dict ✅ 2026-02-15
- [x] 無關聯資料時：`lab_data=None`、`vital_signs=None`、`medications=[]`、`ventilator_settings=None` ✅ 2026-02-15
- [x] 所有 4 支 clinical endpoint（/summary, /explanation, /guideline, /decision）自動獲得完整資料 ✅ 2026-02-15
- [x] 原有 76 tests 全過 + 2 新 tests 通過 ✅ 2026-02-15
- [x] `python3 -m pytest tests/ -v --tb=short` → 78/78 passed ✅ 2026-02-15

---

### Phase 2：`/ai/chat` 注入病患上下文

**目的：** AI 對話助手在有 `patientId` 時，查詢該病患的完整臨床資料一併傳給 LLM。

**修改檔案：**
- `backend/app/routers/ai_chat.py` — 加入 patient context 查詢（line 78 前）
- `backend/app/llm.py` — 更新 `rag_generation` prompt（line 34-37）

**做法：**
```python
# ai_chat.py — 在 call_llm 前加入：
from app.routers.clinical import _get_patient_dict

patient_context = {}
if req.patientId:
    try:
        patient_context = await _get_patient_dict(req.patientId, db)
    except HTTPException:
        pass  # 查無病患，不中斷

# 修改 call_llm 的 input_data：
input_data={
    "question": req.message,
    "context": rag_context,
    "patient": patient_context if patient_context else None,
}
```

**llm.py prompt 更新：**
```python
"rag_generation": (
    "You are a medical literature analyst for ICU patient care. "
    "If patient data is provided, incorporate it into your analysis. "
    "Answer based ONLY on the provided context and patient data. "
    "Cite supporting evidence."
),
```

**測試（+3 tests in `tests/test_api/test_ai_chat.py`）：**
- `test_ai_chat_with_patient_context` — 有 patientId → `input_data` 含 `patient` key
- `test_ai_chat_without_patient_id` — 無 patientId → `patient` 為 `None`
- `test_ai_chat_with_invalid_patient_id` — 無效 patientId → 不 crash、`patient` 為 `None`

**驗收標準：**
- [x] 有 patientId 時，LLM 收到完整病患資料（含檢驗值、藥物等） ✅ 2026-02-15
- [x] 無 patientId 時，正常運作（向後相容） ✅ 2026-02-15
- [x] 無效 patientId 時，不會 500 error ✅ 2026-02-15
- [x] `python3 -m pytest tests/ -v --tb=short` → 81/81 passed ✅ 2026-02-15

---

### Phase 3：新增 `POST /api/v1/clinical/polish` endpoint

**目的：** 提供統一的「AI 文書修飾」API，取代前端 4 個假 AI 模板函式。

**修改/新增檔案：**
1. `backend/app/schemas/clinical.py` — 新增 `PolishRequest` schema
2. `backend/app/llm.py` — 新增 `clinical_polish` task prompt
3. `backend/app/routers/clinical.py` — 新增 `/polish` endpoint

**PolishRequest Schema：**
```python
class PolishRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1, max_length=10000)
    polish_type: str = Field(..., regex="^(progress_note|medication_advice|nursing_record|pharmacy_advice)$")
```

**新增 TASK_PROMPT `clinical_polish`：**
```
醫療文書修飾專家，根據 polish_type 產生對應格式：
- progress_note：SOAP / Assessment + Plan 格式，引用實際檢驗值
- medication_advice：含劑量依據（腎功能 eGFR、電解質等）
- nursing_record：中文校正錯字、標準化格式
- pharmacy_advice：正式臨床藥學建議格式
必須引用病患實際檢驗值、生命徵象、藥物資料，不可編造數據。
```

**Endpoint 結構：**
- JWT auth（`Depends(get_current_user)`）
- 呼叫 `_get_patient_dict()` 取完整病患資料
- `call_llm(task="clinical_polish", input_data={patient, draft_content, polish_type, user_role})`
- `apply_safety_guardrail()` 檢查
- 回傳 `{polished, original, polish_type, metadata, safetyWarnings}`
- 寫入 audit log（action="文本修飾"）

**測試（+4 tests in `tests/test_api/test_clinical.py`）：**
- `test_polish_progress_note` — mock call_llm → 驗證 response.data.polished 存在
- `test_polish_medication_advice` — 同上、`polish_type=medication_advice`
- `test_polish_invalid_type` — `polish_type=invalid` → 422 Validation Error
- `test_polish_patient_not_found` — `patient_id=nonexistent` → 404

**驗收標準：**
- [x] `POST /api/v1/clinical/polish` 回傳 `{success: true, data: {polished, original, ...}}` ✅ 2026-02-15
- [x] `polish_type` 只接受 4 個合法值，其餘 422 ✅ 2026-02-15
- [x] 病患不存在 → 404 ✅ 2026-02-15
- [x] audit log 記錄 action="文本修飾" ✅ 2026-02-15
- [x] safety guardrail 正常運作 ✅ 2026-02-15
- [x] `cd backend && .venv312/bin/python -m pytest -q` → **98 passed, 13 skipped** ✅ 2026-02-15

---

### Phase 4：前端串接 — 取代假 AI 函式

**目的：** 將 4 個前端模板函式替換為真正呼叫 `POST /api/v1/clinical/polish` 的 async 函式。

**修改檔案：**

#### 4A. API Client — `src/lib/api/ai.ts`

新增：
```typescript
export interface PolishRequest {
  patientId: string;
  content: string;
  polishType: 'progress_note' | 'medication_advice' | 'nursing_record' | 'pharmacy_advice';
}

export interface PolishResponse {
  patient_id: string;
  polish_type: string;
  original: string;
  polished: string;
  metadata: Record<string, unknown>;
  safetyWarnings?: string[];
}

export async function polishClinicalText(data: PolishRequest): Promise<PolishResponse> {
  const response = await apiClient.post<ApiResponse<PolishResponse>>(
    '/api/v1/clinical/polish',
    { patient_id: data.patientId, content: data.content, polish_type: data.polishType }
  );
  return response.data.data!;
}
```

#### 4B. patient-detail.tsx — 取代 2 個假 AI 函式

| 原函式 | 行號 | 改為 |
|--------|------|------|
| `handlePolishProgressNote()` | 496-516 | async → `polishClinicalText({polishType: 'progress_note'})` |
| `handlePolishMedAdvice()` | 518-533 | async → `polishClinicalText({polishType: 'medication_advice'})` |

- 新增 `isPolishing` state，按鈕 disable + loading
- 可移除 `extractLabNumericValue()` helper（不再需要前端計算）

#### 4C. medical-records.tsx — 取代 1 個假 AI 函式

| 原函式 | 行號 | 改為 |
|--------|------|------|
| `handlePolishContent()` | 91-129 | async → `polishClinicalText()` |

- recordType mapping: `progress-note`→`progress_note`, `medication-advice`→`medication_advice`, `nursing-record`→`nursing_record`
- `patientId` prop 已有（line 30, 43）

#### 4D. pharmacist-advice-widget.tsx — 取代 1 個假 AI 函式

| 原函式 | 行號 | 改為 |
|--------|------|------|
| `handlePolishAdvice()` | 153-167 | async → `polishClinicalText({polishType: 'pharmacy_advice'})` |

- `patientId` prop 已有（line 22, 144）

**統一 pattern：**
```typescript
const handlePolishXxx = async () => {
  if (!input.trim() || !patientId) return;
  setIsPolishing(true);
  try {
    const result = await polishClinicalText({
      patientId,
      content: input,
      polishType: 'xxx',
    });
    setPolishedXxx(result.polished);
  } catch (err) {
    toast.error('AI 修飾失敗，請稍後再試');
  } finally {
    setIsPolishing(false);
  }
};
```

**驗收標準：**
- [x] 4 個 polish 函式全部改為 async API 呼叫 ✅ 2026-02-15
- [x] 各按鈕有 loading 狀態（disable + loading indicator） ✅ 2026-02-15
- [x] API 失敗時顯示 toast error ✅ 2026-02-15
- [x] TypeScript 編譯無錯誤（`npm run build`） ✅ 2026-02-15
- [x] 手動測試：輸入文字 → 點 AI 修飾 → 顯示 loading → 顯示 AI 回應 ✅ 2026-02-15

---

## 依賴順序與時程

```
Phase 0（前端顯示修正）—— 獨立，可先行
  │
Phase 1（_get_patient_dict 擴充）—— 後端基礎
  ├─> Phase 2（/ai/chat 注入上下文）
  ├─> Phase 3（/clinical/polish 新 endpoint）
  │       └─> Phase 4（前端串接 polish API）
```

**建議執行順序：**
1. Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4
2. Phase 0 與 Phase 1 可同步進行（前端 vs 後端互不影響）

---

## 測試總覽

> 由於後續已擴充多輪對話、func/ 引擎整合、RAG 狀態等功能，測試數量已超出 Phase 0-4 原始估算。

| 類別 | 驗證指令 | 結果 |
|------|----------|------|
| Backend | `cd backend && .venv312/bin/python -m pytest -q` | **98 passed, 13 skipped**（2026-02-15） |
| Frontend | `npm run build` | build pass（2026-02-15） |

---

## 修改檔案總覽

| Phase | 檔案 | 變更類型 |
|-------|------|----------|
| 0A | `src/lib/api/patients.ts` | 修改 — 加 7 欄位至 Patient interface |
| 0B | `src/pages/patient-detail.tsx` | 修改 — 5 個硬編碼值改為動態 |
| 1 | `backend/app/routers/clinical.py` | 修改 — 改寫 `_get_patient_dict()` |
| 1 | `backend/tests/test_api/test_clinical.py` | 修改 — +2 tests |
| 2 | `backend/app/routers/ai_chat.py` | 修改 — 加入 patient context |
| 2 | `backend/app/llm.py` | 修改 — 更新 rag_generation prompt |
| 2 | `backend/tests/test_api/test_ai_chat.py` | 新增 — 3 tests |
| 3 | `backend/app/schemas/clinical.py` | 修改 — +PolishRequest |
| 3 | `backend/app/llm.py` | 修改 — +clinical_polish prompt |
| 3 | `backend/app/routers/clinical.py` | 修改 — +/polish endpoint |
| 3 | `backend/tests/test_api/test_clinical.py` | 修改 — +4 tests |
| 4A | `src/lib/api/ai.ts` | 修改 — +polishClinicalText() |
| 4B | `src/pages/patient-detail.tsx` | 修改 — 取代 2 假 AI |
| 4C | `src/components/medical-records.tsx` | 修改 — 取代 1 假 AI |
| 4D | `src/components/pharmacist-advice-widget.tsx` | 修改 — 取代 1 假 AI |

**共 13 檔案（7 後端 + 6 前端），+9 新測試，0 現有測試破壞**

---

## 不在此次範圍

以下項目已識別但不在此次開發範圍，列入未來 backlog：

| 項目 | 原因 |
|------|------|
| 前端串接 `/ai/messages/{id}/review`（專家審閱） | T30 功能，需 UI 設計（待補：審閱 UI + 權限流） |
| SSE 串流回應 | 後端尚未實作 streaming |
| 向量資料庫持久化（取代 in-memory） | 部署階段處理 |
| 醫療記錄後端持久化（目前 frontend state only） | 需設計新的 DB model |
