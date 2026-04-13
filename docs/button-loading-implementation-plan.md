# 按鈕 Loading 實作拆解清單

依據 [button-loading-feedback-fixes.md](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/button-loading-feedback-fixes.md:1) 的最終規格，以下為建議開發順序。

目標不是一次平鋪 19 個項目，而是先完成共用基礎，再分批套用到高風險場景。

---

## 一、開發策略

採用三階段：

1. 先做共用基礎
2. 再做 P0 關鍵流程
3. 最後補 P1 / P2 / 已有部分實作的頁面

這樣可以避免：

- 每個頁面各自寫一套動畫
- icon-only 按鈕處理方式不一致
- 後期回頭重構共用元件

---

## 二、Phase 0：共用基礎先完成

這一階段不直接追 19 個場景，而是先把所有後續修改會依賴的東西建立好。

### 0-1：整理圖資來源

確認 4 張圖的實際來源與檔案位置：

- `chatICU logo`
- `醫師`
- `藥師`
- `護理師`

要決定：

- 圖檔放在 `src/assets/` 還是既有靜態資源位置
- 是否需要統一裁切為方形
- 是否需要透明背景版本

完成條件：

- 4 張圖都可在前端元件中穩定引用

---

### 0-2：建立共用 `ButtonLoadingIndicator`

建議放在：

- `src/components/ui/button-loading-indicator.tsx`

負責：

- 顯示 4 張圖
- 水平排列
- `14x14`
- `4px` 間距
- `800ms` 輪播
- inactive `opacity: 0.3`
- active `opacity: 1`

完成條件：

- 可以單獨 render
- 不依賴特定頁面邏輯
- 可嵌入一般按鈕與 icon-only 按鈕

---

### 0-3：定義按鈕整合方式

先決定兩種固定用法：

- 文字按鈕
- icon-only 按鈕

建議統一模式：

- 文字按鈕：`文字 + 右側 indicator`
- icon-only 按鈕：`原 icon 保留 + 右側縮小 indicator`

完成條件：

- 文件與實作採同一模式
- 不再出現新的 `Loader2` 臨時寫法

---

### 0-4：驗證最小可行樣式

先挑一個假按鈕測試：

- 一般主按鈕
- 一個 icon-only 按鈕

檢查：

- 寬度是否跳動過大
- indicator 是否擠壓文字
- icon-only 版本是否太擠

完成條件：

- 確認這套視覺能安全複用

---

## 三、Phase 1：先做 P0 關鍵流程

P0 是最先該落地的，因為最容易造成重複提交與使用者不確定感。

### 1-1：P0-1 儲存變更（病人編輯）

- 檔案：
  - `src/components/patient/dialogs/patient-edit-dialog.tsx`
  - `src/pages/patients.tsx`
- 重點：
  - parent 管 `isSaving`
  - dialog button 套共用 indicator

優先原因：

- 主流程
- 文字按鈕，最適合當第一個正式套用案例

---

### 1-2：P0-2 儲存記錄（病歷紀錄）

- 檔案：
  - `src/components/medical-records.tsx`
- 重點：
  - 補 `isSavingRecord`
  - 文案改為 `處理中`
  - 套用 indicator

優先原因：

- 很容易被重複點擊
- 和病歷內容直接相關

---

### 1-3：P0-3 發送留言 / 發送回覆

- 檔案：
  - `src/components/patient/patient-messages-tab.tsx`
- 重點：
  - 補 `sending`
  - 禁止重複送出
  - 套用 indicator

優先原因：

- 使用頻率高
- 重送風險高

---

### 1-4：P0-4 出院（病人列表）

- 檔案：
  - `src/pages/patients.tsx`
- 重點：
  - `dischargingId`
  - icon-only 按鈕的 indicator 版本

優先原因：

- 是第一個 icon-only 正式場景
- 可以驗證列表逐列 loading 模式

---

## 四、Phase 2：做 P1 文字按鈕類

先做文字按鈕，因為結構最穩，改動風險小。

### 2-1：P1-1 儲存模板

- 檔案：`src/components/medical-records.tsx`

### 2-2：P1-3 儲存為模板更新

- 檔案：`src/components/medical-records.tsx`

### 2-3：P1-8 批次刪除對話

- 檔案：`src/pages/patient-detail.tsx`

### 2-4：P1-9 新對話

- 檔案：`src/components/patient/patient-chat-tab.tsx`

這四項放一起做的原因：

- 都屬於文字型主按鈕
- 共用 indicator 方式最一致
- 可順手整理同頁面的 loading 命名

---

## 五、Phase 3：做 P1 icon-only / row-level 類

這一批是最容易碎裂的，因此放在共用模式穩定後再做。

### 3-1：P1-2 刪除模板

- 檔案：`src/components/medical-records.tsx`

### 3-2：P1-4 接受建議 / 不接受

- 檔案：`src/components/patient/patient-messages-tab.tsx`

### 3-3：P1-5 已讀 / 刪除（訊息列表）

- 檔案：`src/components/patient/patient-messages-tab.tsx`

### 3-4：P1-6 釘選 / 取消釘選

- 檔案：`src/pages/chat.tsx`

### 3-5：P1-7 刪除訊息

- 檔案：`src/pages/chat.tsx`

### 3-6：P1-10 刪除對話

- 檔案：`src/components/patient/patient-chat-tab.tsx`

這一批的共同驗證點：

- 指定 row 以外的操作不被鎖住
- icon 與 indicator 不擠壓
- hover 顯示的按鈕在 loading 時不閃爍

---

## 六、Phase 4：做 P2 管理員頁

管理員頁影響面較小，放在後面處理。

### 4-1：P2-1 鎖定 / 解鎖帳號

- 檔案：`src/pages/admin/users.tsx`

### 4-2：P2-2 刪除帳號

- 檔案：`src/pages/admin/users.tsx`

建議兩項一起做，因為：

- 同頁面
- 同類型 row action
- 可以共用 `loading user id` 實作模式

---

## 七、Phase 5：補齊已有部分實作的頁面

這一批不是從零開始，而是把現有不一致的 loading 回饋收斂到新規格。

### 5-1：執行全面評估（藥師工作站）

- 檔案：`src/pages/pharmacy/workstation.tsx`
- 現況：已有 disabled 與文案變化
- 任務：改成統一 `處理中 + indicator`

### 5-2：重新生成（AI 訊息）

- 檔案：
  - `src/components/patient/chat-message-thread.tsx`
  - 或 `src/pages/patient-detail.tsx`
- 現況：只有 opacity 變化
- 任務：補 `disabled + indicator`

### 5-3：👍 / 👎 回饋（AI 訊息）

- 檔案：`src/components/patient/chat-message-thread.tsx`
- 現況：只有選取狀態
- 任務：補 API 期間 disabled，視空間決定是否補 indicator

---

## 八、建議實際開發順序

如果照最小風險來排，建議這樣做：

1. `ButtonLoadingIndicator` 共用元件
2. 假按鈕驗證樣式
3. P0-1 儲存變更
4. P0-2 儲存記錄
5. P0-3 發送留言 / 回覆
6. P0-4 出院
7. P1-1 儲存模板
8. P1-3 更新模板
9. P1-8 批次刪除對話
10. P1-9 新對話
11. P1-2 刪除模板
12. P1-4 接受建議 / 不接受
13. P1-5 已讀 / 刪除訊息
14. P1-6 釘選 / 取消釘選
15. P1-7 刪除訊息
16. P1-10 刪除對話
17. P2-1 鎖定 / 解鎖帳號
18. P2-2 刪除帳號
19. 補齊三個已有部分實作頁面

---

## 九、分檔施工建議

如果不想一次做完 19 項，建議拆成 4 個 PR 或 4 次提交：

### 批次 A：基礎元件 + P0

- 共用 indicator
- P0-1
- P0-2
- P0-3
- P0-4

### 批次 B：medical-records / patient chat 文字按鈕

- P1-1
- P1-3
- P1-8
- P1-9

### 批次 C：icon-only 與 row actions

- P1-2
- P1-4
- P1-5
- P1-6
- P1-7
- P1-10

### 批次 D：admin + 補齊既有半成品

- P2-1
- P2-2
- 5-1
- 5-2
- 5-3

---

## 十、每批完成後的驗證重點

### 共通

- loading 時不可重複點擊
- 文案是否統一為 `處理中`
- indicator 是否固定在右側
- 四張圖是否為 `14x14`
- inactive 是否偏淡
- 輪播節奏是否穩定

### 文字按鈕

- 按鈕寬度是否跳動過大
- 文字與 indicator 是否擠在一起

### icon-only 按鈕

- indicator 是否過於擁擠
- row hover 狀態是否因 loading 失真

### 列表場景

- 是否只鎖定該列
- 其他列是否仍能正常操作

---

## 十一、總結

這 19 個項目不應平均散改，而應先完成共用元件，再由：

- `文字主按鈕`
- `icon-only 按鈕`
- `row-level 列表操作`

三種型別逐步套用。

最重要的是先把共用 `ButtonLoadingIndicator` 穩定下來，否則後面每個頁面都會各自長出不同版本。
