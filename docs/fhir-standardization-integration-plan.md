# FHIR 標準化層整合計畫

日期：2026-04-22
作者：main session（規劃文件，未動程式碼）
對應程式碼盤點：`/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/FHIR功能/`

---

## 一、為什麼要加這一層

### 現狀（已確認）

目前 `patient/*/getAllMedicine.json` → 前端用藥頁的這條流程，**已經有局部正規化**，但沒到「標準碼」層級：

| 既有機制 | 位置 | 做了什麼 | 用的是什麼碼 |
|---|---|---|---|
| HIS lab 分類 | `backend/app/fhir/his_lab_mapping.py` | 372 個 `LAB_CODE` → 內部 `(category, key, name)` | **自訂 key**（`Scr`, `K`, `Na` …），非 LOINC |
| HIS 藥品 DDI 對位 | `backend/app/fhir/his_ddi_alias_map.json` | `ODR_CODE` → DDI 表的 drug name | **藥名字串**，非 ATC/RxNorm |
| ChatICU LOINC map | `backend/app/fhir/loinc_map.py` | 內部 key → LOINC | 只做第二層（ChatICU key→LOINC），**沒**做第一層（HIS LAB_CODE→LOINC） |
| Medication table | `backend/app/models/medication.py` | 儲存藥品列 | 無 `atc_code` / `rxnorm_cui` 欄位 |
| Lab data JSONB | `lab_data.*` JSONB 欄位 | 儲存檢驗值 | 無 `loinc_code` 落在 row 層 |

### 問題

1. **DDI 比對依賴藥名字串比對**。[`medications.py:166-188`](../backend/app/routers/medications.py) 用 `generic_name`（已經過 alias map 正規化）去 `drug_interactions` 表查，只要 alias 沒更新就漏；若用 **ATC 比對**，同分類藥物可一次吃到。
2. **lab 表沒有 LOINC 落地**，要匯出 FHIR Observation、或對接外部知識庫（UpToDate、藥典 API、第二意見服務）都要現場算一次。
3. **新藥進 HIS 就要人工補 `his_ddi_alias_map.json`**，沒有自動補碼機制（`FHIR功能/藥物標準化/rxnorm.py` 正好解這題）。
4. **無可稽核的對照覆蓋率**。`bundle.py` 的 `coverage report`（clinical_lab_mapped / total / percent + by_category）在現在流程完全沒有等價產物，資料品質靠肉眼觀察。

### 加入 FHIR 標準化層後能做到

- 藥物：`ODR_CODE` → **ATC + RxNorm + HIS 本院碼** 三層同存（`medicationCodeableConcept.coding`）
- Lab：`LAB_CODE` → **LOINC + HIS 本院碼** 兩層同存（`Observation.code.coding`）
- 每次同步產 `report.json`：resource 計數、clinical_lab_percent、unmapped 清單
- DDI 與交互作用查詢可從「藥名比對」升級為「ATC/RxNorm 比對」
- 匯出 FHIR Bundle 給外部系統（研究、轉院、跨系統對接）不需重做

---

## 二、`FHIR功能/` 盤點（可直接複用的零件）

### 藥物標準化

| 檔案 | 關鍵函式 | 備註 |
|---|---|---|
| `藥物標準化/medication.py` | `map_medications(rows, pat_no, rxnorm_online)` → `(MedicationRequest[], unmapped[])` | 核心 mapper，吃 HIS `getAllMedicine.Data` row |
| `藥物標準化/rxnorm.py` | `extract_generic_name()` / `RxNormCache` / `lookup()` | **cache-first, network fallback**，離線可跑、miss 也會記錄避免重試 |
| `藥物標準化/atc_drugs.csv` | 約 100+ 筆 `odr_code → atc_code/rxnorm_cui/generic_name` 人工對照 | 含 `kidney_relevant` 欄，可再擴 ICU 相關 |
| `藥物標準化/auto_rxnorm_cache.json` | 自動查到的 generic → rxcui/ATC 快取 | 納版控，多人共享 |

### Lab 標準化

| 檔案 | 關鍵函式 | 備註 |
|---|---|---|
| `lab轉FHIR/observation.py` | `map_observations(rows, pat_no)` → `(Observation[], unmapped[])` | 含 `valueQuantity`/`valueString`/`referenceRange`/`interpretation`/來源工廠 extension |
| `lab轉FHIR/loinc_labs.csv` | `lab_code → loinc_code/unit_ucum/category` | **這份是 HIS LAB_CODE 直接對 LOINC**，跟現在 `his_lab_mapping.py` 剛好互補 |

### 共用

| 檔案 | 用途 |
|---|---|
| `共用與流程/bundle.py` | `build_bundle()` 組 FHIR Bundle + 產 `report`（coverage、unmapped） |
| `共用與流程/loader.py` | 讀 snapshot（和現有 `snapshot_resolver.py` 職責重複，可擇一） |
| `共用與流程/fhir_to_input_normalizer.py` | 反向：FHIR Bundle → `PatientInput`（供 AI pipeline 用）|
| `共用與流程/code_maps_init.py` | 讀 CSV 對照表的入口 |
| `共用與流程/date_utils.py` | 民國年轉 ISO 8601（現有 `his_converter.py` 已有 `_roc_to_date`，可擇一）|
| `共用與流程/run_fhir_convert.py` | CLI 批次轉換入口 |
| `共用與流程/common.py` | `codeable()` / `parse_number()` / `patient_ref()` |

### 需小心的事

- `FHIR功能/` 程式碼**是副本**，import 路徑是原專案 `ingestion.his_to_fhir.*` 格式，直接搬進來會壞；要改成 `app.fhir.*`。
- `fhir_to_input_normalizer.py` **依賴** `src.logic.dose_calculator`（逆轉腎 ai 專案的），ChatICU 沒有；若要引入要改寫或留原位。
- `bundle.py` 呼叫 `map_patient / map_encounters / map_conditions`，這三個 mapper **沒被搬進 `FHIR功能/`**，要嘛自己補、要嘛先只做 Medication + Observation。

---

## 三、整合策略（三種，推薦 C）

### A. 重欄位輕 Bundle（單純加標準碼欄位）

最小侵入：在 `medications` / `lab_data` 表多幾欄標準碼，同步時填進去，**不產 Bundle**。

- 改：`medications` 加 `atc_code VARCHAR(10)` / `rxnorm_cui VARCHAR(20)` / `coding_source VARCHAR(20)`（`local|rxnorm|unmapped`）
- 改：`lab_data` 每個 JSONB entry 內多放 `loinc` / `unit_ucum` key
- 改：`his_converter.convert_medications()` / `convert_lab_data()` 在組 dict 時查 `atc_map()` / `loinc_map()` 填欄位

**優點**：改動最小、前端與 DDI 查詢立即受惠。  
**缺點**：沒有 FHIR 資產可匯出，外部對接不了。

### B. 雙軌制（DB + Bundle 並行）

在 A 的基礎上，**每次同步額外產生一份 FHIR Bundle** 寫到 `data/fhir/{PAT_NO}.json`，附 report。

- 改：新增 `backend/app/fhir/bundle_builder.py`（搬 `bundle.py` + mapper）
- 改：同步完呼叫 `build_bundle()` 與 `write_bundle()`
- 改：新 API `GET /patients/{id}/fhir-bundle` 回傳最新 bundle 或重新產生

**優點**：既有 API 全部不動、AI/外部都能吃 Bundle。  
**缺點**：DB 與 Bundle 兩邊都要維護、一致性風險。

### C. 標準碼欄位 + On-demand Bundle（推薦）

A 的 DB 改動 + B 的 Bundle 產出邏輯，但 Bundle **只在需要時才產**（export、AI 呼叫）、不落盤。DB 欄位當唯一真相來源。

- DB：同 A
- Bundle：同步**不**產、但程式碼到位，API 呼叫才 `build_bundle_from_db(patient_id)`
- Coverage report：同步完成時額外產一份寫到 `backend/.logs/his_sync.coverage.{timestamp}.json`，方便長期追蹤對照表品質

**優點**：單一真相、改動可控、對外介面彈性最高。  
**缺點**：第一次實作工作量比 A 大（要寫 DB→Bundle 的反向組裝）。

---

## 四、推薦落地步驟（基於策略 C）

每一步都可獨立驗收、可 rollback，建議分成 5 個 PR：

### PR-1：引入標準碼查表（不動流程）

**目標**：先把對照表搬進來，確認資料格式可用，不改任何現有行為。

- 新增 `backend/app/fhir/code_maps/` 目錄
  - `atc_drugs.csv`（從 `FHIR功能/藥物標準化/` 複製）
  - `loinc_labs.csv`（從 `FHIR功能/lab轉FHIR/` 複製）
  - `auto_rxnorm_cache.json`（空檔或複製）
- 新增 `backend/app/fhir/code_maps.py`：`atc_map()` / `loinc_map_his()` 讀取 CSV（仿 `FHIR功能/共用與流程/code_maps_init.py`）
- 新增 `backend/tests/fhir/test_code_maps.py`：驗證 CSV 載入、重要 ODR_CODE / LAB_CODE 查得到

**驗收**：pytest 通過、production 行為無變化。

### PR-2：RxNorm 自動補碼模組（離線 cache 模式）

**目標**：把 `FHIR功能/藥物標準化/rxnorm.py` 搬進 `backend/app/fhir/rxnorm.py`，**只開 cache 模式**、**不**在 production 打 RxNav。

- 修 import 路徑：`from .code_maps import CODE_MAPS_DIR`
- 保留 `lookup(generic, online=False)` 介面
- 保留 `save_cache()` CLI 工具
- 新增 `backend/scripts/refresh_rxnorm_cache.py`：本機手動跑，把 cache 補齊後 commit
- 新增 `backend/tests/fhir/test_rxnorm.py`（搬 `FHIR功能/測試/test_rxnorm.py`）

**驗收**：本機跑一次 `refresh_rxnorm_cache.py`，cache 檔有更新；pytest 通過。

**為什麼不直接線上查**：Railway container 冷啟、RxNav 延遲不可控、同步視窗 06:00/18:00 算緊。線上查開關留著但**預設關**，production 永遠 cache-only。

### PR-3：DB schema 加標準碼欄位（核心）

**目標**：讓標準碼落地到既有表，開啟後續的查詢與匯出能力。

- 新 migration `060_add_standard_codes.py`（冪等，`IF NOT EXISTS`）
  - `medications` 加 `atc_code VARCHAR(10)`、`rxnorm_cui VARCHAR(20)`、`coding_source VARCHAR(20)` (`local` / `rxnorm` / `unmapped`)、**建 index** `ix_medications_atc_code`
  - `lab_data` 既有 JSONB 不動，每個 item 多放 `loinc` / `unit_ucum` key（無 schema 變更、只是約定）
- 修 `backend/app/fhir/his_converter.py`：
  - `convert_medications()`：先查 `atc_map(odr_code)`，命中就填 `atc_code` / `rxnorm_cui` / `coding_source='local'`；沒命中再（選擇性）打 cache-only RxNorm，填 `coding_source='rxnorm'`；都沒 → `coding_source='unmapped'`
  - `convert_lab_data()`：查 `loinc_map_his(lab_code)`，在每個 lab item JSONB 加 `loinc` 欄位
- 修 `backend/app/routers/medications.py:162-200` 的 DDI 查詢：
  - **加一條**：若 active 藥都有 `atc_code`，先用 ATC 去 `drug_interactions` 查（比字串比對穩）
  - 舊路（藥名比對）保留做 fallback

**驗收**：
- 本機同步 50045203，檢查 `medications.atc_code` 有填（抽樣 10 筆）、`lab_data` JSONB 裡有 `loinc`
- 跑現有 `patient-medications-tab` 前端頁，資料顯示不變
- DDI interaction 數量 **相同或更多**（不應減少）

### PR-4：Coverage Report（可稽核）

**目標**：每次同步跑完，寫一份覆蓋率報告，便於判斷對照表該不該擴。

- 修 `backend/app/fhir/snapshot_sync.py`：`sync_snapshot_into_session()` 結束後，計算並寫：
  ```json
  {
    "patient_id": "...",
    "timestamp": "...",
    "coverage": {
      "medications": {
        "total": 108,
        "local_mapped": 72,
        "rxnorm_mapped": 14,
        "unmapped": 22,
        "percent": 79.6
      },
      "lab_data": {
        "clinical_total": 52,
        "loinc_mapped": 48,
        "percent": 92.3,
        "unmapped_codes": ["9999X", "8888Y"]
      }
    }
  }
  ```
- 寫到 `backend/.logs/his_sync/coverage_{PAT_NO}_{timestamp}.json`
- 額外寫 aggregate 到 `backend/.logs/his_sync/_aggregate.json`（全病人彙總）

**驗收**：同步後檢查 coverage 檔案存在、數值合理；若 unmapped 高於閾值（e.g. 10%），log 出 WARN。

### PR-5：On-demand FHIR Bundle Export

**目標**：把「匯出 FHIR」能力裝起來，外部對接用。

- 搬 `FHIR功能/lab轉FHIR/observation.py` → `backend/app/fhir/mappers/observation.py`（改 import）
- 搬 `FHIR功能/藥物標準化/medication.py` → `backend/app/fhir/mappers/medication.py`
- 新增 `backend/app/fhir/mappers/patient.py`（精簡版，從 `patients` 表組 FHIR Patient resource）
- 新增 `backend/app/fhir/bundle_builder.py`：
  - `build_bundle_from_db(patient_id, db) -> (bundle_dict, report_dict)` — **讀 DB 組 FHIR Bundle**，不再讀 JSON snapshot
- 新 endpoint：
  ```
  GET /patients/{patient_id}/fhir-bundle
    → { success, data: { bundle, report } }
  ```
  - 權限：doctor / pharmacist / admin
  - 寫 audit log（action="匯出 FHIR Bundle"）
- 搬測試 `FHIR功能/測試/test_mappers.py` → `backend/tests/fhir/test_mappers.py`（改寫成吃 DB ORM）

**驗收**：`curl /patients/50045203/fhir-bundle` 回傳合法 FHIR R5 Bundle，`coverage.clinical_lab_percent >= 80`。

---

## 五、整合後的資料流

```
[本機 Mac]
  patient/*/{ts}/getAllMedicine.json / getLabResult.json / ...
        │
        │  launchd 06:00 / 18:00
        ▼
  sync_his_snapshots.py
        │
        ▼
  his_converter.HISConverter
    ├─ convert_patient()
    ├─ convert_medications()              ← PR-3 改
    │    for each row:
    │      ├─ atc_map(ODR_CODE)           ← 新：查 atc_drugs.csv
    │      ├─ miss → rxnorm.lookup()      ← 新：cache-only
    │      └─ 填 atc_code / rxnorm_cui / coding_source
    ├─ convert_lab_data()                 ← PR-3 改
    │    for each row:
    │      └─ loinc_map_his(LAB_CODE)     ← 新：LAB_CODE 直查 LOINC
    └─ ...
        │
        ▼
  snapshot_sync.reconcile_medications()
        │
        ▼
  [Supabase PostgreSQL]
    medications: ..., atc_code, rxnorm_cui, coding_source    ← PR-3 新欄
    lab_data: JSONB 裡每 item 多 loinc/unit_ucum             ← PR-3 新欄
        │
        ├─────────────────┬──────────────────────────────┐
        ▼                 ▼                              ▼
  [既有流程，不動]    [PR-4 新]                      [PR-5 新]
  GET /patients/     backend/.logs/                GET /patients/
    {id}/medications   his_sync/                     {id}/fhir-bundle
  (DDI 查詢改用       coverage_*.json                → Bundle + report
   ATC 優先)                                          (on-demand，不落盤)
        │
        ▼
  前端 SPA (chat-icu.vercel.app)
    <PatientMedicationsTab> 顯示不變，或選擇性秀 ATC code
```

---

## 六、風險與取捨

| 風險 | 影響 | 緩解 |
|---|---|---|
| `atc_drugs.csv` 只涵蓋 ICU 常用，許多 HIS ODR_CODE 命中率低 | 一開始 `coding_source='unmapped'` 比例高 | PR-4 的 coverage report + unmapped list 當 backlog 人工補；RxNorm fallback 補一部分 |
| RxNav API 偶發不通 | 若開線上模式，同步可能慢 | production 預設 offline（cache-only），cache 由本機手動 refresh + commit |
| 同步步驟多了兩次查表 | 同步時間增加 | `atc_map()`/`loinc_map_his()` 用 `@lru_cache` 模組級載入一次就夠；查詢是 dict lookup，O(1) |
| DDI 改用 ATC 比對後，命中變多（可能出現既有邏輯沒處理的 edge case） | 誤報、警示太多 | PR-3 時 DDI 改成「ATC 優先、找不到 fallback 藥名比對」，雙路並存一陣子，觀察後再切純 ATC |
| FHIR mapper 的 import 路徑衝突 | PR-5 copy-paste 後 breaking | 先驗 `backend/tests/fhir/*` 全綠再 merge |
| 既有 `backend/app/fhir/` 已有同名檔案（`converters.py` / `loinc_map.py`） | 語意重疊、開發者混淆 | PR-1 就把新檔放到 `backend/app/fhir/code_maps/` 子目錄；`loinc_map_his()` 與既有 `loinc_map.LOINC_MAP` 區分命名 |

---

## 七、與既有 CLAUDE.md 規則的相容性

- **`backend/CLAUDE.md` Scope Restriction**：整個計畫只改 `backend/` 與 `docs/`，不碰 `src/` 前端；前端若要顯示 ATC code 另開 frontend-tasks。
- **Migration 冪等**：PR-3 的 060 migration 全部用 `ADD COLUMN IF NOT EXISTS`。
- **Seed data `created_by_id`**：本計畫不涉及 seed user，無 FK 風險。
- **pre-commit 禁止直接 commit main**：每個 PR 按 `fix/fhir-standardization-pr{N}` 開 branch，merge `--no-edit`。
- **部署驗證**：
  - PR-3 合入後，`curl /health` → 200、隨機抓 `/patients/50045203/medications` 看 `atc_code` 有值、Vercel bundle hash 不變（前端無改動）

---

## 八、後續（本計畫範圍外，但該想）

1. **前端展示 ATC/LOINC**（需 frontend-tasks.md 協調）：用藥詳情 modal 多一行 `ATC: C09AA03 (lisinopril)`。
2. **ATC 類別分析**：藥師工作站加「病人目前用的 ATC 分類分布」。
3. **匯出 FHIR 給外部**：PR-5 的 endpoint 做權限強化（API token、rate limit）才對外開。
4. **`route` / `frequency` 也標準化**：目前仍是 HIS local code（`PO`/`IV`/`BID`），可後續對到 SNOMED CT 或 FHIR ValueSet。
5. **把 `his_ddi_alias_map.json` 與 `atc_drugs.csv` 合一**：兩邊都是 `ODR_CODE → 藥名`，同源、易分裂，長期應收斂到 `atc_drugs.csv`，alias 從那裡 derive。

---

## 九、驗收總表

| PR | 可驗收的事實 | 指令 |
|---|---|---|
| PR-1 | CSV 載得到、key 查得到 | `cd backend && python3 -m pytest tests/fhir/test_code_maps.py -v` |
| PR-2 | cache 模式 lookup 可回命、miss 會被記錄 | `cd backend && python3 scripts/refresh_rxnorm_cache.py --dry-run` |
| PR-3 | `medications.atc_code` 有值；lab JSONB 有 `loinc` | 本機 sync 一位病人後 `psql -c "SELECT coding_source, count(*) FROM medications GROUP BY 1"` |
| PR-4 | coverage json 檔存在、數值合理 | `ls backend/.logs/his_sync/coverage_*.json` |
| PR-5 | 回傳合法 FHIR Bundle | `curl -s .../patients/50045203/fhir-bundle \| jq '.data.bundle.resourceType'` → `"Bundle"` |

---

## 十、若只想先試跑最小可行（MVP）

只做 PR-1 + PR-3 核心（ATC 對照 + DDI 用 ATC fallback），其他 PR 延後。

預估工時（開發 + 測試 + 部署驗證）：**4-6 小時**。

回報重點：
- 本機同步 13 位 HIS 病人，`coding_source='local'` 比例多少？
- DDI 改用 ATC 後，交互作用命中數量相較舊版增加幾筆？
- 有沒有誤報（人工 sanity check 前 10 筆）？

若 MVP 成果好，再做 PR-2（自動補碼）與 PR-4/5（coverage + Bundle export）。
