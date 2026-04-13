# Patient Data Sync Remediation Plan

日期: 2026-04-14

目的:
- 依照已確認的優先順序修復病人資料跨頁不同步問題
- 每一步都要有明確驗證
- 每次修改前先讀這份文件，修改後更新狀態

## 參考文件

- [patient-data-sync-audit.md](./patient-data-sync-audit.md)

## 修復順序

### Step 1: `P0 + P1`

目標:
- 修正 `patient-detail.tsx` 的病人儲存主路徑
- 抽出小型共用同步 helper
- 讓 mutation 後至少能一致刷新:
  - `patients-cache.ts`
  - dashboard stats cache

範圍:
- `src/pages/patient-detail.tsx`
- `src/pages/patients.tsx`
- `src/pages/dashboard.tsx`
- `src/lib/patients-cache.ts`
- 新增 shared helper / shared dashboard stats cache module

狀態:
- [x] 未開始
- [x] 進行中
- [x] 已完成

驗證:
- [x] `npm run build`
- [x] 檢查 `patient-detail.tsx` save path 已不再只做 local state update
- [x] 檢查 `patients.tsx` / `dashboard.tsx` 已改用共用同步 helper 或一致策略

### Step 2: `P2`

目標:
- 修正已開著頁面的同步問題
- 讓依賴 shared patients cache 的已掛載頁面在病人資料更新後也能收到新資料

範圍:
- `src/pages/pharmacy/workstation.tsx`
- `src/pages/pharmacy/dosage.tsx`
- `src/pages/pharmacy/compatibility.tsx`
- `src/pages/pharmacy/interactions.tsx`
- `src/pages/pharmacy/advice-statistics.tsx`
- `src/pages/dashboard.tsx`

狀態:
- [x] 未開始
- [x] 進行中
- [x] 已完成

驗證:
- [x] `npm run build`
- [x] 檢查上述頁面有訂閱或同步 shared patients cache 更新
- [x] 檢查 dosage 在 `selectedPatientId` 已存在時也會跟著更新 `height/weight`

### Step 3: `P3`

目標:
- 修補非主流程的表單 schema 遺漏欄位
- 避免未來切回 `usePatientsPage()` / `usePatientDialogState()` 時重新引入同類 bug

範圍:
- `src/features/patients/patient-form-schema.ts`
- `src/hooks/patients/use-patient-dialog-state.ts`

狀態:
- [x] 未開始
- [x] 進行中
- [x] 已完成

驗證:
- [x] `npm run build`
- [x] 檢查 `parseEditPatientForm()` 已包含 `height`、`weight`、`intubationDate`

## 驗證日誌

### Step 1
- 已完成
- 新增 `src/lib/patient-data-sync.ts`
- 新增 `src/lib/dashboard-stats-cache.ts`
- `patient-detail.tsx` 的 `handleEditSave()` 現在會在 update 後呼叫 shared sync helper，不再只做 `setPatient(updated)`
- `patients.tsx` 的 update/create/archive/discharge 已改走 shared sync helper
- `dashboard.tsx` 已改成使用 shared dashboard stats cache module
- 驗證: `npm run build` 通過

### Step 2
- 已完成
- `patients-cache.ts` 新增 shared cache listener
- `dashboard-stats-cache.ts` 新增 shared stats cache listener
- `workstation` / `dosage` / `compatibility` / `interactions` / `advice-statistics` / `dashboard` 已接上 shared patients cache 訂閱
- `dosage` 另外補了 silent resync：已選病人時，若病人基本資料更新，`height/weight/sex` 也會跟著更新
- 驗證: `npm run build` 通過

### Step 3
- 已完成
- `parseEditPatientForm()` 已補上 `height`、`weight`、`intubationDate`
- `usePatientDialogState()` 無需額外改動即可吃到修正後 payload
- 驗證: `npm run build` 通過

## 備註

- 這份修補優先修主流程與 shared cache，不先做大型重構
- 若途中發現 `dashboard` 的 private stats cache 仍阻礙同步，允許把它抽成小型 shared module
