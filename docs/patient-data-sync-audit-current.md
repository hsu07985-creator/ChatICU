# Patient Data Sync Audit（現況版）

日期: 2026-04-16
前版: [patient-data-sync-audit.md](./patient-data-sync-audit.md)（歷史快照，2026-04-14）

目的:
- 確認 2026-04-14 歷史 audit 所描述的問題是否仍存在
- 記錄現況與殘留邊界情況

---

## 整體現況摘要

原 audit 標記的三個高風險問題（P0/P1/P2）**均已修復**。
目前只有一個輕微的邊界情況尚未處理。

---

## 已修復項目

### P0 — `patient-detail.tsx` 儲存後無 `invalidatePatients()`

**修復方式**：`src/lib/patient-data-sync.ts` 引入 `refreshSharedPatientDataAfterMutation()`，
detail 頁的 `handleEditSave()` 現在在 `updatePatient` 後立即呼叫它。

位置: `src/pages/patient-detail.tsx:438-439`
```ts
const updated = await patientsApi.updatePatient(patient.id, editingPatient);
await refreshSharedPatientDataAfterMutation();
```

`refreshSharedPatientDataAfterMutation` 內部會並行呼叫：
- `invalidatePatients()` → 清 shared patient cache 並 fetch 最新病人列表
- `invalidateDashboardStats()` → 清 dashboard stats cache

狀態: **已修復**

---

### P1 — pharmacy 頁面不訂閱 cache 更新

**修復方式**：所有依賴 shared patients cache 的頁面均已新增 `subscribePatientsCache()` 訂閱。
當任何頁面呼叫 `invalidatePatients()` 後，所有訂閱頁面會自動收到新的病人列表並更新 local state。

確認位置：

| 頁面 | 訂閱位置 |
|------|---------|
| `pharmacy/workstation.tsx` | line 68-73 |
| `pharmacy/dosage.tsx` | line 118-123 |
| `pharmacy/compatibility.tsx` | line 216-219 |
| `pharmacy/interactions.tsx` | line 146-149 |
| `pharmacy/advice-statistics.tsx` | line 73 |
| `dashboard.tsx` | line 124-129（patients）、131-135（stats） |

狀態: **已修復**

---

### P2 — `parseEditPatientForm()` 漏掉 `height`、`weight`、`intubationDate`

**修復方式**：三個欄位已補回 return payload。

位置: `src/features/patients/patient-form-schema.ts:107-114`
```ts
height: patient.height ?? null,
weight: patient.weight ?? null,
...
intubationDate: patient.intubationDate ?? null,
```

狀態: **已修復**

---

## 現存殘留邊界情況

### dosage.tsx 的 height/weight 表單前填（輕微，低風險）

位置: `src/pages/pharmacy/dosage.tsx:149-158`

現況:
- 用戶選病人後，`handlePatientSelect` 把 `height/weight` 帶入表單欄位
- `subscribePatientsCache` 會在 cache 失效時更新 `patients` 陣列
- 但**已填入表單的欄位不會自動更新**，需重新選病人才能拿到最新值

影響範圍:
- 只有在「用戶已選病人」且「同一 session 中其他頁面更新了該病人 height/weight」才會發生
- 若用戶重新選病人（或重整頁面），欄位會自動填入最新值
- 計算結果不對的情況下用戶可手動修正數值

風險: **低**（操作上有自然的重選流程可恢復，不影響資料儲存）

---

## 架構現況確認

### patients-cache.ts 機制

位置: `src/lib/patients-cache.ts`

- Module-level singleton，TTL 5 分鐘
- `invalidatePatients()` 清 cache 後立即 fetch，並呼叫 `notifyPatientsCacheListeners()`
- `subscribePatientsCache(listener)` 提供 reactive 訂閱，所有主要頁面均已訂閱
- 結論：cache 現在同時具備 TTL 保護與 mutation-driven 即時失效能力

### 統一 mutation policy

目前所有 mutation path 一律透過 `refreshSharedPatientDataAfterMutation()`：

| 頁面 | mutation path |
|------|--------------|
| `patient-detail.tsx` | `handleEditSave` |
| `patients.tsx` | `handleSave` |
| `dashboard.tsx` | `handleSaveEdit` |

`patients.tsx` 與 `dashboard.tsx` 的路徑略有差異（dashboard 另外直接呼叫 `invalidateDashboardStats()` 以確保 stats 同步），但均涵蓋 `invalidatePatients()`。

### 後端 `ventilator_days` 重算

位置: `backend/app/routers/patients.py:348-366`

- 若 `intubation_date` 有值且 `intubated` 為 true，後端重算 `ventilator_days`
- 更新 response 回傳最新值
- 無變動，仍正確

---

## 一句話總結

原 audit 描述的「patient-detail 更新不同步 shared cache、pharmacy 頁面不訂閱 cache 更新、parseEditPatientForm 漏欄位」三個問題均已修復。
目前系統具備統一的 mutation policy，透過 `refreshSharedPatientDataAfterMutation` + `subscribePatientsCache` 訂閱機制，保證 mutation 後所有頁面自動同步。
