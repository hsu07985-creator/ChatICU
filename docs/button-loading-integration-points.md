# Button Loading 掛載盤點

依據 [button-loading-feedback-fixes.md](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/button-loading-feedback-fixes.md:1) 與 [button-loading-implementation-plan.md](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/docs/button-loading-implementation-plan.md:1)，本文件整理共用 `ButtonLoadingIndicator` 在現有元件結構中的最少侵入掛載方式。

---

## 一、結論

最少侵入的掛載策略如下：

### 1. 文字按鈕

直接把 `ButtonLoadingIndicator` 當作 `Button` 的 child 插在文字後方。

原因：

- 既有 `Button` 已經使用 `inline-flex`
- 已有 `gap-2`
- 不需修改共用 `Button` API

建議形式：

```tsx
<Button disabled={loading} onClick={handleAction}>
  <Save className="h-4 w-4" />
  <span>{loading ? '處理中' : '儲存變更'}</span>
  {loading ? <ButtonLoadingIndicator /> : null}
</Button>
```

### 2. icon-only 按鈕

不要直接把 indicator 塞進 icon 按鈕內部。  
改為用外層 wrapper 掛載。

原因：

- `size="icon"` 空間太小
- 原 icon 保留比較穩
- 可避免改壞現有 icon button 尺寸規則

建議形式：

```tsx
<span className="inline-flex items-center gap-1">
  <Button size="sm" variant="ghost" disabled={loading} onClick={handleAction}>
    <Trash2 className="h-4 w-4" />
  </Button>
  {loading ? <ButtonLoadingIndicator compact /> : null}
</span>
```

### 3. 原生 `<button>` 場景

先不優先全面改造。  
若屬於 19 個修復目標範圍，再個別補上 wrapper。

---

## 二、共用 Button 現況

共用按鈕定義位於：

- [src/components/ui/button.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/ui/button.tsx:1)

關鍵點：

- `inline-flex items-center justify-center gap-2`
- `size="icon"` 為固定方形

因此：

- 一般文字按鈕適合直接插入 indicator
- icon-only 按鈕不適合直接在同一顆按鈕內容中放 4 圖 indicator

---

## 三、可直接掛載 `inline` indicator 的場景

這些按鈕目前結構最適合直接插入 indicator。

### 1. 病人編輯對話框

- 檔案：
  - [src/components/patient/dialogs/patient-edit-dialog.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/dialogs/patient-edit-dialog.tsx:150)
- 按鈕：
  - `儲存變更`

### 2. 病歷記錄頁

- 檔案：
  - [src/components/medical-records.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/medical-records.tsx:233)
- 按鈕：
  - `儲存記錄`
  - `儲存模板`
  - `儲存為模板更新`

### 3. 留言板主送出按鈕

- 檔案：
  - [src/components/patient/patient-messages-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-messages-tab.tsx:493)
- 按鈕：
  - `發送留言`
  - `發送回覆`

### 4. AI 對話列表主按鈕

- 檔案：
  - [src/components/patient/patient-chat-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-chat-tab.tsx:145)
- 按鈕：
  - `新對話`

### 5. 管理員對話框主按鈕

- 檔案：
  - [src/pages/admin/users.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/admin/users.tsx:487)
  - [src/pages/admin/users.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/admin/users.tsx:557)
- 按鈕：
  - `建立帳號`
  - `儲存變更`

### 6. 既有 dialog footer 主按鈕

- 檔案：
  - [src/pages/patients.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patients.tsx:693)
  - [src/pages/patients.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patients.tsx:743)
- 按鈕：
  - `建立病患`
  - `確認封存`

---

## 四、應使用 `compact wrapper` 的場景

這些地方多為 icon-only 或 row action，不建議直接把 indicator 塞進按鈕內部。

### 1. 病人列表出院按鈕

- 檔案：
  - [src/pages/patients.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/patients.tsx:478)
- 類型：
  - row action
  - icon-only

### 2. 病歷模板刪除按鈕

- 檔案：
  - [src/components/medical-records.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/medical-records.tsx:406)
  - [src/components/medical-records.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/medical-records.tsx:446)
- 類型：
  - small icon action

### 3. 留言板內已讀 / 接受建議 / 不接受 / 刪除

- 檔案：
  - [src/components/patient/patient-messages-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-messages-tab.tsx:719)
  - [src/components/patient/patient-messages-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-messages-tab.tsx:730)
  - [src/components/patient/patient-messages-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-messages-tab.tsx:739)
  - [src/components/patient/patient-messages-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-messages-tab.tsx:751)
- 類型：
  - row action
  - 多按鈕並列

### 4. 留言板釘選 / 刪除

- 檔案：
  - [src/pages/chat.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/chat.tsx:421)
- 類型：
  - hover action
  - icon-only

### 5. 對話列表刪除

- 檔案：
  - [src/components/patient/patient-chat-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-chat-tab.tsx:196)
- 類型：
  - hover action
  - 原生 `<button>`

### 6. 管理員列表鎖定 / 刪除

- 檔案：
  - [src/pages/admin/users.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/admin/users.tsx:340)
- 類型：
  - row action
  - icon-only

---

## 五、暫時不優先處理的原生 `<button>` 區塊

這些區塊雖然也有按鈕，但不在目前 19 項主目標的第一輪範圍內。

### 1. 標籤相關 popover 操作

- 檔案：
  - [src/components/patient/patient-messages-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-messages-tab.tsx:89)
  - [src/components/patient/patient-messages-tab.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/components/patient/patient-messages-tab.tsx:219)

### 2. 側欄 tabs / 次要切換按鈕

- 檔案：
  - [src/pages/chat.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/chat.tsx:361)
  - [src/pages/chat.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/pages/chat.tsx:375)

這些可待主要流程完成後再看是否需要收斂到同一規格。

---

## 六、建議開發順序對應

依掛載成本與風險，建議：

1. 先做 `inline` 類
2. 再做 `compact wrapper` 類
3. 最後才處理原生 `<button>` 特例

### 第一批

- `patient-edit-dialog.tsx`
- `medical-records.tsx`
- `patient-messages-tab.tsx` 主送出
- `patient-chat-tab.tsx` 新對話

### 第二批

- `patients.tsx` 出院
- `medical-records.tsx` 刪除模板
- `patient-messages-tab.tsx` row actions
- `admin/users.tsx` row actions

### 第三批

- `chat.tsx` hover actions
- `patient-chat-tab.tsx` session delete

---

## 七、總結

最少侵入的原則很明確：

- 文字按鈕：把 indicator 直接當 child 插入
- icon-only 按鈕：外層包 wrapper 再掛 `compact` indicator
- 不優先修改共用 `Button` 的底層 API

這樣可以在不重構整套按鈕系統的前提下，完成大部分 loading 規格落地。
