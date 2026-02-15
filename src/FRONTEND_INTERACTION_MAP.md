# ChatICU 前端互動對照表

## 文件說明
本文件詳細列出所有頁面的按鈕、欄位、互動行為，以及對應的 API 調用。

---

## 目錄
1. [登入頁面](#1-登入頁面)
2. [儀表板](#2-儀表板)
3. [病人列表](#3-病人列表)
4. [病人詳細頁面](#4-病人詳細頁面)
5. [團隊聊天室](#5-團隊聊天室)
6. [藥事支援中心](#6-藥事支援中心)
7. [管理功能](#7-管理功能)
8. [共用組件](#8-共用組件)

---

## 1. 登入頁面

**路由**: `/login`  
**檔案**: `/pages/login.tsx`

### 頁面元素

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Input | 帳號 | `username` | - | - |
| Input | 密碼 | `password` | - | type="password" |
| Button | 登入 | - | `POST /auth/login` | 成功後導航至 /dashboard |
| Link | 忘記密碼？ | - | - | 目前無功能 |

### 互動流程
```
1. 用戶輸入帳號密碼
2. 點擊「登入」
3. 調用 POST /auth/login
4. 成功 → 儲存 token → 導航到 /dashboard
5. 失敗 → 顯示錯誤訊息 toast
```

### 測試帳號
```
護理師: nurse / nurse
醫師: doctor / doctor
管理者: admin / admin
藥師: pharmacist / pharmacist
```

---

## 2. 儀表板

**路由**: `/dashboard`  
**檔案**: `/pages/dashboard.tsx`

### 頁面元素

| 區塊 | 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 權限 |
|------|---------|-----------|---------|---------|------|
| **頁首** | Heading | 儀表板 | - | - | 全部 |
| **統計卡片** | Card | 總病人數 | - | `GET /patients?summary=true` | 醫護 |
| | Card | 插管病人 | - | `GET /patients?intubated=true&summary=true` | 醫護 |
| | Card | 今日新增 | - | `GET /patients?admittedToday=true&summary=true` | 醫護 |
| | Card | 待處理訊息 | - | `GET /messages?isRead=false&summary=true` | 全部 |
| **快速導航** | Button | 前往病人列表 | - | 導航至 /patients | 醫護 |
| | Button | 前往聊天室 | - | 導航至 /chat | 全部 |
| | Button | 藥事工作台 | - | 導航至 /pharmacy/workstation | 藥師 |

### 權限差異
- **醫護 (nurse, doctor, admin)**: 顯示病人統計卡片
- **藥師 (pharmacist)**: 顯示藥事統計卡片（待處理建議、今日查詢次數等）

---

## 3. 病人列表

**路由**: `/patients`  
**檔案**: `/pages/patients.tsx`

### 頁面元素

| 區塊 | 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|------|---------|-----------|---------|---------|------|
| **搜尋列** | Input | 搜尋病人 | `searchTerm` | `GET /patients?search={term}` | 即時搜尋 |
| **篩選器** | Select | 插管狀態 | `intubatedFilter` | `GET /patients?intubated={bool}` | - |
| | Select | 嚴重程度 | `criticalFilter` | `GET /patients?critical={bool}` | - |
| **病人卡片** | Card | 病人資訊卡 | - | - | 顯示基本資訊 |
| | Badge | 插管中 | - | - | intubated=true 顯示 |
| | Badge | 未讀訊息 | - | - | unreadMessages > 0 顯示 |
| | Button | 查看詳情 | - | 導航至 `/patient/:id` | - |

### 互動流程
```
1. 頁面載入 → GET /patients
2. 搜尋框輸入 → debounce 500ms → GET /patients?search={term}
3. 篩選器變更 → GET /patients?intubated={bool}&critical={bool}
4. 點擊病人卡片 → 導航至 /patient/:id
```

### 資料更新
- 每 30 秒自動刷新病人列表
- 使用 setInterval 或 React Query 的 refetchInterval

---

## 4. 病人詳細頁面

**路由**: `/patient/:id`  
**檔案**: `/pages/patient-detail.tsx`

### 頁面結構
```
病人詳細頁面
├── 頁首資訊條
├── 分頁 (Tabs)
│   ├── 對話助手
│   ├── 留言板
│   ├── 病歷記錄
│   ├── 檢驗數據
│   ├── 用藥
│   └── 病歷摘要
```

---

### 4.1 頁首資訊條

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 權限 |
|---------|-----------|---------|---------|------|
| Button | 返回 | - | 導航至 /patients | 全部 |
| Heading | 病人姓名 | - | - | 全部 |
| Badge | 插管中 | - | - | intubated=true |
| Text | 住院天數 | - | - | 計算顯示 |
| Button | 編輯基本資料 | - | `PATCH /patients/:id` | 僅 admin |

---

### 4.2 對話助手 (Tab: chat)

**權限**: nurse, doctor, admin

#### 左側：對話記錄列表

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Button | 新對話 | - | - | 清空當前對話 |
| List | 對話記錄 | `chatSessions` | `GET /patients/:id/chat-sessions` | - |
| ListItem | 對話標題 | - | - | 點擊載入對話 |
| Badge | 訊息數量 | - | - | 顯示該對話訊息數 |

#### 右側：對話區

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Button | 更新患者數值 | - | `GET /patients/:id/lab-data/latest` | 刷新病人最新數據 |
| Button | 隱藏/顯示記錄 | `showSessionList` | - | 切換左側列表顯示 |
| Input | 對話標題 | `sessionTitle` | - | 新對話時可填寫 |
| Textarea | 訊息輸入框 | `chatInput` | - | - |
| Button | 發送 | - | `POST /ai/chat` | 發送訊息 |
| Button | 展開/收起參考依據 | `expandedReferences` | - | 切換參考文獻顯示 |
| Button | 複製 (AI訊息) | - | - | 複製到剪貼簿 |

#### 互動流程
```
1. 頁面載入 → GET /patients/:id/chat-sessions (載入歷史對話)
2. 用戶輸入訊息 → 點擊發送 → POST /ai/chat
3. 收到 AI 回應 → 顯示訊息 + 參考依據（預設收起）
4. 自動儲存對話 → 更新 chatSessions 狀態
5. 可點擊歷史對話 → 載入該對話的所有訊息
```

#### 僅醫師/管理者可見：Progress Note 輔助

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 權限 |
|---------|-----------|---------|---------|------|
| Textarea | 輸入草稿 | `progressNoteInput` | - | doctor, admin |
| Button | AI 修飾 & 翻譯 | - | `POST /ai/progress-note/polish` | doctor, admin |
| Text | 修飾後內容 | `polishedNote` | - | doctor, admin |
| Button | 複製 | - | - | doctor, admin |
| Button | 匯入 HIS | - | - | 未實作 |

---

### 4.3 留言板 (Tab: messages)

**權限**: 全部（包含藥師）

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Badge | 未讀數量 | - | - | unreadCount |
| Button | 全部標為已讀 | - | `PATCH /patients/:id/messages/mark-all-read` | - |
| Textarea | 新增留言 | `messageInput` | - | - |
| Button | 發送留言 | - | `POST /patients/:id/messages` | - |
| Button | 標記為用藥建議 | - | - | 設定 messageType |
| MessageCard | 留言卡片 | - | - | - |
| Button | 標為已讀 | - | `PATCH /patients/:id/messages/:messageId/read` | - |

#### 留言類型標記
- **general**: 一般留言（藍色）
- **medication-advice**: 用藥建議（綠色，藥師專用）
- **alert**: 警示訊息（紅色）

#### 互動流程
```
1. 頁面載入 → GET /patients/:id/messages
2. 新增留言 → 填寫內容 → POST /patients/:id/messages
3. 藥師可選擇「標記為用藥建議」 → messageType: "medication-advice"
4. 點擊「標為已讀」 → PATCH /patients/:id/messages/:messageId/read
```

---

### 4.4 病歷記錄 (Tab: records)

**權限**: nurse, doctor, admin  
**組件**: `/components/medical-records.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 權限 |
|---------|-----------|---------|---------|------|
| Select | 記錄類型 | `recordType` | - | - |
| Button | 進展記錄 | - | - | doctor, admin |
| Button | 護理記錄 | - | - | nurse, doctor, admin |
| Button | 會診記錄 | - | - | doctor, admin |
| Textarea | 記錄內容 | `recordContent` | - | - |
| Button | AI 輔助修飾 | - | `POST /ai/nursing-record/polish` | - |
| Button | 儲存記錄 | - | `POST /patients/:id/medical-records` | - |
| List | 歷史記錄 | - | `GET /patients/:id/medical-records` | - |
| Button | 複製 | - | - | - |

#### 互動流程
```
1. 選擇記錄類型 → 護理記錄 / 進展記錄 / 會診記錄
2. 輸入內容 → 點擊「AI 輔助修飾」 → POST /ai/nursing-record/polish
3. 顯示修飾後內容 → 可編輯
4. 點擊「儲存記錄」 → POST /patients/:id/medical-records
5. 記錄儲存成功 → 重新載入歷史記錄列表
```

---

### 4.5 檢驗數據 (Tab: labs)

**權限**: nurse, doctor, admin

#### 生命徵象區

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Card | Respiratory Rate | - | `GET /patients/:id/vital-signs/latest` | 可點擊查看趨勢 |
| Card | Temperature | - | `GET /patients/:id/vital-signs/latest` | 異常時標紅 |
| Card | Blood Pressure | - | `GET /patients/:id/vital-signs/latest` | - |
| Card | Heart Rate | - | `GET /patients/:id/vital-signs/latest` | - |

#### 檢驗數據區

**組件**: `/components/lab-data-display.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Tabs | 檢驗類別 | `activeCategory` | - | 生化/血液/凝血/血氣/發炎 |
| Table | 檢驗數據表格 | - | `GET /patients/:id/lab-data/latest` | - |
| Badge | 異常標記 | - | - | isAbnormal=true 顯示 ↑↓ |
| Button | 校正 | - | 顯示校正對話框 | - |
| Button | 查看趨勢 | - | 打開趨勢圖對話框 | - |

#### 校正對話框

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Input | 新數值 | `newValue` | - | - |
| Textarea | 校正理由 | `correctionReason` | - | 必填 |
| Button | 確認校正 | - | `PATCH /patients/:id/lab-data/:labDataId/correct` | - |
| Button | 取消 | - | - | 關閉對話框 |

#### 趨勢圖對話框

**組件**: `/components/lab-trend-chart.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Chart | 折線圖 | - | `GET /patients/:id/lab-data/trends?labName={name}` | Recharts |
| Text | 當前數值 | - | - | 大字顯示 |
| Text | 變化量 | - | - | 與前次比較 |
| Text | 變化率 | - | - | 百分比 |
| Text | 參考範圍 | - | - | - |
| Button | 關閉 | - | - | 關閉對話框 |

#### 互動流程
```
1. 頁面載入 → GET /patients/:id/lab-data/latest
2. 點擊檢驗項目 → GET /patients/:id/lab-data/trends?labName={name}
3. 顯示趨勢圖對話框（折線圖）
4. 點擊「校正」→ 顯示校正對話框
5. 輸入新數值 + 理由 → PATCH /patients/:id/lab-data/:labDataId/correct
6. 校正成功 → 重新載入檢驗數據
```

---

### 4.6 用藥 (Tab: meds)

**權限**: nurse, doctor, admin (查看)，pharmacist, admin (用藥建議)

#### S/A/N 藥物卡片

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Card | Pain 止痛 | - | `GET /patients/:id/medications?category=analgesic` | - |
| Card | Sedation 鎮靜 | - | `GET /patients/:id/medications?category=sedative` | - |
| Card | Neuromuscular Blockade | - | `GET /patients/:id/medications?category=nmb` | - |
| Badge | S/A/N 標記 | - | - | 藥物分類 |

#### 其他藥物

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Grid | 藥物列表 | - | `GET /patients/:id/medications` | - |
| Card | 藥物卡片 | - | - | 顯示名稱、劑量、頻率 |

#### 操作按鈕

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 權限 |
|---------|-----------|---------|---------|------|
| Button | 交互作用查詢 | - | 導航至藥師頁面 | - |
| Button | 複製到報告 | - | - | - |

#### 藥師用藥建議 Widget

**組件**: `/components/pharmacist-advice-widget.tsx`  
**權限**: pharmacist, admin

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Select | 關注類型 | `concernType` | - | 藥物交互作用/劑量調整/不良反應 |
| Textarea | 關注細節 | `concernDetails` | - | - |
| Button | AI 產生建議 | - | `POST /pharmacy/advice/generate` | - |
| Textarea | 修飾後建議 | `polishedAdvice` | - | 可編輯 |
| Button | 複製 | - | - | - |
| Button | 發送到病患留言 | - | `POST /pharmacy/advice/:adviceId/send-to-patient` | - |

#### 互動流程
```
1. 藥師選擇關注類型 → 輸入細節
2. 點擊「AI 產生建議」 → POST /pharmacy/advice/generate
3. 顯示修飾後建議 → 藥師可編輯
4. 點擊「發送到病患留言」 → POST /pharmacy/advice/:adviceId/send-to-patient
5. 建議出現在該病患的留言板（messageType: "medication-advice"）
```

---

### 4.7 病歷摘要 (Tab: summary)

**權限**: nurse, doctor, admin

| 區塊 | 元素類型 | 名稱/Label | API 調用 | 備註 |
|------|---------|-----------|---------|------|
| **基本資訊** | Card | - | `GET /patients/:id` | 年齡/性別/BMI/身高/體重 |
| **症狀** | Card | - | `GET /patients/:id` | 症狀列表 |
| **入院診斷** | Card | - | `GET /patients/:id` | diagnosis 欄位 |
| **風險與警示** | Card | - | `GET /patients/:id` | alerts 陣列 |

---

## 5. 團隊聊天室

**路由**: `/chat`  
**檔案**: `/pages/chat.tsx`  
**權限**: 全部

### 頁面元素

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| ScrollArea | 訊息列表 | `messages` | `GET /chat/messages` | - |
| MessageBubble | 訊息氣泡 | - | - | 顯示發送者、角色、內容 |
| Textarea | 訊息輸入 | `messageInput` | - | - |
| Button | 發送 | - | `POST /chat/messages` | - |

### 即時更新
- 使用 WebSocket: `wss://api.chaticu.hospital/v1/ws/chat`
- 收到新訊息 → 自動添加到訊息列表
- 發送訊息 → WebSocket 廣播給所有線上用戶

### 互動流程
```
1. 頁面載入 → GET /chat/messages (載入最近 50 條)
2. 建立 WebSocket 連線
3. 用戶輸入訊息 → POST /chat/messages
4. WebSocket 收到新訊息 → 更新畫面
```

---

## 6. 藥事支援中心

**權限**: pharmacist, admin

### 6.1 藥事工作台

**路由**: `/pharmacy/workstation`  
**檔案**: `/pages/pharmacy/workstation.tsx`

#### 待處理任務

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Card | 待處理建議 | - | `GET /pharmacy/advice?status=pending` | - |
| Button | 查看詳情 | - | 導航至病患頁面 | - |

#### 快速工具

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Button | 藥物交互作用 | - | 導航至 `/pharmacy/interactions` | - |
| Button | 相容性檢核 | - | 導航至 `/pharmacy/compatibility` | - |
| Button | 劑量計算 | - | 導航至 `/pharmacy/dosage` | - |
| Button | 建議統計 | - | 導航至 `/pharmacy/advice-statistics` | - |

---

### 6.2 藥物交互作用查詢

**路由**: `/pharmacy/interactions`  
**檔案**: `/pages/pharmacy/interactions.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Select | 藥物 1 | `drug1` | - | 藥物下拉選單 |
| Select | 藥物 2 | `drug2` | - | 藥物下拉選單 |
| Button | 查詢 | - | `POST /pharmacy/drug-interactions/check` | - |
| Table | 交互作用結果 | - | - | 顯示嚴重度/機制/臨床影響/處置 |
| Badge | 嚴重度 | - | - | major=紅色, moderate=黃色, minor=綠色 |
| Accordion | 詳細資訊 | `expandedRow` | - | 點擊展開詳情 |

#### 互動流程
```
1. 選擇藥物 1、藥物 2
2. 點擊「查詢」 → POST /pharmacy/drug-interactions/check
3. 顯示交互作用結果表格
4. 點擊列 → 展開詳細資訊（機制、臨床影響、處置建議、參考文獻）
```

---

### 6.3 相容性檢核

**路由**: `/pharmacy/compatibility`  
**檔案**: `/pages/pharmacy/compatibility.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Select | 藥物 1 | `drug1` | - | - |
| Select | 藥物 2 | `drug2` | - | - |
| Select | 溶液 | `solution` | - | NS/D5W/LR |
| Button | 查詢 | - | `POST /pharmacy/iv-compatibility/check` | - |
| Card | 相容性結果 | - | - | 相容/不相容 |
| Text | 穩定時間 | - | - | timeStability |
| Text | 注意事項 | - | - | notes |
| Text | 參考文獻 | - | - | references |

#### 互動流程
```
1. 選擇藥物 1、藥物 2、溶液
2. 點擊「查詢」 → POST /pharmacy/iv-compatibility/check
3. 顯示相容性結果（相容=綠色，不相容=紅色）
4. 顯示穩定時間、注意事項、參考文獻
```

---

### 6.4 劑量計算建議

**路由**: `/pharmacy/dosage`  
**檔案**: `/pages/pharmacy/dosage.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Select | 藥物 | `medication` | - | - |
| Input | 體重 (kg) | `weight` | - | - |
| Input | 身高 (cm) | `height` | - | - |
| Input | Scr | `scr` | - | - |
| Input | eGFR | `eGFR` | - | - |
| Select | 適應症 | `indication` | - | - |
| Button | 計算 | - | `POST /pharmacy/dosage/calculate` | - |
| Card | 建議劑量 | - | - | loading dose + maintenance dose |
| Alert | 警示 | - | - | 腎功能調整/警告 |

#### 互動流程
```
1. 輸入藥物、病人資料（體重、身高、腎功能）、適應症
2. 點擊「計算」 → POST /pharmacy/dosage/calculate
3. 顯示建議劑量（loading dose、maintenance dose）
4. 顯示調整建議（腎功能不全、警告事項）
```

---

### 6.5 用藥異常通報

**路由**: `/pharmacy/error-report`  
**檔案**: `/pages/pharmacy/error-report.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Select | 通報類型 | `errorType` | - | 給藥錯誤/劑量錯誤/藥物交互作用 |
| Select | 病人 | `patientId` | - | - |
| Input | 相關藥物 | `medication` | - | - |
| Textarea | 事件描述 | `description` | - | - |
| Select | 嚴重程度 | `severity` | - | 輕微/中度/嚴重 |
| Button | 提交通報 | - | `POST /pharmacy/error-report` | - |

---

### 6.6 建議統計

**路由**: `/pharmacy/advice-statistics`  
**檔案**: `/pages/pharmacy/advice-statistics.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| DatePicker | 開始日期 | `startDate` | - | - |
| DatePicker | 結束日期 | `endDate` | - | - |
| Button | 查詢 | - | `GET /pharmacy/advice/statistics` | - |
| Card | 總建議數 | - | - | - |
| Chart | 建議類型分布 | - | - | 圓餅圖 |
| Chart | 每日建議趨勢 | - | - | 折線圖 |
| Table | 藥師排行 | - | - | - |

---

## 7. 管理功能

**權限**: 僅 admin

### 7.1 稽核日誌

**路由**: `/admin/audit`  
**檔案**: `/pages/admin/placeholder.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| DatePicker | 開始日期 | `startDate` | - | - |
| DatePicker | 結束日期 | `endDate` | - | - |
| Select | 用戶 | `userId` | - | 可選特定用戶 |
| Select | 操作類型 | `action` | - | login/edit_patient/upload_lab/ai_query |
| Button | 查詢 | - | `GET /admin/audit-logs` | - |
| Table | 稽核記錄 | - | - | - |
| Button | 匯出 CSV | - | - | 未實作 |

#### 稽核記錄欄位
- 時間
- 用戶姓名
- 角色
- 操作類型
- 目標對象（病人姓名/床號）
- IP 位址
- 詳細資訊

---

### 7.2 向量資料庫管理

**路由**: `/admin/vectors`  
**檔案**: `/pages/admin/vectors.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Card | 資料庫總覽 | - | `GET /admin/vectors` | 文件數量、大小 |
| Table | Collection 列表 | - | - | clinical_guidelines, drug_information |
| Button | 上傳文件 | - | 打開上傳對話框 | - |
| FileInput | 選擇檔案 | `file` | - | PDF/DOCX |
| Select | Collection | `collection` | - | - |
| Button | 確認上傳 | - | `POST /admin/vectors/upload` | - |
| Progress | 上傳進度 | - | - | 顯示處理狀態 |

---

### 7.3 用戶管理

**路由**: `/admin/users`  
**檔案**: `/pages/admin/users.tsx`

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Button | 新增用戶 | - | 打開新增對話框 | - |
| Select | 角色篩選 | `roleFilter` | `GET /admin/users?role={role}` | - |
| Input | 搜尋 | `search` | `GET /admin/users?search={term}` | - |
| Table | 用戶列表 | - | - | - |
| Button | 編輯 (每列) | - | 打開編輯對話框 | - |
| Switch | 啟用/停用 | - | `PATCH /admin/users/:userId` | - |

#### 新增/編輯用戶對話框

| 元素類型 | 名稱/Label | 狀態變數 | API 調用 | 備註 |
|---------|-----------|---------|---------|------|
| Input | 姓名 | `name` | - | - |
| Input | Email | `email` | - | - |
| Select | 角色 | `role` | - | nurse/doctor/pharmacist/admin |
| Input | 單位 | `unit` | - | - |
| Input | 密碼 | `password` | - | 新增時必填 |
| Button | 儲存 | - | `POST /admin/users` 或 `PATCH /admin/users/:userId` | - |

---

## 8. 共用組件

### 8.1 側邊欄 (AppSidebar)

**檔案**: `/components/app-sidebar.tsx`

| 元素類型 | 名稱/Label | 路由 | 權限 | 備註 |
|---------|-----------|------|------|------|
| NavItem | 儀表板 | /dashboard | 全部 | - |
| NavItem | 病人列表 | /patients | 醫護 | nurse, doctor, admin |
| NavItem | 團隊聊天室 | /chat | 全部 | - |
| NavGroup | 藥事支援 | - | 藥師 | pharmacist, admin |
| NavItem | - 藥事工作台 | /pharmacy/workstation | 藥師 | - |
| NavItem | - 交互作用查詢 | /pharmacy/interactions | 藥師 | - |
| NavItem | - 相容性檢核 | /pharmacy/compatibility | 藥師 | - |
| NavItem | - 劑量計算 | /pharmacy/dosage | 藥師 | - |
| NavItem | - 建議統計 | /pharmacy/advice-statistics | 藥師 | - |
| NavGroup | 管理功能 | - | 管理者 | admin |
| NavItem | - 稽核日誌 | /admin/audit | 管理者 | - |
| NavItem | - 向量資料庫 | /admin/vectors | 管理者 | - |
| NavItem | - 用戶管理 | /admin/users | 管理者 | - |
| NavItem | 登出 | - | 全部 | 調用 logout() |

---

### 8.2 生命徵象卡片 (VitalSignCard)

**檔案**: `/components/vital-signs-card.tsx`

| Props | 類型 | 說明 |
|-------|------|------|
| label | string | 生命徵象名稱 |
| value | number | 數值 |
| unit | string | 單位 |
| isAbnormal | boolean | 是否異常 |
| onClick | function | 點擊事件（查看趨勢圖） |

---

### 8.3 檢驗趨勢圖 (LabTrendChart)

**檔案**: `/components/lab-trend-chart.tsx`

| Props | 類型 | 說明 |
|-------|------|------|
| isOpen | boolean | 是否顯示對話框 |
| onClose | function | 關閉對話框 |
| labName | string | 檢驗項目英文名稱 |
| labNameChinese | string | 檢驗項目中文名稱 |
| currentValue | number | 當前數值 |
| unit | string | 單位 |
| trendData | array | 趨勢資料 |
| referenceRange | string | 參考範圍 |

---

## 狀態管理建議

### 全域狀態 (Context)
- `AuthContext`: 用戶資訊、登入狀態
- 未來可加入: `NotificationContext`（即時通知）

### 頁面狀態 (useState)
- 表單輸入值
- UI 狀態（對話框開關、展開收起）
- 篩選器狀態

### 伺服器狀態 (建議使用 React Query)
- 病人列表
- 檢驗數據
- 用藥資料
- 對話記錄
- 留言板

---

## API 調用時機總結

### 頁面載入時
```typescript
// 病人列表頁
useEffect(() => {
  fetchPatients();
}, []);

// 病人詳細頁
useEffect(() => {
  Promise.all([
    fetchPatientDetail(id),
    fetchLabData(id),
    fetchVitalSigns(id),
    fetchMedications(id),
    fetchMessages(id),
    fetchChatSessions(id)
  ]);
}, [id]);
```

### 用戶操作時
```typescript
// 搜尋（debounce）
const debouncedSearch = useMemo(
  () => debounce((term) => fetchPatients({ search: term }), 500),
  []
);

// 發送訊息
const handleSendMessage = async () => {
  await sendMessage(chatInput);
  await fetchChatSessions(patientId);
};
```

### 自動刷新
```typescript
// 病人列表 - 每 30 秒刷新
useEffect(() => {
  const interval = setInterval(() => {
    fetchPatients();
  }, 30000);
  return () => clearInterval(interval);
}, []);
```

---

## 錯誤處理

### Toast 通知
```typescript
// 成功
toast.success('操作成功');

// 錯誤
toast.error('操作失敗，請稍後再試');

// 警告
toast.warning('請填寫必填欄位');

// 資訊
toast.info('資料已自動儲存');
```

### API 錯誤處理
```typescript
try {
  const response = await api.post('/patients/:id/messages', data);
  toast.success('留言發送成功');
} catch (error) {
  if (error.response?.status === 401) {
    // 未授權 → 導航至登入頁
    navigate('/login');
  } else if (error.response?.status === 403) {
    // 權限不足
    toast.error('您沒有權限執行此操作');
  } else {
    // 其他錯誤
    toast.error(error.response?.data?.error?.message || '操作失敗');
  }
}
```

---

## 權限控制實作

### Route 層級
```typescript
// Admin Route
<Route
  path="/admin/users"
  element={
    <AdminRoute>
      <UsersPage />
    </AdminRoute>
  }
/>

// Pharmacy Route
<Route
  path="/pharmacy/workstation"
  element={
    <PharmacyRoute>
      <WorkstationPage />
    </PharmacyRoute>
  }
/>
```

### Component 層級
```typescript
// 僅醫師/管理者可見
{(user?.role === 'doctor' || user?.role === 'admin') && (
  <ProgressNoteWidget />
)}

// 僅藥師/管理者可見
{(user?.role === 'pharmacist' || user?.role === 'admin') && (
  <PharmacistAdviceWidget />
)}
```

---

## 附錄：需要實作的 Axios 設定

```typescript
// /lib/api-client.ts
import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'https://api.chaticu.hospital/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor - 自動帶 token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor - 處理錯誤
apiClient.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    if (error.response?.status === 401) {
      // Token 過期 → 嘗試刷新或登出
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

---

**文件結束**
