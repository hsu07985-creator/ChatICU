# 按鈕 Loading 視覺回饋最終規格草案

盤點日期：2026-04-13  
更新日期：2026-04-13  
目標：所有觸發非同步操作（API call）的按鈕，在執行期間必須顯示一致的 loading 狀態，防止重複觸發，並以統一的右側角色指示器提供視覺回饋。

---

## 一、最終設計方向

本次不採用傳統 `Loader2 spinner` 作為主要 loading 視覺。

改用以下共用模式：

- 按鈕進入 loading 時，一律 `disabled`
- 按鈕文案統一顯示為 `處理中`
- 按鈕右側顯示共用 `indicator`
- `indicator` 由 4 張小圖並排組成
- 4 張圖固定為：
  - `chatICU logo`
  - `醫師`
  - `藥師`
  - `護理師`
- 動畫形式為：
  - 四張圖水平排列
  - 同一時間只亮一張
  - 其他三張維持偏淡
  - 依固定節奏輪替高亮

此規格適用於：

- 一般文字按鈕
- 表格列內操作按鈕
- icon-only 按鈕

---

## 二、共用元件規格

建議新增共用元件概念：

- 元件名稱暫定：`ButtonLoadingIndicator`

用途：

- 僅在按鈕處於 loading 時顯示
- 固定掛在按鈕內容右側
- 所有 async button 共用同一套視覺

建議責任：

- 接收 `active` 或 `loading` 狀態
- 內部自行輪播高亮 index
- 顯示 4 張共用圖
- 不負責 API 邏輯，只負責視覺呈現

建議使用方式：

```tsx
<Button disabled={loading} onClick={handleAction}>
  <span>{loading ? '處理中' : '原本按鈕文字'}</span>
  {loading ? <ButtonLoadingIndicator /> : null}
</Button>
```

---

## 三、視覺規格

### 1. Indicator 內容

- 固定 4 張圖並排
- 圖片順序固定：
  1. `chatICU logo`
  2. `醫師`
  3. `藥師`
  4. `護理師`

### 2. 尺寸與間距

- 每張圖尺寸：`14x14`
- 圖與圖之間間距：`4px`
- 文字與 indicator 間距：`8px`

### 3. 明暗狀態

- active 圖：`opacity: 1`
- inactive 圖：偏淡，建議 `opacity: 0.3`

### 4. 動畫節奏

- 輪播間隔：建議 `800ms`
- 由左到右循環切換高亮

### 5. 版面原則

- indicator 固定顯示在按鈕右側
- loading 時按鈕寬度避免劇烈跳動
- 不應因 indicator 造成按鈕高度改變
- 若按鈕空間太小，仍需保留最基本的文字與 indicator 可辨識性

---

## 四、icon-only 按鈕處理原則

icon-only 按鈕不再採用「用 spinner 直接取代 icon」的做法。

改為：

- 原本 icon 保留
- 按鈕進入 loading 時 `disabled`
- 在按鈕右側顯示縮小版 `indicator`
- 若所在區塊空間極小，可改為在該列操作區右側顯示 indicator

原則：

- 不把 `LogOut`、`Trash`、`Pin`、`Lock` 等 icon 直接換成 spinner
- 重點是維持原操作語意，同時補上 loading 感知

---

## 五、狀態管理原則

### 1. 單一按鈕 loading

適用於頁面上只有一顆主要操作按鈕：

```tsx
const [loading, setLoading] = useState(false);
```

### 2. 列表逐列 loading

適用於清單中每一行有獨立按鈕：

```tsx
const [loadingId, setLoadingId] = useState<string | null>(null);
```

### 3. 不鎖整頁

列表型操作應只鎖該列，不應讓整頁不可操作。

---

## 六、P0 — 最高優先，最常用

### P0-1：儲存變更（病人編輯）

- **檔案**：`src/components/patient/dialogs/patient-edit-dialog.tsx`
- **問題**：`onSave` 是從 parent（`patients.tsx`）傳入的非同步函數，但 dialog 本身對 button 完全沒有 disabled / loading 視覺
- **現況**：
  ```tsx
  <Button onClick={onSave} className="bg-brand hover:bg-brand-hover">
    <Save className="mr-2 h-4 w-4" />
    儲存變更
  </Button>
  ```
- **修法**：
  1. `patient-edit-dialog.tsx` 新增 `isSaving?: boolean` prop
  2. button 加上 `disabled={isSaving}`
  3. 文字改為 `{isSaving ? '處理中' : '儲存變更'}`
  4. loading 時於按鈕右側顯示 `ButtonLoadingIndicator`
  5. `patients.tsx` `handleSave()` 管理 `isSaving` 狀態並傳入 dialog

---

### P0-2：儲存記錄（病歷紀錄）

- **檔案**：`src/components/medical-records.tsx`
- **問題**：`handleSaveRecord()` 會觸發 API，但沒有任何 loading 控制，可重複送出
- **現況**：
  ```tsx
  <Button size="sm" onClick={handleSaveRecord}>
    <FileText className="mr-2 h-4 w-4" />
    儲存記錄
  </Button>
  ```
- **修法**：
  1. 新增 `const [isSavingRecord, setIsSavingRecord] = useState(false)`
  2. `handleSaveRecord` 包 `try/finally`
  3. button 加 `disabled={isSavingRecord}`
  4. 文字改為 `{isSavingRecord ? '處理中' : '儲存記錄'}`
  5. loading 時按鈕右側顯示 `ButtonLoadingIndicator`

---

### P0-3：發送留言 / 發送回覆

- **檔案**：`src/components/patient/patient-messages-tab.tsx`
- **問題**：發送按鈕目前沒有 sending 期間的 disabled，可快速連按送出多則
- **修法**：
  1. component 內增 `const [sending, setSending] = useState(false)`
  2. `handleSend()` 包 `try/finally`
  3. button 加 `disabled={sending || !messageInput.trim() || !patientId}`
  4. 文字改為 `{sending ? '處理中' : '發送'}`
  5. loading 時按鈕右側顯示 `ButtonLoadingIndicator`

---

### P0-4：出院（病人列表）

- **檔案**：`src/pages/patients.tsx`
- **問題**：出院按鈕直接 trigger API call，無任何 loading，可重複點
- **現況**：
  ```tsx
  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleDischargePatient(patient.id); }}>
    <LogOut className="h-4 w-4" />
  </Button>
  ```
- **修法**：
  1. 新增 `const [dischargingId, setDischargingId] = useState<string | null>(null)`
  2. `handleDischargePatient` 設 `dischargingId = patient.id`，`finally` 清除
  3. button 加 `disabled={dischargingId === patient.id}`
  4. icon 保留，不以 spinner 取代
  5. 在該按鈕右側或該列操作區右側顯示縮小版 `ButtonLoadingIndicator`

---

## 七、P1 — 常見操作

### P1-1：儲存模板

- **檔案**：`src/components/medical-records.tsx`
- **問題**：`handleSaveAsTemplate()` 呼叫 API，button 無任何 disabled
- **修法**：
  1. 新增 `const [isSavingTemplate, setIsSavingTemplate] = useState(false)`
  2. `handleSaveAsTemplate` 包 `try/finally`
  3. button 加 `disabled={isSavingTemplate}`
  4. 文字改為 `{isSavingTemplate ? '處理中' : '儲存模板'}`
  5. loading 時按鈕右側顯示 `ButtonLoadingIndicator`

---

### P1-2：刪除模板（Select 旁的 Trash 按鈕）

- **檔案**：`src/components/medical-records.tsx`
- **問題**：`handleDeleteTemplate()` 呼叫 API，Trash button 無 disabled
- **修法**：
  1. 新增 `const [isDeletingTemplate, setIsDeletingTemplate] = useState(false)`
  2. `handleDeleteTemplate` 包 `try/finally`
  3. Trash button 加 `disabled={isDeletingTemplate}`
  4. icon 保留
  5. 在按鈕右側顯示縮小版 `ButtonLoadingIndicator`

---

### P1-3：儲存為模板更新（更新現有模板內容）

- **檔案**：`src/components/medical-records.tsx`
- **問題**：inline `onClick={async () => { await updateRecordTemplate(...) }}` 無 loading state
- **修法**：
  1. 抽成 `handleUpdateTemplate()` 函數
  2. 新增 `const [isUpdatingTemplate, setIsUpdatingTemplate] = useState(false)`
  3. button 加 `disabled={isUpdatingTemplate}`
  4. 文字改為 `{isUpdatingTemplate ? '處理中' : '更新模板'}`
  5. loading 時按鈕右側顯示 `ButtonLoadingIndicator`

---

### P1-4：接受建議 / 不接受（用藥建議訊息）

- **檔案**：`src/components/patient/patient-messages-tab.tsx`
- **問題**：呼叫 `onRespondToAdvice(...)` API，兩個按鈕皆無 loading
- **修法**：
  1. 新增 `const [respondingAdviceId, setRespondingAdviceId] = useState<string | null>(null)`
  2. 以 `adviceRecordId` 識別各訊息的 loading 狀態
  3. 兩個按鈕加 `disabled={respondingAdviceId === message.adviceRecordId}`
  4. loading 時按鈕右側顯示縮小版 `ButtonLoadingIndicator`

---

### P1-5：已讀 / 刪除（訊息列表）

- **檔案**：`src/components/patient/patient-messages-tab.tsx`
- **問題**：「已讀」與「刪除」均呼叫 API，無 loading
- **修法**：
  1. 新增 `const [processingMessageId, setProcessingMessageId] = useState<string | null>(null)`
  2. 統一用 `messageId` 管理哪一則正在處理
  3. 兩個按鈕加 `disabled={processingMessageId === message.id}`
  4. 右側顯示縮小版 `ButtonLoadingIndicator`

---

### P1-6：釘選 / 取消釘選（留言板）

- **檔案**：`src/pages/chat.tsx`
- **問題**：`handleTogglePin(messageId)` 呼叫 API，pin icon 按鈕無 disabled / loading
- **修法**：
  1. 新增 `const [pinningId, setPinningId] = useState<string | null>(null)`
  2. `handleTogglePin` 包 `try/finally`
  3. button 加 `disabled={pinningId === message.id}`
  4. icon 保留
  5. 在按鈕右側或操作列右側顯示縮小版 `ButtonLoadingIndicator`

---

### P1-7：刪除訊息（留言板）

- **檔案**：`src/pages/chat.tsx`
- **問題**：`handleDeleteMessage(messageId)` 呼叫 API，trash icon 按鈕無 loading
- **修法**：
  1. 新增 `const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)`
  2. button 加 `disabled={deletingMessageId === message.id}`
  3. icon 保留
  4. 右側顯示縮小版 `ButtonLoadingIndicator`

---

### P1-8：批次刪除對話（病人 AI Chat 頁）

- **檔案**：`src/pages/patient-detail.tsx`
- **問題**：「刪除 (N)」批次刪除按鈕呼叫 `Promise.all(ids.map(deleteChatSession))`，無 loading state
- **修法**：
  1. 新增 `const [isDeletingSessions, setIsDeletingSessions] = useState(false)`
  2. `handleBatchDelete` 包 `try/finally`
  3. button 加 `disabled={isDeletingSessions}`
  4. 文字改為 `{isDeletingSessions ? '處理中' : '刪除 (N)'}`
  5. loading 時按鈕右側顯示 `ButtonLoadingIndicator`

---

### P1-9：新對話（AI Chat session list）

- **檔案**：`src/components/patient/patient-chat-tab.tsx`
- **問題**：「新對話」呼叫 `onStartNewSession()` 可能為非同步，目前無任何 loading
- **修法**：
  1. 新增 `isStartingSession?: boolean` prop 或在 parent 管理
  2. button 加 `disabled={isStartingSession}`
  3. 文字改為 `{isStartingSession ? '處理中' : '新對話'}`
  4. loading 時按鈕右側顯示 `ButtonLoadingIndicator`

---

### P1-10：刪除對話（session 列表中的 X）

- **檔案**：`src/components/patient/patient-chat-tab.tsx`
- **問題**：列表中每一行的刪除按鈕呼叫 `onDeleteSession()`，無 loading
- **修法**：
  1. 以 session id 識別哪一筆正在刪除
  2. button 加 `disabled={deletingSessionId === session.id}`
  3. icon 保留
  4. 右側顯示縮小版 `ButtonLoadingIndicator`

---

## 八、P2 — 管理員頁面

### P2-1：鎖定 / 解鎖帳號

- **檔案**：`src/pages/admin/users.tsx`
- **問題**：每一列的 lock/unlock icon 呼叫 API，無 disabled
- **修法**：
  1. 新增 `const [togglingUserId, setTogglingUserId] = useState<string | null>(null)`
  2. button 加 `disabled={togglingUserId === user.id}`
  3. icon 保留
  4. 在按鈕右側顯示縮小版 `ButtonLoadingIndicator`

---

### P2-2：刪除帳號

- **檔案**：`src/pages/admin/users.tsx`
- **問題**：每一列的 trash icon 呼叫 API，無 disabled
- **修法**：
  1. 新增 `const [deletingUserId, setDeletingUserId] = useState<string | null>(null)`
  2. button 加 `disabled={deletingUserId === user.id}`
  3. icon 保留
  4. 在按鈕右側顯示縮小版 `ButtonLoadingIndicator`

---

## 九、⚠️ 部分實作（已有回饋但不完整）

### 執行全面評估（藥師工作站）

- **檔案**：`src/pages/pharmacy/workstation.tsx`
- **現況**：按下後文字變「評估中...」，button 也 disabled，但尚未使用統一 indicator
- **修法**：
  1. 保留既有 disabled
  2. 文字改為統一規格 `處理中`
  3. 按鈕右側補上 `ButtonLoadingIndicator`

---

### 重新生成（AI 訊息）

- **檔案**：`src/components/patient/chat-message-thread.tsx` 或 `patient-detail.tsx`
- **現況**：`isSending` 時 icon opacity 改變，但按鈕未 disabled
- **修法**：
  1. 加 `disabled={isSending}`
  2. 右側補上 `ButtonLoadingIndicator`
  3. 若有文案，統一改為 `處理中`

---

### 👍 / 👎 回饋（AI 訊息）

- **檔案**：`src/components/patient/chat-message-thread.tsx`
- **現況**：點下後顏色變化表示已選取，但 API call 期間無 disabled
- **修法**：
  1. API call 期間加短暫 disabled（單一 state `feedbackingIdx`）
  2. 視空間決定是否補縮小版 `ButtonLoadingIndicator`

---

## 十、總覽

| 優先 | 數量 | 說明 |
|------|------|------|
| P0 | 4 個 | 最常用、最容易被使用者困惑 |
| P1 | 10 個 | 常見操作，應儘速修復 |
| P2 | 2 個 | 管理員頁面，影響範圍較小 |
| ⚠️ | 3 個 | 已有部分回饋，需補強 |
| **合計** | **19 個** | |

---

## 十一、實作注意事項

- 本文件目前只定義前端 loading 呈現規格，不涉及 API contract 變更
- 本次不修改角色圖資內容，只規範其使用方式
- 若個別按鈕空間不足，優先保留：
  1. `disabled`
  2. `處理中`
  3. 縮小版右側 indicator
- 所有按鈕不應再使用 `Loader2` 作為主要 loading 視覺

---

## 十二、部署說明

上述皆為前端修改範圍。實作完成後，部署方式為：

```bash
git push railway main
```
