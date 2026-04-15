# Patient Data Sync Audit

> **[SUPERSEDED]** 本文件為 2026-04-14 的歷史快照，所描述的 P0/P1/P2 問題已在後續提交中修復。
> 請參閱最新版本：[patient-data-sync-audit-current.md](./patient-data-sync-audit-current.md)

日期: 2026-04-14（歷史版本）

目的:
- 重新確認「病人資料編輯後，其他頁面沒有同步更新」這一類問題
- 特別聚焦 `height`、`weight`、`intubationDate`、`ventilatorDays`
- 只保留目前主流程已確認成立的問題
- 將非主流程或未接線路徑降級標註，避免誤判

## 精準結論

目前主流程真正成立的根因有兩個：

1. `patient-detail` 的病人編輯儲存只更新本頁 local state，沒有刷新共用病人快取
2. 多個依賴病人基本資料的頁面只在 mount 時讀一次 `patients-cache.ts`，之後不會自動同步

這代表：
- 在病人詳情頁改完病人資料後，當前 detail 頁可能是新的
- 但其他已開著、且依賴 shared patient cache 的頁面，仍可能繼續顯示舊的 `height`、`weight`、`intubationDate`、`ventilatorDays`

## 已確認成立的主流程問題

### 1. `patient-detail` 儲存後沒有 `invalidatePatients()`

位置:
- `src/pages/patient-detail.tsx:418-430`

現況:
- 儲存後做 `const updated = await patientsApi.updatePatient(...)`
- 接著 `setPatient(updated)`
- 沒有 `invalidatePatients()`

影響:
- 目前 detail 頁顯示的是最新病人資料
- 但 shared patient cache 仍可能保留舊值
- 其他依賴 shared patient cache 的頁面不會同步更新

風險:
- 高

### 2. `patients-cache.ts` 是手動 TTL cache，mutation path 漏 invalidate 就會 stale

位置:
- `src/lib/patients-cache.ts:1-44`

現況:
- `_cache` 是 module-level singleton
- TTL 是 5 分鐘
- 不會自動和 mutation、local state、dashboard stats 對齊

影響:
- 任何病人資料更新路徑只要少了 `invalidatePatients()`
- 其他頁面就會在 cache TTL 內繼續拿舊資料

風險:
- 高

### 3. 多個頁面只在 mount 時讀一次 shared cache，之後不會重新同步

位置:
- `src/pages/pharmacy/workstation.tsx:47-60`
- `src/pages/pharmacy/dosage.tsx:33-35, 101-115, 140-152`
- `src/pages/pharmacy/compatibility.tsx:199-211`
- `src/pages/pharmacy/interactions.tsx:129-141`
- `src/pages/pharmacy/advice-statistics.tsx:28-30, 64-67`
- `src/pages/dashboard.tsx:45-47, 108-115`

現況:
- 頁面初始化時先讀 `getCachedPatientsSync()`
- 若 cache 命中，就跳過 fetch
- 之後資料保存在各頁自己的 local `patients` state
- 不會訂閱 cache 失效事件，也不會在其他頁更新後自動同步

影響:
- 已開著的頁面不會自動變新
- `workstation` 會直接使用舊的 `height/weight`
- `dosage` 會直接帶入舊的 `height/weight`
- `dashboard` 可能繼續顯示舊病人列表資料

風險:
- 高

### 4. `workstation` 與 `dosage` 直接依賴 cached patient basic data

位置:
- `src/pages/pharmacy/workstation.tsx:97-106, 703-719`
- `src/pages/pharmacy/dosage.tsx:140-152, 279-280, 355-366`

現況:
- `workstation` 直接從 `selectedPatient.height/weight` 建 `extendedData`
- `dosage` 在選病人時直接把 `height/weight` 帶入表單

影響:
- 若來源 patient cache 是舊的
- 這兩頁不只是顯示舊資料，還會把舊值帶入後續評估與計算

風險:
- 高

## 已確認較安全的主流程

### 1. `patients.tsx` 的更新路徑有清 shared patients cache

位置:
- `src/pages/patients.tsx:153-161`

現況:
- `await patientsApi.updatePatient(...)`
- `await invalidatePatients()`
- `await fetchPatients()`

評估:
- 這條主流程會刷新 shared patient cache
- 比 `patient-detail` 安全

### 2. `dashboard.tsx` 的本頁 edit path 有清 patients cache，也有清 stats cache

位置:
- `src/pages/dashboard.tsx:153-165`

現況:
- `updatePatient()`
- `invalidatePatients()`
- `setPatients(freshPatients)`
- 清 `_statsCache`
- `fetchStats()`

評估:
- dashboard 自己的 edit path 是相對完整的
- 之前將它寫成「沒有處理 stats cache」是不精準的

## 非主流程或潛在回歸風險

### 1. `parseEditPatientForm()` 漏掉 `height`、`weight`、`intubationDate`

位置:
- `src/features/patients/patient-form-schema.ts:75-121`
- `src/hooks/patients/use-patient-dialog-state.ts:52-66`
- `src/pages/use-patients-page.ts:6-14`

現況:
- `parseEditPatientForm()` 的回傳 payload 沒有：
  - `height`
  - `weight`
  - `intubationDate`
- 但它目前是接在 `usePatientDialogState()` / `usePatientsPage()` 這條路上
- 目前實際 `/patients` 路由不是走這條

評估:
- 這不是目前 production 問題的主因
- 但如果未來把這條 hook/page model 接回主流程，會立刻重新引入同類 bug

風險:
- 中

### 2. `PatientEditDialog` 的「呼吸器天數」只是顯示值

位置:
- `src/components/patient/dialogs/patient-edit-dialog.tsx:197-203`

現況:
- UI 會依 `intubationDate` 即時計算顯示天數
- 這只是顯示，不是獨立欄位來源

評估:
- 這本身不是 bug
- 只要 `intubationDate` 有正確送到後端，後端會重算 `ventilator_days`
- 真正的 bug 是「更新路徑沒同步 shared cache」或「某條非主流程 schema 漏欄位」

風險:
- 低

## 後端確認

### `ventilator_days` 的重算邏輯本身沒有問題

位置:
- `backend/app/routers/patients.py:348-366`

現況:
- 若 `intubation_date` 有值且 `patient.intubated` 為 true
- 後端會重算 `patient.ventilator_days`
- update response 也會回傳新的 `ventilatorDays`

評估:
- 後端邏輯合理
- 問題主要不在後端重算
- 問題主要在前端多份 state / cache 沒同步

## 問題類型總結

### A. Local-only refresh

症狀:
- 當前頁面資料變新
- 其他頁面仍顯示舊值

目前主案例:
- `src/pages/patient-detail.tsx`

### B. Cache invalidation gap

症狀:
- 有些 mutation path 會清 `patients-cache.ts`
- 有些 mutation path 不會

目前主案例:
- `src/pages/patients.tsx` vs `src/pages/patient-detail.tsx`

### C. Multiple sources of truth

症狀:
- local state
- shared TTL cache
- dashboard stats cache
- 非主流程 hook / page model

同一份病人資料分散在多個來源，沒有統一 mutation policy

### D. 潛在 payload mismatch

症狀:
- 某些未接回主流程的 schema 會漏欄位

目前案例:
- `parseEditPatientForm()` 漏 `height`、`weight`、`intubationDate`

## 修補建議

### P0
- 修正 `patient-detail.tsx` 儲存病人後的同步策略
- 更新完成後至少要 `invalidatePatients()`

### P1
- 定義所有 patient mutation 的共用 post-save policy
- 至少統一：
  - 何時清 `patients-cache.ts`
  - 何時刷新當前頁面 local state
  - 何時刷新 dashboard stats

### P2
- 清掉或補齊非主流程的 patient edit schema
- 避免未來切回 `usePatientsPage()` 時重新引入欄位遺失問題

## 一句話總結

目前這類 bug 的主因不是某個欄位特別難，而是：

`patient-detail` 的更新沒有同步 shared patient cache，而多個頁面又只在 mount 時吃一次 cache，導致病人資料在不同頁面分裂。
