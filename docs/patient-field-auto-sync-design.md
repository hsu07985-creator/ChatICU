# 病人欄位自動同步設計

日期: 2026-04-16（2026-04-16 更新：新增步驟 1B，用 HIS snapshot 差集偵測檢驗/培養/用藥/診斷新增）

## 目標

當任何人（另一位使用者或 HIS 自動同步）改了病人資料後，
前端自動偵測哪些欄位有變動，並把新值更新到相關頁面的顯示與表單欄位上，
不需要使用者手動重新整理。

**兩個並行的偵測層：**

1. **病人基本欄位層**（身高、體重、插管日期、鎮靜劑⋯）— 透過 `diffPatient()` 比對 `patients-cache` 新舊值
2. **臨床紀錄層**（`lab_data`、`culture_results`、`diagnostic_reports`、`medications`）— 透過後端 snapshot sync 在 DELETE+INSERT 之前用 **ID 集合差集** 算出新增/刪除，把每次 tick 的 delta 累積到 `sync_status.details.recent_deltas` ring buffer，前端 polling 時逐事件彈 toast

---

## 現有基礎

| 機制 | 位置 | 功能 |
|------|------|------|
| `useExternalSyncPolling` | `src/hooks/use-external-sync-polling.ts` | 每 60 秒問後端版本號，有變就刷新 shared cache 並顯示 delta toast |
| `subscribePatientsCache` | `src/lib/patients-cache.ts` | cache 更新後推送新 `patients[]` 給所有訂閱頁面 |
| `refreshSharedPatientDataAfterMutation` | `src/lib/patient-data-sync.ts` | 手動存檔後清 cache 並通知訂閱者 |
| `replace_patient_records()` | `backend/app/fhir/snapshot_sync.py` | 回傳 `{total, added, removed, added_ids, removed_ids}` delta |
| `upsert_global_sync_status()` | `backend/app/fhir/snapshot_sync.py` | 把 delta 以 ring buffer 形式累積進 `sync_status.details.recent_deltas` |

---

## 五個實作步驟

### 步驟 1 — 建 `diffPatient()` 比較函數 ✅ 已完成

**位置**：`src/lib/patient-diff.ts`（已建立）

**匯出的函數 / 型別**：

| 名稱 | 說明 |
|------|------|
| `diffPatient(old, new)` | 主函數，回傳 `PatientDiffResult` |
| `PatientDiffResult` | `{ hasChanges, changed: ChangedField[], hasClinicalChanges }` |
| `ChangedField` | `{ field, label, priority, oldValue, newValue }` |
| `formatChangedFieldLabels(changed)` | 轉成顯示文字，如「身高、插管日期」 |
| `getHighPriorityChanges(changed)` | 只取 high priority（供 dosage 表單用） |

**比較邏輯**：
- 字串、數字、boolean：`===` 直接比較
- 陣列（`sedation`、`analgesia`、`nmb`）：排序後逐一比對，避免順序不同誤報
- `null` / `undefined`：統一視為 `null`，不誤報差異

**欄位優先度**：

| priority | 欄位 | 影響 |
|----------|------|------|
| `high` | `height`, `weight`, `intubated`, `intubationDate` | dosage 劑量計算、呼吸器天數 |
| `medium` | `sedation`, `analgesia`, `nmb` | 藥局各頁顯示 |
| `low` | `name`, `bedNumber`, `gender`, `age`, `diagnosis`, `admissionDate`, `icuAdmissionDate`, `attendingPhysician`, `department`, `consentStatus`, `hasDNR`, `isIsolated`, `codeStatus`, `criticalStatus`, `bloodType` | 純顯示 |

**跳過不追蹤的欄位**（衍生值或不需比較）：
`id`, `lastUpdate`, `bmi`, `ventilatorDays`, `medicalRecordNumber`, `alerts`, `sanSummary`, `hasUnreadMessages`

---

### 步驟 1B — HIS snapshot delta 偵測（lab / culture / diagnostic / medication） ✅ 已完成

**核心觀察**：HIS snapshot 的每筆檢驗/培養/用藥/診斷都用穩定 ID（`lab_{PAT_NO}_{REPORT_DATE}_{REPORT_TIME}`、`cul_{PAT_NO}_{SHEET_NO}`、`med_{PAT_NO}_{ODR_SEQ}`、`diag_{PAT_NO}_{ODR_SEQ}`）編碼。
這些 ID 本身已經隱含「建立時間」語意 —— 對同一病人做 `incoming_ids - existing_ids` 集合差集，就等於拿到這次 snapshot 「新增了哪幾筆」。不需要另建 audit log，也不需要讀每筆的 `created_at`。

**後端改動**（`backend/app/fhir/snapshot_sync.py`）：

1. `replace_patient_records()` 在 `DELETE WHERE patient_id` 之前先 `SELECT id`，算出 `added_ids / removed_ids`，回傳 dict 而不是 int：
   ```python
   return {"total": N, "added": A, "removed": R, "added_ids": [...], "removed_ids": [...]}
   ```
2. `reconcile_medications()` 同樣回傳 `added / added_ids`（原本只有 `upserted / deleted / protected`）。
3. `upsert_global_sync_status()` 把每次 tick 的 delta 推進 `sync_status.details.recent_deltas` ring buffer（上限 50 筆）。**讀舊值 → append → 寫回**，所以同一 tick 內連續 sync 14 個病人也不會互相覆蓋。
4. 零變動的 tick（`added=0` 且 `deleted=0`）不會進 ring buffer，避免前端 toast 被 no-op 刷屏。

**前端改動**（`src/hooks/use-external-sync-polling.ts`）：

1. `SyncStatusResponse.details` 新增 `recent_deltas: SyncDeltaEvent[]`。
2. Polling hook 新增 `lastDeltaAtRef` 游標，第一次 poll 只把游標推到最新事件**不 toast**（避免開頁面時把 backlog 全噴出來），之後每次 poll 只彈 `synced_at > lastDeltaAt` 的新事件。
3. Toast 文案：`林阿玉（16312169）｜2 筆新檢驗、1 份新培養、1 筆新醫囑已同步`。

**驗證**（`backend/tests/test_fhir/test_snapshot_sync.py`）：
- `test_replace_patient_records_reports_added_and_removed_ids`：驗證 set-diff 計算正確
- `test_upsert_global_sync_status_accumulates_recent_deltas`：驗證多病人不覆蓋、零變動不入 ring buffer
- `test_reconcile_medications_deletes_stale_without_admins_and_protects_with_admins`：補上 `added / added_ids` 斷言

### 步驟 2 — patient-detail 訂閱 cache，收到更新時比對並更新 state

**位置**：`src/pages/patient-detail.tsx`

**現況**：`patient` state 只在進頁面時讀一次，之後沒有訂閱。

**新增邏輯**：
```
useEffect(() => {
  return subscribePatientsCache((nextPatients) => {
    找到 nextPatients 裡對應目前 patient.id 的那筆
    如果找不到 → 不動作
    跑 diffPatient(現在的 patient, 新的 patient)
    如果沒在編輯（editingPatient === null）:
      → 直接 setPatient(新的 patient)
      → 若有 diff → 顯示 toast「已同步更新：身高、插管日期」
    如果正在編輯（editingPatient !== null）:
      → 不覆蓋，改走步驟 3
  });
}, [patient, editingPatient]);
```

---

### 步驟 3 — 編輯衝突處理

**位置**：`src/pages/patient-detail.tsx` + `src/components/patient/dialogs/patient-edit-dialog.tsx`

**情境**：使用者正在填寫編輯表單，這時後端資料被另一個人或 HIS 同步改了。

**處理方式**：
- 不要直接覆蓋使用者正在填的表單
- 在 dialog 頂部顯示 banner：「資料已在其他地方更新（身高 165→170、體重 60→62），要套用最新值嗎？」
- 提供兩個按鈕：「套用最新值」（覆蓋表單）、「忽略」（繼續填自己的）

**需要的新 state**：
```ts
const [pendingExternalUpdate, setPendingExternalUpdate] =
  useState<PatientWithFrontendFields | null>(null);
```

---

### 步驟 4 — dosage 選中病人後若資料更新，同步表單欄位

**位置**：`src/pages/pharmacy/dosage.tsx`

**現況**：
- `subscribePatientsCache` 已有，會更新 `patients[]`
- 但「選病人時帶入的 height/weight 表單欄位」不會自動更新

**新增邏輯**：
```
useEffect(() => {
  if (!selectedPatientId) return;
  const freshPatient = patients.find(p => p.id === selectedPatientId);
  if (!freshPatient) return;
  // 只有數值不同才更新，避免覆蓋使用者手動修改的值
  // 可用一個 ref 記住「上次帶入的值」做比對
  if (freshPatient.height && String(freshPatient.height) !== lastAutoFilledHeight.current) {
    setHeight(String(freshPatient.height));
    lastAutoFilledHeight.current = String(freshPatient.height);
  }
  // 同理處理 weight
}, [patients, selectedPatientId]);
```

---

## 實作優先序

| 順序 | 步驟 | 狀態 | 原因 |
|------|------|------|------|
| 1 | 步驟 1（diffPatient） | ✅ 完成 | 病人欄位 diff 其他步驟都依賴它 |
| 2 | 步驟 1B（HIS snapshot delta + ring buffer + toast） | ✅ 完成 | 臨床紀錄的新增偵測（使用者最在意） |
| 3 | 步驟 2（patient-detail 訂閱） | 待開發 | 最常用的頁面，影響最大 |
| 4 | 步驟 4（dosage 表單同步） | 待開發 | 直接影響劑量計算正確性 |
| 5 | 步驟 3（編輯衝突） | 待開發 | 邊界情況，但使用者體驗重要 |

---

## 不需要動的地方

- `patients-cache.ts`：架構夠用，不需改
- `useExternalSyncPolling`：輪詢機制夠用，不需改
- 後端：沒有問題，不需改

---

## 一句話說明

這個功能的核心是：**cache 更新 → 找到變動的欄位 → 決定要自動套用還是詢問使用者**。
基礎設施已經夠了，缺的只是「欄位 diff」和「根據頁面狀態決定如何套用」這兩塊邏輯。

---

## 部署說明

### 這個功能影響哪些層

| 層 | 有沒有改動 | 說明 |
|----|----------|------|
| Supabase（資料庫） | **不需要** | `sync_status.details` 已是 JSONB，ring buffer 直接放進去，不需新 migration |
| Railway（後端 API） | **需要**（步驟 1B） | `replace_patient_records()` / `reconcile_medications()` / `upsert_global_sync_status()` 改動 |
| Vercel（前端） | **需要** | `src/hooks/use-external-sync-polling.ts`、`src/lib/api/sync.ts`、`src/lib/patient-diff.ts` |

**結論：步驟 1 純前端 → `git push railway main`；步驟 1B 前後端都改 → 先 `git push personal main`（Railway 後端）等 Railway 健康，再 `git push railway main`（Vercel 前端）。**

---

### 完整部署步驟

#### Step 1 — 確認本地 build 通過

```bash
# 在專案根目錄
npm run build
# 預期：4 個 chunk，無 TypeScript 錯誤
```

#### Step 2 — 建 feature branch 並 commit

```bash
git checkout -b feat/patient-field-auto-sync

# 加入所有改動的檔案
git add src/lib/patient-diff.ts
git add src/pages/patient-detail.tsx
git add src/pages/pharmacy/dosage.tsx
# 若有改 PatientEditDialog：
git add src/components/patient/dialogs/patient-edit-dialog.tsx

git commit -m "$(cat <<'EOF'
feat(sync): auto-detect and apply patient field changes from shared cache

Add diffPatient() utility, subscribe patient-detail to cache updates,
sync dosage form fields when selected patient data changes externally.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

git checkout main
git merge feat/patient-field-auto-sync --no-edit
```

#### Step 3 — 部署到 Vercel（前端）

```bash
git push railway main
# Vercel 收到 push → npm install → Vite build → 自動部署
# 約需 1-2 分鐘
```

#### Step 4 — 驗證部署

```bash
# 確認新 bundle 已上線（hash 值會跟上一次不同）
curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js'

# 確認 Railway URL 沒有洩漏進 bundle（應無輸出）
BUNDLE=$(curl -s https://chat-icu.vercel.app/ | grep -oE 'assets/index-[^"]+\.js')
curl -s "https://chat-icu.vercel.app/$BUNDLE" | grep -oE 'chaticu-production[^"]*' | head -1
```

#### Step 5 — 瀏覽器功能驗證

1. 開啟 `https://chat-icu.vercel.app`，`Ctrl+Shift+R` 清除快取
2. 進入任一病人詳情頁（`/patient/pat_xxx`）
3. 在另一個 tab 或由另一位使用者修改同一病人的身高/體重
4. 等待最多 60 秒（`useExternalSyncPolling` 輪詢週期）
5. 確認詳情頁出現 toast「已同步更新：身高」並顯示新數值
6. 進入藥局 dosage 頁，選同一病人，確認表單帶入的是最新身高/體重

#### Step 6 — 備份到 origin（可選）

```bash
git push origin main
```

---

### 若之後需要後端配合（目前不需要，記錄備用）

如果未來要改成「後端主動推播變動」而非前端輪詢，才需要後端改動：

| 情境 | 需要改什麼 | 部署指令 |
|------|----------|---------|
| 加 WebSocket 或 SSE 端點 | `backend/app/routers/` | `git push personal main` |
| 加新的 DB 欄位 | `backend/alembic/versions/` 新增 migration | `git push personal main`（Railway 自動執行） |
| 改 Supabase schema | 同上，用 migration，不要直接在 Supabase console 改 | 同上 |

Supabase 的 schema 變更**一律透過 Alembic migration**，Railway 啟動時會自動套用，不需要手動進 Supabase 操作。
