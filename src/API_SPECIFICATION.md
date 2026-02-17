# ChatICU 系統 API 規格文件

## 文件版本
- **版本**: 1.0.0
- **更新日期**: 2026-01-10
- **負責人**: 前端團隊

---

## 目錄
1. [系統架構概覽](#系統架構概覽)
2. [角色權限矩陣](#角色權限矩陣)
3. [路由結構](#路由結構)
4. [API 接口規格](#api-接口規格)
5. [資料模型](#資料模型)
6. [前後端互動流程](#前後端互動流程)
7. [錯誤處理](#錯誤處理)
8. [安全性要求](#安全性要求)

---

## 系統架構概覽

### 技術棧
- **前端框架**: React 18 + TypeScript
- **路由**: React Router v6
- **狀態管理**: React Context API
- **UI 框架**: Tailwind CSS v4 + shadcn/ui
- **圖表庫**: Recharts
- **HTTP 客戶端**: (待實作 - 建議使用 Axios)

### 核心配色
```css
主色 (Primary): #7f265b
深色 (Dark): #1a1a1a
中性 (Neutral): #f8f9fa
純白 (White): #ffffff
點綴色 (Accent): #f59e0b
```

---

## 角色權限矩陣

### 四種角色定義

| 角色 | 代碼 | 說明 | 測試帳號 |
|------|------|------|----------|
| 一般護理師 | `nurse` | 檢視病人資料、AI 對話、查看報告 | nurse/nurse |
| 醫師 | `doctor` | 護理師權限 + Progress Note 輔助 | doctor/doctor |
| 管理者 | `admin` | 完整系統管理、資料上傳、稽核、用戶管理 | admin/admin |
| 藥師 | `pharmacist` | 藥事支援中心完整功能 | pharmacist/pharmacist |

### 功能權限對照表

| 功能模組 | 護理師 | 醫師 | 管理者 | 藥師 |
|---------|--------|------|--------|------|
| **病人照護** |
| - 查看病人列表 | ✓ | ✓ | ✓ | ✗ |
| - 查看病人詳細資料 | ✓ | ✓ | ✓ | ✗ |
| - AI 對話助手 | ✓ | ✓ | ✓ | ✗ |
| - 留言板（讀取） | ✓ | ✓ | ✓ | ✓ |
| - 留言板（發布） | ✓ | ✓ | ✓ | ✓ |
| - 查看檢驗數據 | ✓ | ✓ | ✓ | ✗ |
| - 校正檢驗數據 | ✓ | ✓ | ✓ | ✗ |
| - 查看用藥 | ✓ | ✓ | ✓ | ✓ |
| - Progress Note 輔助 | ✗ | ✓ | ✓ | ✗ |
| - 護理記錄輔助 | ✓ | ✓ | ✓ | ✗ |
| **藥事支援** |
| - 藥物交互作用查詢 | ✗ | ✗ | ✓ | ✓ |
| - 相容性檢核 | ✗ | ✗ | ✓ | ✓ |
| - 劑量計算建議 | ✗ | ✗ | ✓ | ✓ |
| - 用藥建議（產生） | ✗ | ✗ | ✓ | ✓ |
| - 用藥建議（發送到病患） | ✗ | ✗ | ✓ | ✓ |
| - 藥事工作台 | ✗ | ✗ | ✓ | ✓ |
| - 建議統計 | ✗ | ✗ | ✓ | ✓ |
| **團隊協作** |
| - 團隊聊天室 | ✓ | ✓ | ✓ | ✓ |
| **管理功能** |
| - 檢驗數據上傳（OCR） | ✗ | ✗ | ✓ | ✗ |
| - 向量資料庫管理 | ✗ | ✗ | ✓ | ✗ |
| - 用戶管理 | ✗ | ✗ | ✓ | ✗ |
| - 稽核日誌 | ✗ | ✗ | ✓ | ✗ |
| - 統計報表 | ✗ | ✗ | ✓ | ✗ |

---

## 路由結構

### 公開路由
```
/login - 登入頁面
```

### 一般醫護路由 (nurse, doctor, admin)
```
/dashboard - 儀表板總覽
/patients - 病人列表
/patient/:id - 病人詳細頁面
  - Tabs:
    - chat - 對話助手
    - messages - 留言板
    - records - 病歷記錄
    - labs - 檢驗數據
    - meds - 用藥
    - summary - 病歷摘要
/chat - 團隊聊天室
```

### 藥師專屬路由 (pharmacist, admin)
```
/pharmacy/workstation - 藥事支援工作台
/pharmacy/interactions - 藥物交互作用查詢
/pharmacy/compatibility - 相容性檢核
/pharmacy/dosage - 劑量計算建議
/pharmacy/error-report - 用藥異常通報
/pharmacy/advice-statistics - 建議統計
```

### 管理者專屬路由 (admin)
```
/admin/audit - 稽核日誌
/admin/vectors - 向量資料庫管理
/admin/users - 用戶管理
```

---

## API 接口規格

### 基礎配置
```
Base URL: https://api.chaticu.hospital/v1
Content-Type: application/json
Authorization: Bearer {token}
```

---

## 1. 認證相關 API

### 1.1 用戶登入
```http
POST /auth/login
```

**Request Body:**
```json
{
  "username": "nurse",
  "password": "nurse123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "usr_001",
      "name": "王小華",
      "role": "nurse",
      "unit": "加護病房一",
      "email": "nurse@hospital.com"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "refresh_token_here",
    "expiresIn": 86400
  }
}
```

**Response (401):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "帳號或密碼錯誤"
  }
}
```

### 1.2 用戶登出
```http
POST /auth/logout
```

**Request Headers:**
```
Authorization: Bearer {token}
```

**Response (200):**
```json
{
  "success": true,
  "message": "登出成功"
}
```

### 1.3 刷新 Token
```http
POST /auth/refresh
```

**Request Body:**
```json
{
  "refreshToken": "refresh_token_here"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "new_access_token",
    "expiresIn": 86400
  }
}
```

### 1.4 獲取當前用戶資訊
```http
GET /auth/me
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "usr_001",
    "name": "王小華",
    "role": "nurse",
    "unit": "加護病房一",
    "email": "nurse@hospital.com",
    "permissions": ["view_patients", "chat_ai", "edit_nursing_records"]
  }
}
```

---

## 2. 病人管理 API

### 2.1 獲取病人列表
```http
GET /patients
```

**Query Parameters:**
```
page: number (default: 1)
limit: number (default: 20)
search: string (optional - 姓名、床號搜尋)
bedNumber: string (optional)
intubated: boolean (optional)
critical: boolean (optional)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "patients": [
      {
        "id": "pat_001",
        "name": "陳大明",
        "age": 65,
        "gender": "male",
        "bedNumber": "A01",
        "admissionDate": "2024-11-10",
        "icuAdmissionDate": "2024-11-11",
        "diagnosis": "COVID-19 併發肺炎",
        "intubated": true,
        "criticalStatus": "嚴重",
        "alerts": [
          "血鉀偏低",
          "呼吸抑制風險"
        ],
        "latestVitals": {
          "temperature": 38.2,
          "heartRate": 95,
          "bloodPressure": "120/80",
          "respiratoryRate": 22,
          "spo2": 94
        },
        "unreadMessages": 2
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

### 2.2 獲取單一病人詳細資料
```http
GET /patients/:id
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "pat_001",
    "name": "陳大明",
    "age": 65,
    "gender": "male",
    "bedNumber": "A01",
    "height": 170,
    "weight": 65,
    "bmi": 22.5,
    "admissionDate": "2024-11-10",
    "icuAdmissionDate": "2024-11-11",
    "diagnosis": "COVID-19 併發肺炎",
    "symptoms": [
      "COVID-19 Complicated with Pulmonary Infection",
      "Septic Shock",
      "Respiratory Acidosis"
    ],
    "intubated": true,
    "criticalStatus": "嚴重",
    "alerts": [
      "血鉀偏低 (K: 3.2 mmol/L)",
      "呼吸抑制風險 (併用 Morphine + Dormicum)"
    ],
    "allergies": ["Penicillin"],
    "bloodType": "A+",
    "code_status": "Full Code"
  }
}
```

### 2.3 更新病人基本資料 (僅 admin)
```http
PATCH /patients/:id
```

**Request Body:**
```json
{
  "height": 170,
  "weight": 68,
  "diagnosis": "更新後的診斷",
  "alerts": ["新增警示"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "pat_001",
    "updatedFields": ["height", "weight", "diagnosis", "alerts"],
    "updatedAt": "2024-11-15T10:30:00Z"
  }
}
```

---

## 3. 檢驗數據 API

### 3.1 獲取病人最新檢驗數據
```http
GET /patients/:id/lab-data/latest
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "patientId": "pat_001",
    "timestamp": "2024-11-15T08:30:00Z",
    "biochemistry": {
      "Na": { "value": 138, "unit": "mmol/L", "referenceRange": "135-145", "isAbnormal": false },
      "K": { "value": 3.2, "unit": "mmol/L", "referenceRange": "3.5-5.0", "isAbnormal": true },
      "Cl": { "value": 102, "unit": "mmol/L", "referenceRange": "98-107", "isAbnormal": false },
      "BUN": { "value": 28, "unit": "mg/dL", "referenceRange": "7-20", "isAbnormal": true },
      "Scr": { "value": 1.2, "unit": "mg/dL", "referenceRange": "0.7-1.3", "isAbnormal": false },
      "eGFR": { "value": 58, "unit": "mL/min", "referenceRange": "≥60", "isAbnormal": true },
      "Glucose": { "value": 145, "unit": "mg/dL", "referenceRange": "70-100", "isAbnormal": true }
    },
    "hematology": {
      "WBC": { "value": 12.5, "unit": "10³/μL", "referenceRange": "4.5-11.0", "isAbnormal": true },
      "RBC": { "value": 3.8, "unit": "10⁶/μL", "referenceRange": "4.5-5.5", "isAbnormal": true },
      "Hb": { "value": 10.2, "unit": "g/dL", "referenceRange": "13.5-17.5", "isAbnormal": true },
      "Hct": { "value": 30.5, "unit": "%", "referenceRange": "40-52", "isAbnormal": true },
      "PLT": { "value": 185, "unit": "10³/μL", "referenceRange": "150-400", "isAbnormal": false }
    },
    "bloodGas": {
      "pH": { "value": 7.35, "unit": "", "referenceRange": "7.35-7.45", "isAbnormal": false },
      "PCO2": { "value": 45, "unit": "mmHg", "referenceRange": "35-45", "isAbnormal": false },
      "PO2": { "value": 85, "unit": "mmHg", "referenceRange": "80-100", "isAbnormal": false },
      "HCO3": { "value": 24, "unit": "mmol/L", "referenceRange": "22-26", "isAbnormal": false },
      "Lactate": { "value": 2.1, "unit": "mmol/L", "referenceRange": "0.5-2.2", "isAbnormal": false }
    },
    "inflammatory": {
      "CRP": { "value": 8.5, "unit": "mg/L", "referenceRange": "<5", "isAbnormal": true },
      "PCT": { "value": 0.8, "unit": "ng/mL", "referenceRange": "<0.5", "isAbnormal": true }
    }
  }
}
```

### 3.2 獲取檢驗數據趨勢
```http
GET /patients/:id/lab-data/trends
```

**Query Parameters:**
```
labName: string (required - e.g., "K", "Na", "eGFR")
startDate: string (ISO 8601 - optional)
endDate: string (ISO 8601 - optional)
limit: number (default: 30)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "labName": "K",
    "labNameChinese": "血鉀",
    "unit": "mmol/L",
    "referenceRange": "3.5-5.0",
    "currentValue": 3.2,
    "trends": [
      {
        "date": "2024-11-10",
        "value": 4.2,
        "timestamp": "2024-11-10T08:00:00Z"
      },
      {
        "date": "2024-11-11",
        "value": 3.8,
        "timestamp": "2024-11-11T08:00:00Z"
      },
      {
        "date": "2024-11-12",
        "value": 3.5,
        "timestamp": "2024-11-12T08:00:00Z"
      },
      {
        "date": "2024-11-13",
        "value": 3.3,
        "timestamp": "2024-11-13T08:00:00Z"
      },
      {
        "date": "2024-11-14",
        "value": 3.2,
        "timestamp": "2024-11-14T08:00:00Z"
      }
    ]
  }
}
```

### 3.3 校正檢驗數據
```http
PATCH /patients/:id/lab-data/:labDataId/correct
```

**Request Body:**
```json
{
  "labName": "K",
  "oldValue": 3.2,
  "newValue": 3.5,
  "reason": "OCR 誤判，手動校正為實際數值",
  "correctedBy": "usr_001"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "labDataId": "lab_12345",
    "labName": "K",
    "oldValue": 3.2,
    "newValue": 3.5,
    "correctedAt": "2024-11-15T10:45:00Z",
    "correctedBy": {
      "id": "usr_001",
      "name": "王小華"
    },
    "reason": "OCR 誤判，手動校正為實際數值"
  }
}
```

### 3.4 上傳檢驗數據 (OCR 解析) - 僅 admin
```http
POST /patients/:id/lab-data/upload
```

**Request:**
```
Content-Type: multipart/form-data
```

**Form Data:**
```
file: [image file] (PNG, JPG, PDF)
patientId: "pat_001"
timestamp: "2024-11-15T08:30:00Z" (optional)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "labDataId": "lab_12346",
    "patientId": "pat_001",
    "uploadedAt": "2024-11-15T10:50:00Z",
    "ocrStatus": "completed",
    "parsedData": {
      "biochemistry": {
        "Na": 138,
        "K": 3.2,
        "Scr": 1.2
      }
    },
    "confidence": 0.95,
    "requiresReview": false
  }
}
```

---

## 4. 生命徵象 API

### 4.1 獲取病人最新生命徵象
```http
GET /patients/:id/vital-signs/latest
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "patientId": "pat_001",
    "timestamp": "2024-11-15T10:00:00Z",
    "vitals": {
      "temperature": { "value": 38.2, "unit": "°C", "isAbnormal": true },
      "heartRate": { "value": 95, "unit": "bpm", "isAbnormal": false },
      "bloodPressure": { "systolic": 120, "diastolic": 80, "unit": "mmHg", "isAbnormal": false },
      "respiratoryRate": { "value": 22, "unit": "rpm", "isAbnormal": false },
      "spo2": { "value": 94, "unit": "%", "isAbnormal": true }
    }
  }
}
```

### 4.2 獲取生命徵象趨勢
```http
GET /patients/:id/vital-signs/trends
```

**Query Parameters:**
```
vitalSign: string (required - e.g., "temperature", "heartRate")
startDate: string (ISO 8601 - optional)
endDate: string (ISO 8601 - optional)
limit: number (default: 30)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "vitalSign": "temperature",
    "unit": "°C",
    "referenceRange": "36.5-37.5",
    "trends": [
      {
        "timestamp": "2024-11-15T06:00:00Z",
        "value": 37.8
      },
      {
        "timestamp": "2024-11-15T08:00:00Z",
        "value": 38.2
      },
      {
        "timestamp": "2024-11-15T10:00:00Z",
        "value": 38.1
      }
    ]
  }
}
```

---

## 5. 用藥管理 API

### 5.1 獲取病人用藥列表
```http
GET /patients/:id/medications
```

**Query Parameters:**
```
category: string (optional - "SAN", "antibiotic", "other")
active: boolean (default: true)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "patientId": "pat_001",
    "medications": [
      {
        "id": "med_001",
        "name": "Morphine",
        "genericName": "Morphine Sulfate",
        "category": "analgesic",
        "sanCategory": "A",
        "dose": "2",
        "unit": "mg",
        "frequency": "q4h",
        "route": "IV",
        "prn": true,
        "indication": "Pain Score: 2/10",
        "startDate": "2024-11-10",
        "endDate": null,
        "prescribedBy": {
          "id": "doc_001",
          "name": "李醫師"
        },
        "warnings": [
          "併用 Dormicum，需注意呼吸抑制"
        ]
      },
      {
        "id": "med_002",
        "name": "Dormicum",
        "genericName": "Midazolam",
        "category": "sedative",
        "sanCategory": "S",
        "dose": "2",
        "unit": "mg",
        "frequency": "q4h",
        "route": "IV",
        "prn": true,
        "indication": "RASS Score: -2/4",
        "startDate": "2024-11-10",
        "endDate": null,
        "prescribedBy": {
          "id": "doc_001",
          "name": "李醫師"
        },
        "warnings": [
          "併用 Morphine，需注意呼吸抑制"
        ]
      }
    ]
  }
}
```

---

## 6. AI 對話助手 API

### 6.1 發送 AI 對話
```http
POST /ai/chat
```

**Request Body:**
```json
{
  "patientId": "pat_001",
  "sessionId": "chat_session_001",
  "message": "這位病患的鎮靜深度是否適當？",
  "context": {
    "includeLabData": true,
    "includeMedications": true,
    "includeVitalSigns": true
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messageId": "msg_12345",
    "sessionId": "chat_session_001",
    "response": "根據病患目前的檢驗數據與用藥狀況，我建議您注意以下幾點：\n\n1. 血鉀值偏低 (3.2 mmol/L)，建議補充鉀離子並監測。\n2. 目前使用 Morphine 與 Dormicum 併用，需注意呼吸抑制與過度鎮靜。\n3. 建議每日評估鎮靜深度（RASS 評分）。\n\n**所有輸出內容仍需依據您的專業判斷審慎評估與使用。**",
    "references": [
      "2018 PADIS Guideline (Pain, Agitation/Sedation, Delirium, Immobility, and Sleep)",
      "UpToDate: Causes and evaluation of hypokalemia in adults",
      "Morphine 仿單 - 衛福部藥品許可證",
      "Midazolam 仿單 - 衛福部藥品許可證"
    ],
    "timestamp": "2024-11-15T11:00:00Z",
    "tokensUsed": 450
  }
}
```

### 6.2 獲取對話記錄列表
```http
GET /patients/:id/chat-sessions
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "chat_session_001",
        "patientId": "pat_001",
        "title": "鎮靜深度評估與血鉀討論",
        "sessionDate": "2024-11-15",
        "sessionTime": "10:30",
        "lastUpdated": "2024-11-15T11:00:00Z",
        "messageCount": 6,
        "labDataSnapshot": {
          "K": 3.2,
          "Na": 138,
          "eGFR": 58,
          "CRP": 8.5
        },
        "createdBy": {
          "id": "usr_001",
          "name": "王小華"
        }
      }
    ]
  }
}
```

### 6.3 獲取單一對話記錄詳情
```http
GET /patients/:id/chat-sessions/:sessionId
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "chat_session_001",
    "patientId": "pat_001",
    "title": "鎮靜深度評估與血鉀討論",
    "sessionDate": "2024-11-15",
    "sessionTime": "10:30",
    "lastUpdated": "2024-11-15T11:00:00Z",
    "messages": [
      {
        "id": "msg_001",
        "role": "user",
        "content": "這位病患的鎮靜深度是否適當？",
        "timestamp": "2024-11-15T10:30:00Z"
      },
      {
        "id": "msg_002",
        "role": "assistant",
        "content": "根據病患目前的檢驗數據...",
        "references": ["2018 PADIS Guideline", "UpToDate"],
        "timestamp": "2024-11-15T10:30:15Z"
      }
    ],
    "labDataSnapshot": {
      "K": 3.2,
      "Na": 138,
      "eGFR": 58
    }
  }
}
```

### 6.4 更新對話標題
```http
PATCH /patients/:id/chat-sessions/:sessionId
```

**Request Body:**
```json
{
  "title": "更新後的對話標題"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sessionId": "chat_session_001",
    "title": "更新後的對話標題",
    "updatedAt": "2024-11-15T11:30:00Z"
  }
}
```

---

## 7. Progress Note / 護理記錄輔助 API

### 7.1 AI 修飾 Progress Note (醫師)
```http
POST /ai/progress-note/polish
```

**Request Body:**
```json
{
  "patientId": "pat_001",
  "rawContent": "病人今天狀況穩定，血鉀偏低已補充，目前插管中...",
  "includeLabData": true,
  "language": "en"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "polishedContent": "Assessment:\nPatient remains intubated on day 5 of ICU stay. Currently receiving mechanical ventilation. Hemodynamics stable on current support.\n\nLaboratory findings show potassium 3.2 mEq/L, creatinine 1.2 mg/dL, with eGFR 58 mL/min. Inflammatory markers: CRP 8.5 mg/L.\n\nPlan:\n- Continue current ventilator settings\n- Monitor electrolytes and adjust supplementation as needed\n- Titrate sedation to target RASS -2\n- Daily assessment for extubation readiness",
    "tokensUsed": 300
  }
}
```

### 7.2 AI 修飾護理記錄 (護理師)
```http
POST /ai/nursing-record/polish
```

**Request Body:**
```json
{
  "patientId": "pat_001",
  "recordType": "nursing-record",
  "rawContent": "病患今日意識清楚，呼吸平穩，血壓穩定...",
  "language": "zh-TW"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "polishedContent": "【護理評估】\n病患今日意識清楚，GCS 15分。呼吸型態規律，呼吸音清晰，無異常囉音。\n\n【生命徵象】\n體溫 37.8°C，心跳 85次/分，血壓 120/80 mmHg，呼吸 18次/分，血氧飽和度 96%。\n\n【護理措施】\n1. 持續監測生命徵象\n2. 協助翻身拍背，預防壓瘡\n3. 維持管路通暢\n\n【病患反應】\n病患配合度良好，無不適主訴。",
    "tokensUsed": 250
  }
}
```

---

## 8. 留言板 API

### 8.1 獲取病人留言列表
```http
GET /patients/:id/messages
```

**Query Parameters:**
```
messageType: string (optional - "general", "medication-advice", "alert")
isRead: boolean (optional)
page: number (default: 1)
limit: number (default: 50)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg_001",
        "patientId": "pat_001",
        "authorId": "usr_004",
        "authorName": "陳藥師",
        "authorRole": "pharmacist",
        "messageType": "medication-advice",
        "content": "建議調整 Warfarin 劑量...",
        "linkedMedication": "Warfarin",
        "timestamp": "2024-11-15T09:30:00Z",
        "isRead": false,
        "readBy": []
      }
    ],
    "unreadCount": 2
  }
}
```

### 8.2 發送留言
```http
POST /patients/:id/messages
```

**Request Body:**
```json
{
  "content": "建議監測血鉀值，必要時補充",
  "messageType": "medication-advice",
  "linkedMedication": "KCl"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messageId": "msg_002",
    "patientId": "pat_001",
    "authorId": "usr_004",
    "authorName": "陳藥師",
    "content": "建議監測血鉀值，必要時補充",
    "messageType": "medication-advice",
    "linkedMedication": "KCl",
    "timestamp": "2024-11-15T11:30:00Z"
  }
}
```

### 8.3 標記留言為已讀
```http
PATCH /patients/:id/messages/:messageId/read
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messageId": "msg_001",
    "isRead": true,
    "readBy": [
      {
        "userId": "usr_001",
        "userName": "王小華",
        "readAt": "2024-11-15T11:45:00Z"
      }
    ]
  }
}
```

---

## 9. 病歷記錄 API

### 9.1 獲取病歷記錄列表
```http
GET /patients/:id/medical-records
```

**Query Parameters:**
```
recordType: string (optional - "progress-note", "nursing-record", "consultation")
startDate: string (ISO 8601 - optional)
endDate: string (ISO 8601 - optional)
page: number (default: 1)
limit: number (default: 20)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "rec_001",
        "patientId": "pat_001",
        "recordType": "progress-note",
        "title": "ICU Day 5 Progress Note",
        "content": "Assessment: Patient remains intubated...",
        "polishedContent": "...",
        "createdBy": {
          "id": "doc_001",
          "name": "李醫師"
        },
        "createdAt": "2024-11-15T08:00:00Z",
        "updatedAt": "2024-11-15T08:15:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 35,
      "totalPages": 2
    }
  }
}
```

### 9.2 創建病歷記錄
```http
POST /patients/:id/medical-records
```

**Request Body:**
```json
{
  "recordType": "nursing-record",
  "title": "日班護理記錄",
  "content": "病患今日意識清楚...",
  "polishedContent": "【護理評估】病患今日意識清楚..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "recordId": "rec_002",
    "patientId": "pat_001",
    "recordType": "nursing-record",
    "title": "日班護理記錄",
    "createdAt": "2024-11-15T11:50:00Z"
  }
}
```

---

## 10. 藥物交互作用 API

### 10.1 查詢藥物交互作用
```http
POST /pharmacy/drug-interactions/check
```

**Request Body:**
```json
{
  "medications": [
    { "name": "Warfarin", "dose": "5mg" },
    { "name": "Amiodarone", "dose": "200mg" }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "interactions": [
      {
        "id": "int_001",
        "drug1": "Warfarin",
        "drug2": "Amiodarone",
        "severity": "major",
        "mechanism": "Amiodarone 抑制 CYP2C9 酵素，減少 Warfarin 代謝",
        "clinicalEffect": "增加出血風險，INR 值可能顯著上升",
        "management": "併用時需密切監測 INR，通常需將 Warfarin 劑量減少 30-50%",
        "references": "Micromedex, UpToDate"
      }
    ],
    "totalInteractions": 1,
    "hasMajorInteractions": true
  }
}
```

### 10.2 獲取病人藥物交互作用分析
```http
GET /patients/:id/drug-interactions
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "patientId": "pat_001",
    "currentMedications": ["Warfarin", "Amiodarone", "Morphine", "Dormicum"],
    "interactions": [
      {
        "id": "int_001",
        "drug1": "Warfarin",
        "drug2": "Amiodarone",
        "severity": "major",
        "mechanism": "...",
        "clinicalEffect": "...",
        "management": "...",
        "references": "Micromedex, UpToDate"
      },
      {
        "id": "int_002",
        "drug1": "Morphine",
        "drug2": "Dormicum",
        "severity": "moderate",
        "mechanism": "加成性中樞神經抑制效果",
        "clinicalEffect": "呼吸抑制、過度鎮靜、低血壓",
        "management": "密切監測呼吸狀態、鎮靜深度（RASS評分）與血壓",
        "references": "MICROMEDEX"
      }
    ],
    "summary": {
      "total": 2,
      "major": 1,
      "moderate": 1,
      "minor": 0
    }
  }
}
```

---

## 11. 靜脈注射相容性 API

### 11.1 查詢 IV 相容性
```http
POST /pharmacy/iv-compatibility/check
```

**Request Body:**
```json
{
  "drug1": "Propofol",
  "drug2": "Fentanyl",
  "solution": "NS"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "comp_001",
    "drug1": "Propofol",
    "drug2": "Fentanyl",
    "solution": "NS",
    "compatible": false,
    "timeStability": null,
    "notes": "需使用不同輸注管路，Propofol 會吸附 Fentanyl",
    "references": "Micromedex IV Compatibility"
  }
}
```

---

## 12. 劑量計算 API

### 12.1 計算藥物劑量
```http
POST /pharmacy/dosage/calculate
```

**Request Body:**
```json
{
  "medication": "Vancomycin",
  "patientWeight": 65,
  "patientHeight": 170,
  "renalFunction": {
    "scr": 1.2,
    "eGFR": 58
  },
  "indication": "MRSA infection"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "medication": "Vancomycin",
    "recommendedDose": {
      "loading": {
        "dose": "1500",
        "unit": "mg",
        "route": "IV",
        "duration": "over 2 hours"
      },
      "maintenance": {
        "dose": "1000",
        "unit": "mg",
        "frequency": "q12h",
        "route": "IV"
      }
    },
    "adjustment": {
      "reason": "腎功能不全 (eGFR 58 mL/min)",
      "recommendation": "建議監測 Trough level，目標 15-20 μg/mL"
    },
    "warnings": [
      "需監測腎功能",
      "需監測聽力功能"
    ],
    "references": "UpToDate: Vancomycin dosing in adults"
  }
}
```

---

## 13. 藥師用藥建議 API

### 13.1 AI 產生用藥建議
```http
POST /pharmacy/advice/generate
```

**Request Body:**
```json
{
  "patientId": "pat_001",
  "concernType": "drug-interaction",
  "concernDetails": "Warfarin + Amiodarone 併用",
  "includePatientData": true
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "adviceId": "adv_001",
    "patientId": "pat_001",
    "concernType": "drug-interaction",
    "rawAdvice": "...",
    "polishedAdvice": "【用藥安全建議】\n\n藥品：Warfarin + Amiodarone\n\n交互作用風險：\nAmiodarone 會抑制 CYP2C9 酵素...\n\n建議處置：\n1. 密切監測 INR 值\n2. 考慮將 Warfarin 劑量減少 30-50%\n3. 加強出血徵象監測\n\n參考依據：Micromedex, UpToDate",
    "references": ["Micromedex", "UpToDate"],
    "createdAt": "2024-11-15T12:00:00Z"
  }
}
```

### 13.2 發送用藥建議到病患留言板
```http
POST /pharmacy/advice/:adviceId/send-to-patient
```

**Request Body:**
```json
{
  "patientId": "pat_001",
  "adviceContent": "【用藥安全建議】..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messageId": "msg_003",
    "patientId": "pat_001",
    "adviceId": "adv_001",
    "sentAt": "2024-11-15T12:05:00Z"
  }
}
```

### 13.3 獲取藥師建議統計
```http
GET /pharmacy/advice/statistics
```

**Query Parameters:**
```
startDate: string (ISO 8601 - optional)
endDate: string (ISO 8601 - optional)
pharmacistId: string (optional)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "totalAdvice": 45,
    "byType": {
      "drug-interaction": 20,
      "dosage-adjustment": 15,
      "adverse-reaction": 10
    },
    "byStatus": {
      "pending": 5,
      "sent": 35,
      "acknowledged": 30
    },
    "topPharmacists": [
      {
        "pharmacistId": "usr_004",
        "pharmacistName": "陳藥師",
        "adviceCount": 25
      }
    ]
  }
}
```

---

## 14. 團隊聊天室 API

### 14.1 獲取聊天訊息
```http
GET /chat/messages
```

**Query Parameters:**
```
limit: number (default: 50)
before: string (message ID - for pagination)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "chat_msg_001",
        "userId": "usr_001",
        "userName": "王小華",
        "userRole": "nurse",
        "content": "A01 床的病人血鉀偏低，已通知醫師",
        "timestamp": "2024-11-15T10:30:00Z",
        "edited": false
      }
    ],
    "hasMore": true
  }
}
```

### 14.2 發送聊天訊息
```http
POST /chat/messages
```

**Request Body:**
```json
{
  "content": "收到，會密切監測"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messageId": "chat_msg_002",
    "userId": "usr_002",
    "userName": "李醫師",
    "userRole": "doctor",
    "content": "收到，會密切監測",
    "timestamp": "2024-11-15T10:32:00Z"
  }
}
```

---

## 15. 管理功能 API

### 15.1 獲取稽核日誌 (僅 admin)
```http
GET /admin/audit-logs
```

**Query Parameters:**
```
userId: string (optional)
action: string (optional - "login", "edit_patient", "upload_lab", "ai_query")
startDate: string (ISO 8601 - optional)
endDate: string (ISO 8601 - optional)
page: number (default: 1)
limit: number (default: 50)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "log_001",
        "userId": "usr_001",
        "userName": "王小華",
        "userRole": "nurse",
        "action": "view_patient",
        "targetType": "patient",
        "targetId": "pat_001",
        "targetName": "陳大明",
        "details": {
          "page": "patient-detail",
          "tab": "labs"
        },
        "ipAddress": "192.168.1.100",
        "userAgent": "Mozilla/5.0...",
        "timestamp": "2024-11-15T10:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 1250,
      "totalPages": 25
    }
  }
}
```

### 15.2 獲取用戶列表 (僅 admin)
```http
GET /admin/users
```

**Query Parameters:**
```
role: string (optional - "nurse", "doctor", "pharmacist", "admin")
unit: string (optional)
search: string (optional)
page: number (default: 1)
limit: number (default: 50)
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "usr_001",
        "name": "王小華",
        "email": "nurse@hospital.com",
        "role": "nurse",
        "unit": "加護病房一",
        "active": true,
        "lastLogin": "2024-11-15T09:00:00Z",
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 120,
      "totalPages": 3
    }
  }
}
```

### 15.3 創建用戶 (僅 admin)
```http
POST /admin/users
```

**Request Body:**
```json
{
  "name": "張護理師",
  "email": "nurse2@hospital.com",
  "role": "nurse",
  "unit": "加護病房二",
  "password": "<GENERATED_BY_SYSTEM>"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "userId": "usr_005",
    "name": "張護理師",
    "email": "nurse2@hospital.com",
    "role": "nurse",
    "unit": "加護病房二",
    "createdAt": "2024-11-15T12:00:00Z",
    "temporaryPassword": "<GENERATED_BY_SYSTEM>"
  }
}
```

### 15.4 更新用戶 (僅 admin)
```http
PATCH /admin/users/:userId
```

**Request Body:**
```json
{
  "role": "doctor",
  "unit": "內科加護病房",
  "active": true
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "userId": "usr_005",
    "updatedFields": ["role", "unit", "active"],
    "updatedAt": "2024-11-15T12:10:00Z"
  }
}
```

### 15.5 向量資料庫管理 (僅 admin)
```http
GET /admin/vectors
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "collections": [
      {
        "name": "clinical_guidelines",
        "documentCount": 250,
        "lastUpdated": "2024-11-10T00:00:00Z",
        "size": "1.2 GB"
      },
      {
        "name": "drug_information",
        "documentCount": 1500,
        "lastUpdated": "2024-11-12T00:00:00Z",
        "size": "3.5 GB"
      }
    ],
    "totalDocuments": 1750,
    "totalSize": "4.7 GB"
  }
}
```

### 15.6 上傳向量資料 (僅 admin)
```http
POST /admin/vectors/upload
```

**Request:**
```
Content-Type: multipart/form-data
```

**Form Data:**
```
file: [PDF/DOCX/TXT file]
collection: "clinical_guidelines"
metadata: { "type": "guideline", "year": "2024" }
```

**Response (200):**
```json
{
  "success": true,
  "message": "文件已上傳並完成索引：PADIS_Guideline_2024.pdf",
  "data": {
    "documentId": "doc_001",
    "fileName": "PADIS_Guideline_2024.pdf",
    "collection": "clinical_guidelines",
    "status": "indexed",
    "database": {
      "id": "rag-main",
      "name": "RAG 醫療文件庫",
      "documentCount": 251,
      "chunkCount": 8432,
      "status": "active",
      "embeddingModel": "tfidf"
    },
    "metadata": {
      "type": "guideline",
      "year": "2024"
    }
  }
}
```

---

## 資料模型

### User (用戶)
```typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: 'nurse' | 'doctor' | 'admin' | 'pharmacist';
  unit: string;
  active: boolean;
  lastLogin: string; // ISO 8601
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### Patient (病人)
```typescript
interface Patient {
  id: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  bedNumber: string;
  height: number; // cm
  weight: number; // kg
  bmi: number;
  admissionDate: string; // YYYY-MM-DD
  icuAdmissionDate: string; // YYYY-MM-DD
  diagnosis: string;
  symptoms: string[];
  intubated: boolean;
  criticalStatus: string;
  alerts: string[];
  allergies: string[];
  bloodType: string;
  codeStatus: string;
}
```

### LabData (檢驗數據)
```typescript
interface LabData {
  id: string;
  patientId: string;
  timestamp: string; // ISO 8601
  biochemistry: Record<string, LabValue>;
  hematology: Record<string, LabValue>;
  bloodGas: Record<string, LabValue>;
  inflammatory: Record<string, LabValue>;
  coagulation: Record<string, LabValue>;
  uploadedBy?: string; // user ID
  correctedBy?: string; // user ID
  correctionReason?: string;
}

interface LabValue {
  value: number;
  unit: string;
  referenceRange: string;
  isAbnormal: boolean;
}
```

### Medication (藥物)
```typescript
interface Medication {
  id: string;
  patientId: string;
  name: string;
  genericName: string;
  category: string;
  sanCategory?: 'S' | 'A' | 'N';
  dose: string;
  unit: string;
  frequency: string;
  route: string;
  prn: boolean;
  indication?: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  prescribedBy: {
    id: string;
    name: string;
  };
  warnings: string[];
  active: boolean;
}
```

### ChatSession (對話記錄)
```typescript
interface ChatSession {
  id: string;
  patientId: string;
  title: string;
  sessionDate: string; // YYYY-MM-DD
  sessionTime: string; // HH:mm
  lastUpdated: string; // ISO 8601
  messages: ChatMessage[];
  labDataSnapshot?: Record<string, number>;
  createdBy: {
    id: string;
    name: string;
  };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references?: string[];
  timestamp: string; // ISO 8601
}
```

### PatientMessage (病患留言)
```typescript
interface PatientMessage {
  id: string;
  patientId: string;
  authorId: string;
  authorName: string;
  authorRole: 'nurse' | 'doctor' | 'pharmacist' | 'admin';
  messageType: 'general' | 'medication-advice' | 'alert';
  content: string;
  linkedMedication?: string;
  timestamp: string; // ISO 8601
  isRead: boolean;
  readBy: Array<{
    userId: string;
    userName: string;
    readAt: string; // ISO 8601
  }>;
}
```

### DrugInteraction (藥物交互作用)
```typescript
interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: 'major' | 'moderate' | 'minor';
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references?: string;
}
```

### AuditLog (稽核日誌)
```typescript
interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  details?: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  timestamp: string; // ISO 8601
}
```

---

## 前後端互動流程

### 1. 登入流程
```
1. 使用者輸入帳密 → POST /auth/login
2. 後端驗證 → 回傳 JWT token
3. 前端儲存 token 到 localStorage
4. 前端設置 Axios interceptor，自動帶 Authorization header
5. 導航到 /dashboard
```

### 2. 查看病人詳細資料流程
```
1. 點擊病人 → GET /patients/:id
2. 同時並行請求：
   - GET /patients/:id/lab-data/latest
   - GET /patients/:id/vital-signs/latest
   - GET /patients/:id/medications
   - GET /patients/:id/messages
3. 渲染病人詳細頁面
```

### 3. AI 對話流程
```
1. 用戶輸入訊息 → POST /ai/chat
2. 後端處理 AI 請求（可能需要 streaming）
3. 回傳 AI 回應 + 參考依據
4. 自動儲存對話記錄
```

### 4. 檢驗數據校正流程
```
1. 用戶點擊校正 → 顯示對話框
2. 輸入新數值 + 理由 → PATCH /patients/:id/lab-data/:labDataId/correct
3. 後端記錄稽核日誌
4. 前端更新顯示
```

### 5. 藥師發送用藥建議流程
```
1. 藥師輸入建議 → POST /pharmacy/advice/generate
2. AI 修飾建議內容
3. 藥師確認 → POST /pharmacy/advice/:adviceId/send-to-patient
4. 建議出現在病患留言板
5. 醫護收到通知
```

---

## 錯誤處理

### 標準錯誤格式
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "人類可讀的錯誤訊息",
    "details": {}
  }
}
```

### 常見錯誤碼

| HTTP Status | Error Code | 說明 |
|-------------|-----------|------|
| 400 | INVALID_REQUEST | 請求參數錯誤 |
| 401 | UNAUTHORIZED | 未登入或 token 過期 |
| 403 | FORBIDDEN | 權限不足 |
| 404 | NOT_FOUND | 資源不存在 |
| 409 | CONFLICT | 資源衝突 |
| 429 | RATE_LIMIT_EXCEEDED | 請求頻率超限 |
| 500 | INTERNAL_SERVER_ERROR | 伺服器錯誤 |
| 503 | SERVICE_UNAVAILABLE | 服務暫時不可用 |

---

## 安全性要求

### 1. 認證機制
- 使用 JWT (JSON Web Token)
- Access token 有效期：24小時
- Refresh token 有效期：7天
- Token 需加密存儲

### 2. 權限控管
- 所有 API 都需驗證 token
- 根據用戶角色進行權限檢查
- 敏感操作需二次驗證

### 3. 資料保護
- 所有傳輸使用 HTTPS
- 敏感資料加密存儲
- 病人資料符合 HIPAA/GDPR 規範
- 不得外洩病人個資

### 4. 稽核日誌
- 記錄所有重要操作
- 包含：誰、何時、做了什麼、對象是誰
- 日誌不可刪除，僅可查詢

### 5. 速率限制
- 一般 API：每分鐘 60 次
- AI API：每分鐘 10 次
- 登入 API：每分鐘 5 次

---

## WebSocket 需求 (即時功能)

### 團隊聊天室
```
WebSocket URL: wss://api.chaticu.hospital/v1/ws/chat

連線時需帶 token:
?token={jwt_token}

訊息格式:
{
  "type": "message",
  "data": {
    "userId": "usr_001",
    "userName": "王小華",
    "content": "訊息內容",
    "timestamp": "2024-11-15T10:30:00Z"
  }
}
```

### 病患留言通知
```
WebSocket URL: wss://api.chaticu.hospital/v1/ws/notifications

訊息格式:
{
  "type": "new_patient_message",
  "data": {
    "patientId": "pat_001",
    "patientName": "陳大明",
    "messageId": "msg_001",
    "authorName": "陳藥師",
    "messageType": "medication-advice"
  }
}
```

---

## 附錄

### A. 測試帳號
```
護理師: nurse / nurse
醫師: doctor / doctor
管理者: admin / admin
藥師: pharmacist / pharmacist
```

### B. 前端技術棧清單
```json
{
  "dependencies": {
    "react": "^18.0.0",
    "react-router-dom": "^6.0.0",
    "axios": "^1.6.0",
    "recharts": "^2.10.0",
    "lucide-react": "latest",
    "sonner": "^2.0.3"
  }
}
```

### C. 建議的後端技術棧
- Node.js + Express / NestJS
- PostgreSQL (病人資料、用藥、檢驗數據)
- Redis (快取、Session)
- Pinecone / Weaviate (向量資料庫)
- OpenAI API / Azure OpenAI (AI 功能)
- Socket.io (WebSocket)

---

## 聯絡資訊
- **前端負責人**: [姓名]
- **Email**: [email]
- **最後更新**: 2026-01-10
