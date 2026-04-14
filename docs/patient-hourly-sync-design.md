# Patient Hourly Snapshot 自動同步設計

日期: 2026-04-14

目的:
- 以 `patient/16312169` 的最新真實結構為依據
- 設計一套能自動偵測新病患、同病歷號新快照、並自動同步到雲端 DB 的流程
- 同時避免重複匯入與覆蓋手動補資料

---

## 進度狀態

### 第一批實作：已完成

已完成項目：
- 新增 snapshot resolver：
  - [backend/app/fhir/snapshot_resolver.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/fhir/snapshot_resolver.py:1)
  - 支援 `latest.txt`
  - 支援時間戳子資料夾 fallback
  - 支援舊版平面結構 fallback
  - 支援 normalized hash，忽略 `DateTime`、`_RunTimestamp`、`_GeneratedAt`
- 新增 `getIPD.json <-> getIpd.json` alias：
  - [backend/app/fhir/his_converter.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/fhir/his_converter.py:426)
- 補上 snapshot 目錄下的病歷號 override：
  - `HISConverter(..., pat_no=...)`
  - 避免直接吃 `patient/<mrn>/<timestamp>/` 時把 timestamp 誤當成病歷號
- 新增 dry-run 同步腳本：
  - [backend/scripts/sync_his_snapshots.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/sync_his_snapshots.py:1)
  - 目前僅做 discovery / resolve / state compare / action classify
  - 尚未寫 DB
- 新增測試：
  - [backend/tests/test_fhir/test_snapshot_resolver.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/tests/test_fhir/test_snapshot_resolver.py:1)

驗證結果：
- `python3 -m pytest backend/tests/test_fhir/test_snapshot_resolver.py -v --tb=short`
  - `7 passed`
- `python3 backend/scripts/sync_his_snapshots.py --patient 16312169 --dry-run`
  - 成功解析 `latest.txt -> 20260412_010000`
  - action = `new`
- 使用模擬 state file 再跑 dry-run
  - 同一內容、只換 snapshot timestamp 時，action = `timestamp-only`
- 以真實 `patient/16312169/20260412_010000` 驗證 `HISConverter(..., pat_no=\"16312169\")`
  - 能正確讀到 `getIpd.json`
  - `medical_record_number` 不會被誤寫成 `20260412_010000`

第一批尚未完成的範圍：
- 尚未處理外部匯入後的前端即時刷新
- 尚未做長期排程（launchd / cron）
- 尚未做人工欄位衝突策略的產品化設定
- 尚未做正式 production DB 的端到端驗證

### 第二批實作：已完成

已完成項目：
- 新增 DB sync service：
  - [backend/app/fhir/snapshot_sync.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/fhir/snapshot_sync.py:1)
  - 提供 patient merge、子表 replace、medication reconcile
- `sync_his_snapshots.py` 已接到實際 DB 匯入：
  - [backend/scripts/sync_his_snapshots.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/sync_his_snapshots.py:1)
  - 支援 `--dry-run`
  - 支援 `--force`
  - 成功同步後寫回 state file
- 病人主表採安全 merge：
  - HIS 擁有欄位直接覆蓋
  - 人工欄位保留既有值，避免被空值 / 預設值洗掉
- 子表同步策略：
  - `lab_data` / `culture_results` / `diagnostic_reports`
    - 採 `replace-per-patient`
  - `medications`
    - 採 `upsert + stale prune`
    - 若舊藥單已有 `medication_administrations`
      - 不刪除
      - 改標記成 `discontinued`
    - 若舊藥單沒有 administration
      - 才刪除
- state file 邏輯：
  - 空檔案可正確視為空 state
  - 同一 state file 第二次同步時，若 hash 與 snapshot 相同，會判定 `unchanged` 並跳過

新增測試：
- [backend/tests/test_fhir/test_snapshot_sync.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/tests/test_fhir/test_snapshot_sync.py:1)
  - 驗證 patient merge 會保留人工欄位
  - 驗證 medication reconcile 會刪除無 administration 的 stale meds，並保護有 administration 的 stale meds

第二批驗證結果：
- `python3 -m pytest backend/tests/test_fhir/test_snapshot_resolver.py backend/tests/test_fhir/test_snapshot_sync.py -v --tb=short`
  - `9 passed`
- 隔離 SQLite 真同步驗證：
  - 第一次執行 `sync_his_snapshots.py --patient 16312169`
    - 成功寫入 `patients=1`
    - `medications=244`
    - `lab_data=123`
    - `culture_results=24`
    - `diagnostic_reports=31`
    - state file 成功寫入 `16312169`
  - 第二次使用同一份 state file 再跑
    - action = `unchanged`
    - sync = `skipped`

第二批尚未完成的範圍：
- 尚未處理外部匯入後的前端即時刷新
- 尚未做 `launchd` / cron 排程
- 尚未加入 production-safe logging / alerting
- 尚未處理更細的藥單刪除產品規則

### 第三批實作：已完成

已完成項目：
- 新增 DB 內 sync metadata：
  - [backend/app/models/sync_status.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/models/sync_status.py:1)
  - startup fallback 會自動確保 `sync_status` table 存在：
    - [backend/app/startup_migrations.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/startup_migrations.py:20)
- 同步腳本現在除了 state file，也會把全域 sync 狀態寫進 DB：
  - [backend/app/fhir/snapshot_sync.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/fhir/snapshot_sync.py:270)
  - [backend/scripts/sync_his_snapshots.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/sync_his_snapshots.py:184)
- 新增 backend API：
  - [backend/app/routers/sync_status.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/routers/sync_status.py:1)
  - `GET /sync/status`
  - 回傳：
    - `available`
    - `source`
    - `version`
    - `lastSyncedAt`
    - `details`
- 前端新增 sync API client：
  - [src/lib/api/sync.ts](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/api/sync.ts:1)
- 前端新增全域 polling hook：
  - [src/hooks/use-external-sync-polling.ts](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/hooks/use-external-sync-polling.ts:1)
  - 每 60 秒輪詢 `/sync/status`
  - 頁面從背景回到前景時也會立即檢查一次
  - 若 version 改變，會呼叫 shared cache refresh
- polling 已掛到受保護頁面共用 layout：
  - [src/App.tsx](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/App.tsx:91)
  - 所有已登入頁面共享同一套外部同步刷新邏輯
- 新增排程資產：
  - wrapper script：
    - [backend/scripts/run_his_snapshot_sync.sh](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/run_his_snapshot_sync.sh:1)
  - launchd 安裝腳本：
    - [backend/scripts/install_his_sync_launchd.sh](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/install_his_sync_launchd.sh:1)
  - cron 範例：
    - [backend/scripts/chaticu_his_sync.crontab.example](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/chaticu_his_sync.crontab.example:1)

新增測試：
- [backend/tests/test_api/test_sync_status.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/tests/test_api/test_sync_status.py:1)
  - 驗證 `/sync/status` 在 DB 無資料時回 `available=false`
  - 驗證 DB 有 sync metadata 時能正確回傳 version/details
- [backend/tests/test_fhir/test_snapshot_sync.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/tests/test_fhir/test_snapshot_sync.py:177)
  - 驗證 `upsert_global_sync_status()` 會把 sync metadata 寫進 DB

第三批驗證結果：
- `python3 -m pytest backend/tests/test_fhir/test_snapshot_resolver.py backend/tests/test_fhir/test_snapshot_sync.py backend/tests/test_api/test_sync_status.py -v --tb=short`
  - `12 passed`
- `npm run build`
  - 通過
- 排程資產驗證：
  - `bash -n backend/scripts/run_his_snapshot_sync.sh`
  - `bash -n backend/scripts/install_his_sync_launchd.sh`
  - 生成臨時 plist 後 `plutil -lint`
  - 全部通過
- 隔離 SQLite 真同步驗證：
  - `sync_his_snapshots.py` 同步後，`sync_status` table 內存在：
    - `key = his_snapshots`
    - `source = his_snapshots`
    - `version = <synced_at>`
    - `details` 內含 `patient_mrn = 16312169`

第三批尚未完成的範圍：
- 尚未把 `/sync/status` polling 的使用者提示產品化
  - 目前是 silent cache refresh，沒有 toast / badge
- 尚未加入 production-safe alerting
  - 目前有 logging 基礎，但沒有針對 sync 失敗做 webhook / 告警
- 尚未做正式 production deploy 與實站驗證
  - backend 需上線新 `/sync/status`
  - 前端需重新 deploy 才會開始 polling
- 尚未做 `launchd` 安裝後的真機常駐驗證

---

## 一、這次驗證到的真實資料夾格式

以 [patient/16312169](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/patient/16312169) 為例，現在格式已經不是舊版的平面結構，而是：

```text
patient/16312169/
  latest.txt
  20260412_000000/
    getPatient.json
    getLabResult.json
    getAllMedicine.json
    getAllOrder.json
    getIpd.json
    getSurgery.json
    ALL_MERGED.json
    ExtraFactories/...
  20260412_010000/
    getPatient.json
    getLabResult.json
    getAllMedicine.json
    getAllOrder.json
    getIpd.json
    getSurgery.json
    ALL_MERGED.json
    ExtraFactories/...
```

本地確認結果：
- [patient/16312169/latest.txt](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/patient/16312169/latest.txt:1) 內容是 `20260412_010000`
- 代表這個病例號底下目前有多輪快照，且 `latest.txt` 是最新版本指標

### 與現有匯入器的落差

現有匯入器 [backend/scripts/import_his_patients.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/import_his_patients.py:143) 只支援：

```text
patient/<病例號>/getPatient.json
patient/<病例號>/getLabResult.json
...
```

目前不支援：
- `latest.txt`
- 時間戳子資料夾
- `getIpd.json` 這種新命名

現有 `HISConverter` 也只會在傳入的單一資料夾底下直接找檔案：
- [backend/app/fhir/his_converter.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/fhir/his_converter.py:434)

所以結論很明確：

**現在這個新格式，還不能直接被現有匯入器自動吃到。**

---

## 二、這兩輪快照的差異實際上是什麼

我比對了：

- `20260412_000000`
- `20260412_010000`

結果：
- 各個主要 JSON 檔的 `Data` 筆數完全相同
- 排除 `DateTime`、`_RunTimestamp`、`_GeneratedAt` 這些抓取時間欄位後，內容完全相同

也就是說：

**這兩輪在內容上其實沒有變，只是重新抓了一次。**

這個結論非常重要，因為它直接告訴我們：

### 不應該只用「新時間戳資料夾」判定要不要重新匯入

如果只看到：

```text
20260412_010000 > 20260412_000000
```

就重新匯入，會造成：
- 重複寫 DB
- 無意義刷新前端
- 增加同步成本

正確做法應該是：

### 要做「內容 hash 判定」

建議規則：
- 先解析出最新快照目錄
- 取 `ALL_MERGED.json` 或所有主要 JSON 檔
- 去掉這些 volatile 欄位：
  - `DateTime`
  - `_RunTimestamp`
  - `_GeneratedAt`
- 再做 normalized hash

如果 hash 沒變：
- 就跳過，不匯入

如果 hash 有變：
- 才執行同步

---

## 三、你真正要的自動化目標

你現在要的其實是兩件事同時成立：

### 1. 自動新增新病患

情境：

```text
patient/
  16312169/
  99999999/   <- 新病例號第一次出現
```

系統應自動：
- 發現 `99999999`
- 解析最新快照
- 匯入 DB
- 前端之後能看到這位病患

### 2. 同病歷號有新資料時自動更新

情境：

```text
patient/16312169/
  latest.txt -> 20260412_020000
```

系統應自動：
- 發現 `latest.txt` 指到新快照
- 比對內容是否真的變更
- 若有變更，更新該病患與相關資料
- 前端能看到最新資料

---

## 四、我建議的整體設計

## A. 新增「快照解析器」

新增一個 resolver，邏輯如下：

### 輸入

病歷號根目錄，例如：

```text
patient/16312169/
```

### 輸出

回傳：
- `mrn`
- `snapshot_dir`
- `snapshot_id`
- `normalized_hash`
- `format_type`

### 判斷規則

1. 若有 `latest.txt`
   - 讀其內容，例如 `20260412_010000`
   - 對應到 `patient/16312169/20260412_010000/`

2. 若沒有 `latest.txt`
   - 找名稱符合 `YYYYMMDD_HHMMSS` 的最大子資料夾

3. 若既沒有 `latest.txt` 也沒有時間戳子資料夾
   - fallback 到舊版平面結構 `patient/16312169/`

### 另外要補的相容處理

目前新快照用的是：
- `getIpd.json`

舊匯入器預期的是：
- `getIPD.json`

所以 resolver 或 `HISConverter._load()` 要支援 alias：

```text
getIPD.json <-> getIpd.json
```

如果之後還有 `getOPD.json` / `getOpd.json` 之類，也建議一起做 filename alias map。

---

## B. 新增「同步狀態檔」

建議新增一個本地 state 檔，例如：

```text
backend/.state/his_snapshot_sync_state.json
```

記錄格式建議：

```json
{
  "16312169": {
    "snapshot_id": "20260412_010000",
    "snapshot_dir": "/abs/path/patient/16312169/20260412_010000",
    "normalized_hash": "a5dbbe09...",
    "last_imported_at": "2026-04-14T02:00:00+08:00",
    "patient_id": "pat_xxxxxx"
  }
}
```

用途：
- 判斷是不是新病例號
- 判斷是不是新快照
- 判斷是不是內容根本沒變

---

## C. 新增「同步腳本」

建議新增：

```text
backend/scripts/sync_his_snapshots.py
```

這個腳本做的事：

1. 掃描 `patient/`
2. 找出所有病例號資料夾
3. 對每個病例號跑 snapshot resolver
4. 產生 normalized hash
5. 讀 state 檔
6. 比對是否需要同步
7. 若需要：
   - 轉換
   - 匯入 DB
   - 更新 state
8. 印出同步結果摘要

### 建議支援的 CLI

```bash
cd backend
python3 scripts/sync_his_snapshots.py --dry-run
python3 scripts/sync_his_snapshots.py
python3 scripts/sync_his_snapshots.py --patient 16312169
python3 scripts/sync_his_snapshots.py --force
```

### 同步判定規則

#### Case 1: 新病例號

- state 沒有這個病歷號
- 直接同步

#### Case 2: 舊病例號，但 `snapshot_id` 變了

- 再比對 normalized hash
- hash 不同才同步
- hash 相同直接跳過

#### Case 3: `latest.txt` 沒變，但快照內容變了

- 也應該偵測得到
- 所以不能只靠 `snapshot_id`
- 還要靠 normalized hash

---

## D. 匯入策略不能只做簡單 upsert

這裡是整個設計最關鍵的地方。

現有 [import_his_patients.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/scripts/import_his_patients.py:71) 的策略是：

- patient: upsert
- medications: upsert
- lab_data: upsert
- culture_results: upsert
- diagnostic_reports: upsert

這對「資料只新增、不會消失」的情境沒問題。  
但你現在是快照式資料，問題就來了：

### 問題 1：舊資料若不再存在，upsert 不會刪掉它

例如：
- 01:00 的 `medications` 有 A、B、C
- 02:00 的最新快照只有 A、B

如果只做 upsert：
- C 會殘留在 DB

### 問題 2：病人主表有些欄位是人工補的，不該被 HIS 空值蓋掉

目前 `convert_patient()` 對很多欄位會給固定預設值：
- `bed_number: ""`
- `height: None`
- `weight: None`
- `symptoms: []`
- `intubated: False`
- `alerts: []`
- `allergies: []`
- `is_isolated: False`

見：
- [backend/app/fhir/his_converter.py](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/app/fhir/his_converter.py:485)

如果你做 hourly 自動同步，而且 `upsert_patient()` 每次都把這些值寫回去：
- 你在前端手動補的床號
- 手動補的身高體重
- 手動補的症狀
- 手動標記的隔離

都可能被洗掉。

這是目前自動化最大的風險。

---

## 五、因此我建議的同步策略

## 方案 1：最穩的 MVP

### 1. 病人主表採「欄位分層 merge」

把 patient table 欄位分成兩類：

#### HIS 擁有欄位

- `name`
- `medical_record_number`
- `age`
- `date_of_birth`
- `gender`
- `diagnosis`
- `attending_physician`
- `department`
- `admission_date`
- `icu_admission_date`
- `blood_type`
- `code_status`
- `has_dnr`
- `archived`

這些每次同步可以覆蓋。

#### 人工優先欄位

- `bed_number`
- `height`
- `weight`
- `bmi`
- `symptoms`
- `intubated`
- `critical_status`
- `alerts`
- `allergies`
- `is_isolated`
- `unit`
- `last_update`

這些不應該被 HIS 的空值 / 預設值洗掉。

#### 混合欄位

- `sedation`
- `analgesia`
- `nmb`
- `ventilator_days`
- `consent_status`

這些要看你想要：
- HIS 為主
- 還是人工補值優先

如果現在主要靠 HIS 匯入，這批可以先讓 HIS 覆蓋。

### 2. 關聯表採「replace-per-patient」

對這幾張表建議直接重建：

- `medications`
- `lab_data`
- `culture_results`
- `diagnostic_reports`

做法：

1. 找到該 `patient_id`
2. 在 transaction 內先刪掉這位病人的這些子表資料
3. 再插入這次快照重建出的資料

原因：
- 你的資料是完整快照，不是 patch
- replace 比 prune 邏輯簡單很多
- 比較不會殘留舊資料

---

## 六、如何讓前端看到最新資料

即使 backend 自動同步成功，前端也不會立刻知道。  
因為目前有快取：

- [src/lib/patients-cache.ts](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/patients-cache.ts:5)
- [src/lib/dashboard-stats-cache.ts](/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/src/lib/dashboard-stats-cache.ts:5)

現在這套 cache 只會在：
- 前端自己 mutation 後
- 或頁面手動刷新時

才更新。

但你的 hourly 同步是外部程序，不會自動通知前端。

### 所以還要補一個「前端刷新策略」

我建議從簡到難：

#### 方案 A：前端輪詢

最容易落地：

- `/patients`、`/dashboard`、藥學頁每 60 到 120 秒輪詢一次
- 若偵測到病人清單變更，更新 cache

#### 方案 B：加一個 sync version endpoint

例如：

```text
GET /sync/version
```

回：

```json
{
  "patients_last_synced_at": "...",
  "patients_version": "..."
}
```

前端只要比對 version 有沒有變，再決定是否 refresh。

#### 方案 C：SSE / WebSocket

最完整，但實作重：
- sync 完成時推送事件給前端
- 前端收到後 invalidate cache

### 我建議先做 B

因為：
- 比純輪詢省
- 比 SSE 簡單
- 跟你現在架構最相容

---

## 七、部署現實：誰來監看 `patient/`

這一點很重要。

你的 `patient/` 路徑是：

```text
/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/patient
```

這是**你本機**的資料夾，不是 Railway 容器內的共享路徑。

所以：

### Railway backend 不能直接監看你 Mac 上的 `patient/`

這代表自動同步程序不能只部署在雲端 backend 上。

### 正確做法

應該是讓「同步器」跑在能看到這個資料夾的地方：

- 你的本機 Mac
- 或一台掛載這個資料夾的 NAS / server

同步器負責：
- 監看 `patient/`
- 連接 Supabase DB
- 直接寫入雲端 DB

### 最實際的落地方法

#### 方法 1：每 5 分鐘跑一次 cron / launchd

最穩：

```bash
cd backend
python3 scripts/sync_his_snapshots.py
```

#### 方法 2：長駐 watcher

例如用 `watchdog`

優點：
- 幾乎即時

缺點：
- 較容易有漏事件、重複事件、跨檔案尚未寫完就觸發

### 我建議先做方法 1

理由：
- 你的資料是 hourly 快照，不是每秒變動
- 每 1 到 5 分鐘掃一次已經夠
- 比 file watcher 穩很多

---

## 八、最推薦的第一版落地方案

### 第一版目標

做到這四件事：

1. 自動發現新病例號
2. 自動判斷每個病例號的最新快照
3. 同內容不重複匯入
4. 新內容自動更新 DB

### 第一版組件

1. `snapshot resolver`
   - 支援 `latest.txt`
   - 支援時間戳子資料夾
   - 支援舊版平面結構 fallback
   - 支援 `getIpd.json` / `getIPD.json` alias

2. `normalized hash`
   - 去掉 `DateTime` / `_RunTimestamp` / `_GeneratedAt`

3. `sync state file`
   - 記錄病歷號最新同步結果

4. `sync_his_snapshots.py`
   - 定期執行

5. `replace-per-patient` 子表重建

6. `patient field merge policy`
   - 避免洗掉人工補資料

7. 前端 `sync version` 輪詢

---

## 九、我對你這個案例的具體判斷

用 `16312169` 這筆真實資料來看：

1. 你現在已經有很清楚的「latest 快照」結構了
   - 這是很好的自動化基礎

2. 單靠新時間戳資料夾不能判斷要不要匯入
   - 因為 `20260412_000000` 和 `20260412_010000` 內容其實相同

3. 如果直接把現有 `import_his_patients.py` 套到這個新格式
   - 會讀不到 nested snapshot
   - 也會 miss `getIpd.json`

4. 就算你把 nested path 接上
   - 如果不做 patient field merge，仍有很高機率洗掉人工欄位

所以真正正確的第一步不是直接改前端，而是：

### 先做 backend/local sync 層

也就是先把：
- 快照解析
- 內容 hash
- merge policy
- replace strategy

設計好。

---

## 十、我建議的開發順序

1. 先做 `snapshot resolver`
2. 再做 `normalized hash`
3. 再做 `sync state file`
4. 再做 `sync_his_snapshots.py --dry-run`
5. 再做 `replace-per-patient` 匯入策略
6. 再做 patient 主表 merge policy
7. 最後再做前端 refresh 機制

---

## 十一、下一步最合理的實作

如果直接開始做，我建議第一批只做：

### P1
- 支援 `patient/<mrn>/latest.txt`
- 支援 `patient/<mrn>/<timestamp>/`
- 支援 `getIpd.json` alias
- 新增 `--dry-run` 的 snapshot diff 檢查

### P2
- 加入 normalized hash 與 state file
- 實作「新病例號 / 新內容才匯入」

### P3
- 實作 replace-per-patient
- 加上 patient merge policy，保留人工欄位

### P4
- 補前端 sync version / polling

---

## 十二、一句話結論

你現在這個新格式已經很適合做自動同步，但不能直接拿現有匯入器硬跑。  
要先補：

- 最新快照解析
- 內容去噪 hash
- 同病例號更新策略
- 人工欄位保護
- 前端刷新機制

這樣你才能真的做到：

**「新病例號自動新增，同病例號新快照自動更新，而且前端看到的是最新資料。」**
