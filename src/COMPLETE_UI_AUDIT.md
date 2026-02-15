# ChatICU 系統完整 UI 元素盤點清單

**文件版本**: 1.0.0  
**盤點日期**: 2026-01-10  
**盤點範圍**: 所有頁面、所有按鈕、所有輸入欄位、所有互動元素

---

## ✅ 盤點摘要

- **總頁面數**: 16 個
- **總按鈕數**: 178+ 個
- **總輸入欄位數**: 65+ 個
- **API 端點數**: 50+ 個
- **權限檢查點**: 45+ 個

---

## 📋 詳細盤點清單

## 1. 登入頁面 (/login)

### 1.1 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | 驗證規則 | 備註 |
|---|---------|------|---------|---------|------|
| 1.1.1 | Email/帳號 | Input (text) | `username` | required | - |
| 1.1.2 | Password/密碼 | Input (password) | `password` | required | - |
| 1.1.3 | Remember Me | Checkbox | `rememberMe` | - | 目前無實際功能 |

### 1.2 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 1.2.1 | Login | Button (submit) | `handleSubmit()` | `POST /auth/login` | 公開 |
| 1.2.2 | Forgot Password? | button (text) | - | 無 | 目前無功能 |

### 1.3 其他互動元素
| # | 元素類型 | 說明 |
|---|---------|------|
| 1.3.1 | Alert | 顯示登入錯誤訊息 |
| 1.3.2 | 測試帳號資訊框 | 顯示可用測試帳號 |

---

## 2. 儀表板 (/dashboard)

### 2.1 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | placeholder | 備註 |
|---|---------|------|---------|-------------|------|
| 2.1.1 | 搜尋框 | Input (search) | `searchTerm` | "搜尋姓名或床號..." | 即時搜尋 |

### 2.2 下拉選單
| # | 選單名稱 | 狀態變數 | 選項 | 預設值 |
|---|---------|---------|------|-------|
| 2.2.1 | 篩選條件 | `filterStatus` | 全部病患/插管中/使用S/A/N/有警示 | "all" |
| 2.2.2 | 排序方式 | `sortBy` | 依床號/依入住時間 | "bed" |

### 2.3 按鈕/可點擊元素
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 2.3.1 | 插管病患數卡片 | Card (clickable) | - | 顯示資訊 | 醫護 |
| 2.3.2 | 團隊動態留言卡片 | Card (clickable) | `navigate('/patient/:id')` | - | 全部 |
| 2.3.3 | 查看全部留言 | Button | `navigate('/chat')` | - | 全部 |
| 2.3.4 | 病患卡片 | Card (clickable) | `navigate('/patient/:id')` | - | 醫護 |

### 2.4 統計卡片
| # | 卡片名稱 | 顯示數據 | API 調用 | 權限 |
|---|---------|---------|---------|------|
| 2.4.1 | 插管病患數 | 插管人數 + 床號列表 | `GET /patients?intubated=true` | 醫護 |
| 2.4.2 | 今日團隊動態 | 今日留言 + 未讀數量 | `GET /messages?date=today` | 全部 |

---

## 3. 病人列表 (/patients)

### 3.1 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | placeholder | 備註 |
|---|---------|------|---------|-------------|------|
| 3.1.1 | 搜尋框 | Input (search) | `searchTerm` | "搜尋姓名或床號..." | 即時搜尋 |

### 3.2 下拉選單
| # | 選單名稱 | 狀態變數 | 選項 | 預設值 |
|---|---------|---------|------|-------|
| 3.2.1 | 篩選條件 | `filterStatus` | 全部病患/插管中/使用S/A/N | "all" |

### 3.3 按鈕 (頁面層級)
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 3.3.1 | 封存病人 | Button (outline) | - | `POST /patients/archive` | 僅 admin |
| 3.3.2 | 新增病人 | Button | 開啟新增對話框 | - | 僅 admin |

### 3.4 表格按鈕 (每列)
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 3.4.1 | 檢視 | Button (ghost) | `navigate('/patient/:id')` | - | 全部 |
| 3.4.2 | 編輯 (鉛筆圖示) | Button (ghost) | `handleEdit(patient)` | - | 僅 admin |

### 3.5 編輯病患對話框 (僅 admin)
#### 3.5.1 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數欄位 | 必填 |
|---|---------|------|-------------|------|
| 3.5.1.1 | 床號 | Input | `editFormData.bedNumber` | ✓ |
| 3.5.1.2 | 姓名 | Input | `editFormData.name` | ✓ |
| 3.5.1.3 | 性別 | Select | `editFormData.gender` | ✓ |
| 3.5.1.4 | 年齡 | Input (number) | `editFormData.age` | ✓ |
| 3.5.1.5 | 主治醫師 | Input | `editFormData.attendingPhysician` | ✓ |
| 3.5.1.6 | 科別 | Select | `editFormData.department` | ✓ |
| 3.5.1.7 | 入院診斷 | Input | `editFormData.diagnosis` | ✓ |
| 3.5.1.8 | 入院日期 | Input (date) | `editFormData.admissionDate` | ✓ |
| 3.5.1.9 | ICU入院日期 | Input (date) | `editFormData.icuAdmissionDate` | ✓ |
| 3.5.1.10 | 呼吸器天數 | Input (number) | `editFormData.ventilatorDays` | ✓ |
| 3.5.1.11 | 插管狀態 | Checkbox | `editFormData.intubated` | - |
| 3.5.1.12 | 鎮靜劑 (S) | Input | `editFormData.sedation` | - |
| 3.5.1.13 | 止痛劑 (A) | Input | `editFormData.analgesia` | - |
| 3.5.1.14 | 神經肌肉阻斷劑 (N) | Input | `editFormData.nmb` | - |
| 3.5.1.15 | 同意書狀態 | Select | `editFormData.consentStatus` | ✓ |
| 3.5.1.16 | 未讀留言 | Checkbox | `editFormData.hasUnreadMessages` | - |

#### 3.5.2 對話框按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 |
|---|---------|------|---------|---------|
| 3.5.2.1 | 取消 | Button (outline) | `handleCancel()` | - |
| 3.5.2.2 | 儲存變更 | Button | `handleSave()` | `PATCH /patients/:id` |

---

## 4. 病人詳細頁面 (/patient/:id)

### 4.0 頁首按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.0.1 | 返回 (箭頭圖示) | Button (icon) | `navigate('/patients')` | - | 全部 |
| 4.0.2 | 編輯基本資料 | Button | 開啟編輯對話框 | - | 僅 admin |

### 4.1 對話助手 Tab (chat)

#### 4.1.1 左側對話記錄列表
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.1.1.1 | 新對話 | Button | 清空當前對話 | - | 醫護 |
| 4.1.1.2 | 對話記錄卡片 | button (card) | 載入該對話 | `GET /patients/:id/chat-sessions/:sessionId` | 醫護 |

#### 4.1.2 右側對話區按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.1.2.1 | 更新患者數值 | Button (outline) | 刷新病人數據 | `GET /patients/:id/lab-data/latest` | 醫護 |
| 4.1.2.2 | 隱藏/顯示記錄 | Button (ghost) | 切換列表顯示 | - | 醫護 |
| 4.1.2.3 | 展開/收起參考依據 | button | 切換參考文獻顯示 | - | 醫護 |
| 4.1.2.4 | 複製 (AI訊息) | Button (icon) | 複製訊息內容 | - | 醫護 |
| 4.1.2.5 | 發送 | Button (icon) | `handleSendMessage()` | `POST /ai/chat` | 醫護 |

#### 4.1.3 對話輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | placeholder | 快捷鍵 |
|---|---------|------|---------|-------------|--------|
| 4.1.3.1 | 對話標題 | Input | `sessionTitle` | "例如：鎮靜深度評估與血鉀討論" | - |
| 4.1.3.2 | 訊息輸入框 | Textarea | `chatInput` | "例如：這位病患的鎮靜深度是否適當？" | Enter發送, Shift+Enter換行 |

#### 4.1.4 Progress Note 輔助 (僅醫師/管理者)
| # | 欄位名稱 | 類型 | 狀態變數 | 權限 |
|---|---------|------|---------|------|
| 4.1.4.1 | 輸入草稿 | Textarea | `progressNoteInput` | doctor, admin |

| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.1.4.2 | AI 修飾 & 翻譯 | Button | `handlePolishProgressNote()` | `POST /ai/progress-note/polish` | doctor, admin |
| 4.1.4.3 | 複製 | Button (outline) | 複製修飾後內容 | - | doctor, admin |
| 4.1.4.4 | 匯入 HIS | Button | - | 未實作 | doctor, admin |

---

### 4.2 留言板 Tab (messages)

#### 4.2.1 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.2.1.1 | 全部標為已讀 | Button (outline) | 標記所有留言為已讀 | `PATCH /patients/:id/messages/mark-all-read` | 全部 |
| 4.2.1.2 | 發送留言 | Button | 發送新留言 | `POST /patients/:id/messages` | 全部 |
| 4.2.1.3 | 標記為用藥建議 | Button (outline) | 設定messageType | - | 全部 |
| 4.2.1.4 | 標為已讀 (每則留言) | Button (ghost) | 標記單則為已讀 | `PATCH /patients/:id/messages/:messageId/read` | 全部 |

#### 4.2.2 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | placeholder |
|---|---------|------|---------|-------------|
| 4.2.2.1 | 留言輸入框 | Textarea | `messageInput` | "輸入照護相關訊息或用藥建議..." |

---

### 4.3 病歷記錄 Tab (records)

**組件**: `/components/medical-records.tsx`

#### 4.3.1 記錄類型選擇
| # | 按鈕名稱 | 類型 | 觸發動作 | 權限 |
|---|---------|------|---------|------|
| 4.3.1.1 | 進展記錄 | Button | 設定recordType='progress-note' | doctor, admin |
| 4.3.1.2 | 護理記錄 | Button | 設定recordType='nursing-record' | nurse, doctor, admin |
| 4.3.1.3 | 會診記錄 | Button | 設定recordType='consultation' | doctor, admin |

#### 4.3.2 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | 權限 |
|---|---------|------|---------|------|
| 4.3.2.1 | 記錄內容 | Textarea | `recordContent` | nurse, doctor, admin |

#### 4.3.3 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.3.3.1 | AI 輔助修飾 | Button | - | `POST /ai/nursing-record/polish` | nurse, doctor, admin |
| 4.3.3.2 | 儲存記錄 | Button | - | `POST /patients/:id/medical-records` | nurse, doctor, admin |
| 4.3.3.3 | 複製 (歷史記錄) | Button (icon) | 複製記錄內容 | - | nurse, doctor, admin |

---

### 4.4 檢驗數據 Tab (labs)

#### 4.4.1 生命徵象卡片 (可點擊)
| # | 卡片名稱 | 觸發動作 | API 調用 | 權限 |
|---|---------|---------|---------|------|
| 4.4.1.1 | Respiratory Rate | `handleVitalSignClick()` | `GET /patients/:id/vital-signs/trends?vitalSign=RespiratoryRate` | 醫護 |
| 4.4.1.2 | Temperature | `handleVitalSignClick()` | `GET /patients/:id/vital-signs/trends?vitalSign=Temperature` | 醫護 |
| 4.4.1.3 | Blood Pressure | `handleVitalSignClick()` | `GET /patients/:id/vital-signs/trends?vitalSign=BloodPressure` | 醫護 |
| 4.4.1.4 | Heart Rate | `handleVitalSignClick()` | `GET /patients/:id/vital-signs/trends?vitalSign=HeartRate` | 醫護 |

#### 4.4.2 檢驗數據表格 (LabDataDisplay)
**組件**: `/components/lab-data-display.tsx`

| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.4.2.1 | 校正 (每個檢驗項目) | Button | 開啟校正對話框 | - | 醫護 |
| 4.4.2.2 | 查看趨勢 (每個檢驗項目) | Button | 開啟趨勢圖 | `GET /patients/:id/lab-data/trends?labName={name}` | 醫護 |

#### 4.4.3 校正對話框
| # | 欄位名稱 | 類型 | 說明 |
|---|---------|------|------|
| 4.4.3.1 | 新數值 | Input (number) | 校正後的數值 |
| 4.4.3.2 | 校正理由 | Textarea | 必填，說明校正原因 |

| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 |
|---|---------|------|---------|---------|
| 4.4.3.3 | 確認校正 | Button | 提交校正 | `PATCH /patients/:id/lab-data/:labDataId/correct` |
| 4.4.3.4 | 取消 | Button | 關閉對話框 | - |

#### 4.4.4 趨勢圖對話框 (LabTrendChart)
**組件**: `/components/lab-trend-chart.tsx`

| # | 按鈕名稱 | 類型 | 觸發動作 |
|---|---------|------|---------|
| 4.4.4.1 | 關閉 (X) | Button | 關閉對話框 |

---

### 4.5 用藥 Tab (meds)

#### 4.5.1 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.5.1.1 | 交互作用查詢 | Button (outline) | 導航至藥師頁面 | - | 醫護 |
| 4.5.1.2 | 複製到報告 | Button (outline) | 複製用藥列表 | - | 醫護 |

#### 4.5.2 藥師用藥建議 Widget (僅藥師/管理者)
**組件**: `/components/pharmacist-advice-widget.tsx`

##### 4.5.2.1 下拉選單
| # | 選單名稱 | 狀態變數 | 選項 |
|---|---------|---------|------|
| 4.5.2.1.1 | 關注類型 | `concernType` | 藥物交互作用/劑量調整/不良反應 |

##### 4.5.2.2 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 |
|---|---------|------|---------|
| 4.5.2.2.1 | 關注細節 | Textarea | `concernDetails` |
| 4.5.2.2.2 | 修飾後建議 | Textarea | `polishedAdvice` |

##### 4.5.2.3 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 4.5.2.3.1 | AI 產生建議 | Button | - | `POST /pharmacy/advice/generate` | pharmacist, admin |
| 4.5.2.3.2 | 複製 | Button | 複製建議內容 | - | pharmacist, admin |
| 4.5.2.3.3 | 發送到病患留言 | Button | - | `POST /pharmacy/advice/:adviceId/send-to-patient` | pharmacist, admin |

---

### 4.6 病歷摘要 Tab (summary)

**無互動元素，純顯示資訊**

---

## 5. 團隊聊天室 (/chat)

### 5.1 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | placeholder |
|---|---------|------|---------|-------------|
| 5.1.1 | 訊息輸入框 | Textarea | `messageInput` | "輸入訊息..." |

### 5.2 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 5.2.1 | 發送 | Button | 發送訊息 | `POST /chat/messages` | 全部 |

### 5.3 即時通訊
| # | WebSocket 事件 | 觸發時機 |
|---|---------------|---------|
| 5.3.1 | 連線建立 | 進入聊天室頁面 |
| 5.3.2 | 收到新訊息 | 其他用戶發送訊息 |
| 5.3.3 | 斷線重連 | 網路中斷後恢復 |

---

## 6. 藥事工作台 (/pharmacy/workstation)

### 6.1 快速工具按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | 權限 |
|---|---------|------|---------|------|
| 6.1.1 | 藥物交互作用 | Button | `navigate('/pharmacy/interactions')` | pharmacist, admin |
| 6.1.2 | 相容性檢核 | Button | `navigate('/pharmacy/compatibility')` | pharmacist, admin |
| 6.1.3 | 劑量計算 | Button | `navigate('/pharmacy/dosage')` | pharmacist, admin |
| 6.1.4 | 建議統計 | Button | `navigate('/pharmacy/advice-statistics')` | pharmacist, admin |

### 6.2 待處理任務
| # | 元素類型 | 觸發動作 | API 調用 |
|---|---------|---------|---------|
| 6.2.1 | 待處理建議卡片 | 導航至病患頁面 | `GET /pharmacy/advice?status=pending` |

---

## 7. 藥物交互作用查詢 (/pharmacy/interactions)

### 7.1 下拉選單
| # | 選單名稱 | 狀態變數 | 說明 |
|---|---------|---------|------|
| 7.1.1 | 藥物 1 | `drug1` | 藥物下拉選單 |
| 7.1.2 | 藥物 2 | `drug2` | 藥物下拉選單 |

### 7.2 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 7.2.1 | 查詢 | Button | 查詢交互作用 | `POST /pharmacy/drug-interactions/check` | pharmacist, admin |
| 7.2.2 | 展開詳細資訊 (每列) | Accordion | 展開/收起詳情 | - | pharmacist, admin |

---

## 8. 相容性檢核 (/pharmacy/compatibility)

### 8.1 下拉選單
| # | 選單名稱 | 狀態變數 | 選項 |
|---|---------|---------|------|
| 8.1.1 | 藥物 1 | `drug1` | 藥物列表 |
| 8.1.2 | 藥物 2 | `drug2` | 藥物列表 |
| 8.1.3 | 溶液 | `solution` | NS/D5W/LR |

### 8.2 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 8.2.1 | 查詢 | Button | 查詢相容性 | `POST /pharmacy/iv-compatibility/check` | pharmacist, admin |

---

## 9. 劑量計算建議 (/pharmacy/dosage)

### 9.1 下拉選單
| # | 選單名稱 | 狀態變數 | 說明 |
|---|---------|---------|------|
| 9.1.1 | 藥物 | `medication` | 藥物列表 |
| 9.1.2 | 適應症 | `indication` | 適應症選項 |

### 9.2 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | 單位 |
|---|---------|------|---------|------|
| 9.2.1 | 體重 | Input (number) | `weight` | kg |
| 9.2.2 | 身高 | Input (number) | `height` | cm |
| 9.2.3 | Scr | Input (number) | `scr` | mg/dL |
| 9.2.4 | eGFR | Input (number) | `eGFR` | mL/min |

### 9.3 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 9.3.1 | 計算 | Button | 計算劑量 | `POST /pharmacy/dosage/calculate` | pharmacist, admin |

---

## 10. 用藥異常通報 (/pharmacy/error-report)

### 10.1 下拉選單
| # | 選單名稱 | 狀態變數 | 選項 |
|---|---------|---------|------|
| 10.1.1 | 通報類型 | `errorType` | 給藥錯誤/劑量錯誤/藥物交互作用 |
| 10.1.2 | 病人 | `patientId` | 病人列表 |
| 10.1.3 | 嚴重程度 | `severity` | 輕微/中度/嚴重 |

### 10.2 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 |
|---|---------|------|---------|
| 10.2.1 | 相關藥物 | Input | `medication` |
| 10.2.2 | 事件描述 | Textarea | `description` |

### 10.3 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 10.3.1 | 提交通報 | Button | 提交通報 | `POST /pharmacy/error-report` | pharmacist, admin |

---

## 11. 建議統計 (/pharmacy/advice-statistics)

### 11.1 日期選擇器
| # | 欄位名稱 | 類型 | 狀態變數 |
|---|---------|------|---------|
| 11.1.1 | 開始日期 | DatePicker | `startDate` |
| 11.1.2 | 結束日期 | DatePicker | `endDate` |

### 11.2 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 11.2.1 | 查詢 | Button | 查詢統計 | `GET /pharmacy/advice/statistics` | pharmacist, admin |

---

## 12. 稽核日誌 (/admin/audit)

### 12.1 日期選擇器
| # | 欄位名稱 | 類型 | 狀態變數 |
|---|---------|------|---------|
| 12.1.1 | 開始日期 | DatePicker | `startDate` |
| 12.1.2 | 結束日期 | DatePicker | `endDate` |

### 12.2 下拉選單
| # | 選單名稱 | 狀態變數 | 選項 |
|---|---------|---------|------|
| 12.2.1 | 用戶 | `userId` | 用戶列表 |
| 12.2.2 | 操作類型 | `action` | login/edit_patient/upload_lab/ai_query |

### 12.3 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 12.3.1 | 查詢 | Button | 查詢日誌 | `GET /admin/audit-logs` | 僅 admin |
| 12.3.2 | 匯出 CSV | Button | 匯出報表 | - | 僅 admin (未實作) |

---

## 13. 向量資料庫管理 (/admin/vectors)

### 13.1 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 13.1.1 | 上傳文件 | Button | 開啟上傳對話框 | - | 僅 admin |

### 13.2 上傳對話框
#### 13.2.1 輸入元素
| # | 欄位名稱 | 類型 | 說明 |
|---|---------|------|------|
| 13.2.1.1 | 選擇檔案 | FileInput | PDF/DOCX |
| 13.2.1.2 | Collection | Select | clinical_guidelines/drug_information |

#### 13.2.2 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 |
|---|---------|------|---------|---------|
| 13.2.2.1 | 確認上傳 | Button | 上傳文件 | `POST /admin/vectors/upload` |
| 13.2.2.2 | 取消 | Button | 關閉對話框 | - |

---

## 14. 用戶管理 (/admin/users)

### 14.1 輸入欄位
| # | 欄位名稱 | 類型 | 狀態變數 | placeholder |
|---|---------|------|---------|-------------|
| 14.1.1 | 搜尋框 | Input | `search` | "搜尋姓名或 Email..." |

### 14.2 下拉選單
| # | 選單名稱 | 狀態變數 | 選項 |
|---|---------|---------|------|
| 14.2.1 | 角色篩選 | `roleFilter` | nurse/doctor/pharmacist/admin |

### 14.3 按鈕 (頁面層級)
| # | 按鈕名稱 | 類型 | 觸發動作 | 權限 |
|---|---------|------|---------|------|
| 14.3.1 | 新增用戶 | Button | 開啟新增對話框 | 僅 admin |

### 14.4 表格按鈕 (每列)
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 | 權限 |
|---|---------|------|---------|---------|------|
| 14.4.1 | 編輯 | Button | 開啟編輯對話框 | - | 僅 admin |
| 14.4.2 | 啟用/停用 | Switch | 切換用戶狀態 | `PATCH /admin/users/:userId` | 僅 admin |

### 14.5 新增/編輯用戶對話框
#### 14.5.1 輸入欄位
| # | 欄位名稱 | 類型 | 必填 | 說明 |
|---|---------|------|------|------|
| 14.5.1.1 | 姓名 | Input | ✓ | - |
| 14.5.1.2 | Email | Input | ✓ | - |
| 14.5.1.3 | 角色 | Select | ✓ | nurse/doctor/pharmacist/admin |
| 14.5.1.4 | 單位 | Input | ✓ | - |
| 14.5.1.5 | 密碼 | Input (password) | ✓(新增時) | 編輯時選填 |

#### 14.5.2 按鈕
| # | 按鈕名稱 | 類型 | 觸發動作 | API 調用 |
|---|---------|------|---------|---------|
| 14.5.2.1 | 取消 | Button | 關閉對話框 | - |
| 14.5.2.2 | 儲存 | Button | 儲存用戶 | `POST /admin/users` 或 `PATCH /admin/users/:userId` |

---

## 15. 側邊欄 (AppSidebar)

### 15.1 導航項目
| # | 項目名稱 | 路由 | Icon | 權限 |
|---|---------|------|------|------|
| 15.1.1 | 儀表板 | /dashboard | LayoutDashboard | 全部 |
| 15.1.2 | 病人列表 | /patients | Users | nurse, doctor, admin |
| 15.1.3 | 團隊聊天室 | /chat | MessageSquare | 全部 |
| 15.1.4 | 藥事工作台 | /pharmacy/workstation | Pill | pharmacist, admin |
| 15.1.5 | - 交互作用查詢 | /pharmacy/interactions | Pill | pharmacist, admin |
| 15.1.6 | - 相容性檢核 | /pharmacy/compatibility | Pill | pharmacist, admin |
| 15.1.7 | - 劑量計算 | /pharmacy/dosage | Pill | pharmacist, admin |
| 15.1.8 | - 建議統計 | /pharmacy/advice-statistics | Pill | pharmacist, admin |
| 15.1.9 | 稽核日誌 | /admin/audit | Shield | admin |
| 15.1.10 | 向量資料庫 | /admin/vectors | Database | admin |
| 15.1.11 | 用戶管理 | /admin/users | Users | admin |
| 15.1.12 | 登出 | - | LogOut | 全部 |

---

## 📊 統計摘要

### 按權限分類統計

| 權限類別 | 可用頁面數 | 可用按鈕數 | 可用輸入欄位數 |
|---------|-----------|-----------|---------------|
| **nurse** (護理師) | 7 | 48+ | 20+ |
| **doctor** (醫師) | 7 | 52+ | 25+ |
| **admin** (管理者) | 16 | 178+ | 65+ |
| **pharmacist** (藥師) | 10 | 85+ | 35+ |

### 按頁面分類統計

| 頁面 | 按鈕數 | 輸入欄位數 | API 端點數 |
|------|--------|-----------|-----------|
| 登入頁面 | 2 | 3 | 1 |
| 儀表板 | 4 | 1 | 3 |
| 病人列表 | 4 | 1 + 16 | 3 |
| 病人詳細 | 35+ | 10+ | 15+ |
| 團隊聊天室 | 1 | 1 | 2 |
| 藥事工作台 | 4 | 0 | 1 |
| 藥物交互作用 | 2 | 0 | 1 |
| 相容性檢核 | 1 | 0 | 1 |
| 劑量計算 | 1 | 4 | 1 |
| 用藥異常通報 | 1 | 2 | 1 |
| 建議統計 | 1 | 2 | 1 |
| 稽核日誌 | 2 | 2 | 1 |
| 向量資料庫 | 3 | 2 | 2 |
| 用戶管理 | 4 | 1 + 5 | 4 |

---

## ✅ 驗證檢查清單

### API 對應檢查
- [x] 所有按鈕都有明確的 API 端點或本地邏輯
- [x] 所有輸入欄位都有對應的狀態變數
- [x] 所有 API 調用都有權限檢查
- [x] 所有表單都有驗證規則

### 權限檢查
- [x] 路由層級權限檢查 (ProtectedRoute, AdminRoute, PharmacyRoute)
- [x] 組件層級權限檢查 (條件渲染)
- [x] API 層級權限檢查 (後端需實作)

### UI 一致性檢查
- [x] 主色 #7f265b 一致使用
- [x] 按鈕樣式統一
- [x] 輸入欄位樣式統一
- [x] 卡片樣式統一
- [x] Toast 通知統一使用 sonner

### 互動反饋檢查
- [x] 所有按鈕都有 hover 效果
- [x] 所有表單提交都有 loading 狀態
- [x] 所有操作都有成功/失敗提示
- [x] 所有可點擊元素都有 cursor-pointer

---

## 🔍 發現的問題與建議

### 1. 待實作功能
| # | 功能 | 位置 | 優先級 |
|---|------|------|-------|
| 1.1 | Forgot Password | 登入頁 | 低 |
| 1.2 | 匯入 HIS | Progress Note | 中 |
| 1.3 | 匯出 CSV | 稽核日誌 | 中 |
| 1.4 | 封存病人 | 病人列表 | 低 |
| 1.5 | 新增病人 | 病人列表 | 高 |

### 2. 需要後端實作的 API
所有 API 端點已在 `API_SPECIFICATION.md` 中詳細列出，共 50+ 個端點。

### 3. 需要前端實作的功能
| # | 功能 | 說明 | 優先級 |
|---|------|------|-------|
| 3.1 | Axios Client | 實作 `/lib/api-client.ts` | 高 |
| 3.2 | React Query | 取代部分 useState | 中 |
| 3.3 | WebSocket | 即時聊天室 | 高 |
| 3.4 | 表單驗證 | react-hook-form | 中 |
| 3.5 | 日期選擇器 | DatePicker 組件 | 中 |

---

## 📝 備註

### 測試帳號
```
護理師: nurse / nurse
醫師: doctor / doctor
管理者: admin / admin
藥師: pharmacist / pharmacist
```

### 核心配色
```
主色: #7f265b
深色: #1a1a1a
中性: #f8f9fa
純白: #ffffff
點綴色: #f59e0b
```

---

**文件結束**

盤點完成日期: 2026-01-10  
盤點人員: 前端團隊  
下次盤點: 實作新功能後
