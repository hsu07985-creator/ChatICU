# PAD 劑量計算功能需求釐清

日期：2026-05-05

## 背景

左側欄目前有「藥事工具 → 劑量計算」入口，對應頁面為 `/pharmacy/dosage`。此功能用於 ICU PAD 藥物輸注速率計算，支援藥品建議劑量範圍、濃度、肥胖體重調整與計算步驟顯示。

本文件釐清目前限制與後續修改方向，重點問題是：

「劑量計算目前是否只能帶入住院病人資料，不能自行輸入身高體重？若是，是否應該直接嵌入每個病人的頁面？」

## 目前現況

### 1. 入口與角色

- 側欄入口：`src/components/app-sidebar.tsx`
- 頁面路由：`/pharmacy/dosage`
- 頁面元件：`src/pages/pharmacy/dosage.tsx`
- 側欄只對 `pharmacist` / `admin` 顯示「劑量計算」。

### 2. 病人資料來源

- 頁面使用 `getCachedPatients()` 載入病人清單。
- `getCachedPatients()` 呼叫 `getPatients({ limit: 100 })`。
- 後端 `/patients` API 在未指定 `archived` 時，預設只回傳未歸檔病人，也就是目前住院/未轉出病人。

結論：目前 UI 上只會列出正在住院的病人，不會列出已轉出/已歸檔病人。

### 3. 身高體重輸入限制

目前劑量計算頁面中：

- 體重欄位是 `readOnly`
- 身高欄位是 `readOnly`
- 性別由病人資料自動帶入

因此使用者必須先選擇住院病人，才能帶入體重/身高。若病人資料缺少體重，使用者無法在此頁面直接補輸入體重計算。

### 4. 後端能力

後端 PAD 計算 API 其實支援直接傳入：

- `weight_kg`
- `height_cm`
- `sex`
- `drug`
- `target_dose_per_kg_hr`
- `concentration`

因此「不能自行輸入身高體重」是目前前端 UI 設計限制，不是後端 API 的限制。

## 問題定義

### 問題 A：獨立工具頁無法手動試算

目前 `/pharmacy/dosage` 雖然像獨立工具，但實際操作上依賴住院病人資料。這會造成：

- 無法替非住院病人、轉出病人或模擬案例試算。
- 病人缺少體重/身高時無法臨時補值。
- 臨床上若想用最新量測體重，而資料庫尚未更新，無法直接計算。

### 問題 B：病人情境切換成本高

如果使用者已經在某個病人的詳細頁面查看用藥，還需要切到左側「劑量計算」、重新選病人，流程不順。

### 問題 C：權限一致性

側欄只讓 `pharmacist` / `admin` 看到入口，但目前 `/pharmacy/dosage` 路由若直接輸入網址，前端保護層不是藥事專用路由。後端 PAD API 目前也只要求登入，未明確限制角色。

若此功能定位為藥師工具，權限應一致。

## 建議需求

建議將「劑量計算」整理成共用計算元件，支援兩種使用情境。

### 模式 1：獨立工具頁

保留左側欄「劑量計算」頁面。

需求：

- 可選住院病人，自動帶入身高、體重、性別。
- 可不選病人，直接手動輸入身高、體重、性別。
- 選了病人後仍允許手動修正身高、體重、性別，但 UI 需要清楚標示「本次計算使用值」。
- 不將手動修正值自動寫回病人資料，除非另做「更新病人基本資料」功能。

### 模式 2：病人頁嵌入

在每個病人詳細頁面中嵌入同一個劑量計算元件。

需求：

- 預設帶入目前病人的身高、體重、性別。
- 不需要再選病人。
- 可手動修正本次計算用的身高、體重、性別。
- 適合放在病人詳細頁的「用藥」相關區塊或獨立 tab/卡片。

## 建議設計

### 元件拆分

將目前 `src/pages/pharmacy/dosage.tsx` 中的主要計算 UI 抽成共用元件，例如：

- `src/components/pharmacy/pad-dosage-calculator.tsx`

建議 props：

```ts
type PadDosageCalculatorProps = {
  mode: 'standalone' | 'patient';
  patient?: Patient;
  allowPatientSelect?: boolean;
  allowManualAnthropometrics?: boolean;
};
```

### 頁面使用方式

獨立工具頁：

```tsx
<PadDosageCalculator
  mode="standalone"
  allowPatientSelect
  allowManualAnthropometrics
/>
```

病人頁：

```tsx
<PadDosageCalculator
  mode="patient"
  patient={patient}
  allowManualAnthropometrics
/>
```

## UI 行為建議

### 病人選擇區

獨立工具頁顯示：

- 病患（可選）
- 清除病患
- 選病人後自動帶入基本資料

病人頁不顯示病人下拉選單，只顯示目前病人摘要：

- 床號
- 姓名遮罩
- 病歷號

### 身高體重性別區

建議欄位改為可編輯：

- 體重 kg：必填
- 身高 cm：選填，但若有身高與性別即可做 IBW/AdjBW 判斷
- 性別：選填，但肥胖體重調整需要性別與身高

若缺少身高或性別：

- 後端目前會 fallback 使用 TBW
- 前端應顯示提醒：「缺少身高/性別，本次使用實際體重 TBW 計算，無法做 IBW/AdjBW 肥胖調整」

### 計算結果區

保留目前資訊：

- 輸注速率 `ml/hr`
- 計算體重
- 每小時劑量
- 濃度
- BMI / IBW / AdjBW / %IBW
- 肥胖或體重偏低 badge
- 計算步驟

## 是否要嵌入每個病人的頁面

建議：要嵌入，但不要移除左側獨立工具頁。

理由：

- 病人頁嵌入符合臨床流程，查看用藥時可直接計算。
- 獨立工具頁仍適合藥師快速試算、教學、或非特定病人場景。
- 兩個入口共用同一元件與同一後端 API，可避免維護兩套邏輯。

## 修改範圍預估

### 前端

- `src/pages/pharmacy/dosage.tsx`
  - 改為薄頁面，主要渲染共用元件。
- `src/components/pharmacy/pad-dosage-calculator.tsx`
  - 新增共用劑量計算元件。
- `src/pages/patient-detail.tsx` 或相關病人 detail 子元件
  - 嵌入病人頁版本計算器。
- `src/i18n/locales/zh-TW/pharmacy.json`
  - 新增/調整文案。
- `src/i18n/locales/en-US/pharmacy.json`
  - 新增/調整英文文案。
- `src/App.tsx`
  - 若功能定位為藥事工具，將 `/pharmacy/dosage` 改用 `PharmacyRoute`。

### 後端

- `backend/app/routers/pharmacy_routes/pad_calculate.py`
  - 若功能定位為藥師/管理者專用，改用 `require_roles("pharmacist", "admin")`。
  - 若醫師/NP 也需要使用，則需明確定義允許角色。

## 權限決策

需先決定：

1. 僅藥師/管理者可使用
2. 醫師、NP、藥師、管理者都可使用

若嵌入病人頁，建議重新評估角色需求。因為病人頁通常醫師/NP 也會使用；若劑量計算只限藥師，病人頁需要依角色隱藏卡片。

## 驗收條件

### 獨立工具頁

- 不選病人也能手動輸入體重並完成計算。
- 選病人後自動帶入體重、身高、性別。
- 選病人後可手動修正本次計算用數值。
- 手動修正不會自動寫回病人主檔。
- 缺少身高或性別時仍可計算，但顯示 TBW fallback 提醒。

### 病人頁

- 進入病人頁後可直接看到或開啟劑量計算區。
- 預設使用目前病人的體重、身高、性別。
- 可直接選 PAD 藥物並計算輸注速率。
- 不需要再次選擇病人。

### 權限

- 前端入口、前端路由、後端 API 的角色規則一致。
- 未授權角色無法透過直接網址或直接 API 呼叫使用受限功能。

### 品質

- `npm run typecheck` 通過。
- `npm run build` 通過。
- PAD 後端測試通過。
- 若修改後端權限，需補對應 API 權限測試。

## 建議實作順序

1. 先確認權限策略：哪些角色可以使用劑量計算。
2. 抽出共用 `PadDosageCalculator` 元件。
3. 讓獨立工具頁支援手動輸入身高、體重、性別。
4. 嵌入病人詳細頁，預設帶入目前病人資料。
5. 統一前後端權限。
6. 補測試並驗證 production build。
