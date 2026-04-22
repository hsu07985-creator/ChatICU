# ChatICU 藥物資料庫與資料處理流程完整參考

日期：2026-04-23
狀態：PR-0 ~ PR-5 全部部署到 Railway production（alembic 061）
涵蓋範圍：藥物、檢驗、DDI、FHIR 匯出的完整 HIS → 前端資料流

---

## 目錄

1. [30 秒摘要](#30-秒摘要)
2. [整體資料流圖](#整體資料流圖)
3. [資料來源：HIS JSON 結構](#資料來源his-json-結構)
4. [資料庫表結構（藥物相關）](#資料庫表結構藥物相關)
5. [對照表與參考檔案](#對照表與參考檔案)
6. [處理管線逐階段詳解](#處理管線逐階段詳解)
7. [藥物標準化的查表鏈](#藥物標準化的查表鏈)
8. [DDI 交互作用雙路匹配](#ddi-交互作用雙路匹配)
9. [覆蓋率與命中率指標](#覆蓋率與命中率指標)
10. [FHIR Bundle 匯出](#fhir-bundle-匯出)
11. [維運腳本清單](#維運腳本清單)
12. [前端接了什麼、沒接什麼](#前端接了什麼沒接什麼)
13. [如何擴充 / 驗證 / 診斷](#如何擴充--驗證--診斷)
14. [已知問題與 TODO](#已知問題與-todo)

---

## 30 秒摘要

ChatICU 的藥物資料流：**HIS JSON → launchd 每天 06:00/18:00 自動同步 → 用五本對照表翻譯 + 貼 ATC 國際代碼 → 存進 Supabase → 前端叫 API 看用藥 + DDI 警示**。

核心數字（production 現況）：

| 指標 | 值 |
|------|---:|
| medications 總筆數 | ~2,600 |
| 有 ATC 代碼的 | 84.6% |
| 抗生素自動標記 | 261 筆 |
| drug_interactions 有雙邊 ATC | 758 / 8,786 |
| Q4 DDI 實際命中 | 15 hits / 5 patients（從 0 升上來）|
| 院區形成品覆蓋本院 HIS 藥 | 97.1% |

---

## 整體資料流圖

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│ ① HIS 原始 JSON（本機）                                            │
│    /patient/{MRN}/{YYYYMMDD_HHMMSS}/                              │
│    getAllMedicine.json / getLabResult.json / getPatient.json ...  │
│                                │                                   │
│                                ▼                                   │
│ ② launchd 排程 06:00 & 18:00                                      │
│    ~/Library/LaunchAgents/com.chaticu.his-sync.plist              │
│                                │                                   │
│                                ▼                                   │
│ ③ 增量偵測（per-patient SHA-256 hash）                            │
│    backend/scripts/sync_his_snapshots.py                          │
│    backend/app/fhir/snapshot_resolver.py                          │
│    backend/.state/his_snapshot_sync_state.json                    │
│                                │                                   │
│                                ▼                                   │
│ ④ 轉換層（HISConverter）★ 標準化在這裡發生                       │
│    backend/app/fhir/his_converter.py                              │
│                                                                    │
│    載入 5 本對照表（模組層常駐）：                                 │
│      _FORMULARY_MAP         ← drug_formulary.csv (1,670)          │
│      rxnorm cache           ← auto_rxnorm_cache.json (21)         │
│      _DDI_ALIAS_MAP         ← his_ddi_alias_map.json (65)         │
│      _DDI_EXCLUSION_SET     ← his_ddi_exclusion_list.json (19)    │
│      HIS_LAB_MAP            ← his_lab_mapping.py (394)            │
│                                │                                   │
│                                ▼                                   │
│ ⑤ Supabase UPSERT + 覆蓋率報告                                    │
│    backend/app/fhir/snapshot_sync.py                              │
│    reconcile_medications() / replace_patient_records()            │
│    write_coverage_report() → backend/.logs/his_sync/              │
│                                │                                   │
│                                ▼                                   │
│ ⑥ Supabase PostgreSQL (ap-southeast-2, :6543 tx mode)             │
│    medications / drug_interactions / lab_data / patients ...       │
│                                │                                   │
│                                ▼                                   │
│ ⑦ Railway FastAPI                                                 │
│    /patients/{pid}/medications        分組 + 雙路 DDI 查詢        │
│    /patients/{pid}/fhir-bundle  (PR-5) FHIR R5 Bundle 匯出        │
│                                │                                   │
│                                ▼                                   │
│ ⑧ Vercel Proxy（chat-icu.vercel.app）                             │
│    轉發 /api/* 到 Railway，加 X-Request-ID                        │
│                                │                                   │
│                                ▼                                   │
│ ⑨ 前端 SPA                                                        │
│    src/lib/api/medications.ts                                     │
│    src/components/patient/patient-medications-tab.tsx             │
│    顯示：Sedation/Analgesia/NMB/其他/門診藥 + DDI badge            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 資料來源：HIS JSON 結構

每位病人的 snapshot 目錄：

```
/patient/{MRN}/
├── latest.txt                   # 指向最新 snapshot 時戳
└── 20260417_170842/             # 時戳目錄
    ├── getPatient.json          # 基本資料、年齡、性別、診斷
    ├── getAllMedicine.json      # 所有藥（住院+門診混合，由 OPD_SW 區分）
    ├── getLabResult.json        # 檢驗結果
    ├── getAllOrder.json         # 所有醫囑（含非藥品）
    ├── getIpd.json              # 住院紀錄（診斷、手術）
    ├── getOpd.json              # 門診紀錄
    ├── getCulture.json          # 細菌培養
    ├── getAIResult.json         # AI 判讀（ECG 等）
    └── ExtraFactories/          # 額外分院資料
```

### getAllMedicine.Data[] 關鍵欄位

| 欄位 | 範例 | 用途 |
|------|------|------|
| ODR_CODE | `IMORP1` | 本院藥品代碼（↔ formulary 主鍵）|
| ODR_NAME | `Morphine 10mg/ml inj` | 藥品顯示名 |
| ODR_SEQ, PAT_SEQ | `1, 5` | 用來組合成 medication id |
| DOSE, DOSE_UNIT | `5, mg` | 劑量 |
| FREQ_CODE | `Q4HPRN`, `BID` | 頻次（轉 `_FREQ_MAP`）|
| ROUTE_CODE | `IV`, `PO` | 給藥途徑 |
| START_DATE, END_DATE | `1150415`（民國）| 轉西元 |
| DC_FLAG | `Y` / blank | 停藥旗標 |
| OPD_SW | `I` / `O` | 住院 / 門診 |
| USER_NAME, HDEPT_NAME | 醫師、科別 | 開立資訊 |

### getLabResult.Data[] 關鍵欄位

| 欄位 | 範例 | 用途 |
|------|------|------|
| LAB_CODE | `9015E` | 本院檢驗代碼（↔ HIS_LAB_MAP）|
| LAB_NAME | `Creatinine` | 檢驗名稱 |
| RESULT | `1.2` / `Negative` | 結果值 |
| UNIT | `mg/dL` | 單位 |
| REPORT_DATE, REPORT_TIME | `1150415, 0830` | 檢驗時間 |
| HIGH_LIMIT, LOW_LIMIT | `1.2, 0.6` | 參考範圍 |
| RES_SW | `H` / `L` | 異常高低標記 |

---

## 資料庫表結構（藥物相關）

### 1. `medications`（核心表，UPSERT 寫入）

定義：`backend/app/models/medication.py`
Migration：`055_his_import_schema.py` ~ `060_add_atc_codes_to_medications.py`

| 欄位 | 類型 | 說明 | 來源 |
|------|------|------|------|
| `id` | VARCHAR(50) PK | `med_{md5(MRN|ODR_SEQ|ODR_CODE)[:8]}` | 確定性算出 |
| `patient_id` | FK → patients | | getPatient |
| `name` | VARCHAR(200) | 清理過的藥品名 | ODR_NAME |
| `generic_name` | VARCHAR(200) | 被 DDI alias 覆蓋過的 generic | alias map 或自動提取 |
| `order_code` | VARCHAR(50) | ODR_CODE | HIS |
| `category` | VARCHAR(50) | sedative/analgesic/antibiotic/... | _classify_category() |
| `san_category` | VARCHAR(5) | S/A/N（鎮靜/止痛/NMB）| _classify_san() |
| `dose, unit, frequency, route, prn` | | | HIS 正規化 |
| `start_date, end_date` | DATE | 轉西元 | _roc_to_date() |
| `status` | VARCHAR(20) | active/discontinued/... | DC_FLAG + END_DATE 判定 |
| `source_type` | VARCHAR(20) | inpatient/outpatient/self-supplied | OPD_SW |
| `prescribing_*` | | 科別、醫師 | HIS |
| **`atc_code`** | VARCHAR(10) | **WHO ATC 代碼** | 🆕 PR-1 從 formulary |
| **`is_antibiotic`** | BOOLEAN | **抗生素標記** | 🆕 PR-1 從 ABX list |
| **`kidney_relevant`** | BOOLEAN | **腎臟相關** | 🆕 PR-1 從 legacy CSV |
| **`coding_source`** | VARCHAR(20) | **ATC 來源標註** | 🆕 PR-1 |
| `prescribed_by`, `warnings` | JSONB | | |

`coding_source` 可能的值：

- `formulary`：在院區常備藥品明細表
- `formulary+abx`：同時在形成品與抗生素清單
- `abx_only`：只在抗生素清單（無 ATC）
- `legacy_only`：只在舊 `atc_drugs.csv`（多為 CKD 相關）
- `manual`：人工補碼（`drug_formulary_gaps.csv`）
- `rxnorm_cache`：RxNav 自動補碼
- `unmapped`：所有來源都沒找到

### 2. `medication_administrations`（給藥紀錄）

- 關聯 `medications`
- 有給藥紀錄的 medications 被標 `discontinued` 時**不會被刪**（保留稽核軌跡）

### 3. `drug_interactions`（DDI 查詢表）

定義：`backend/app/models/drug_interaction.py`
Migration：`001_initial`, `027_drug_interaction_enrichment`, `028_full_interaction_schema`, `061_add_atc_to_drug_interactions`

| 欄位 | 類型 | 說明 |
|------|------|------|
| `id` | VARCHAR(50) PK | `ddi_{sha1(dedup_key)[:12]}` |
| `drug1, drug2` | VARCHAR(200) | 乾淨藥名（Lexicomp style）|
| **`drug1_atc, drug2_atc`** | VARCHAR(10) | 🆕 PR-3.5 backfilled |
| `severity` | VARCHAR(20) | minor/moderate/major |
| `risk_rating` | VARCHAR(2) | A/B/C/D/X |
| `mechanism, clinical_effect, management` | TEXT | 人類可讀說明 |
| `references, footnotes, discussion` | TEXT | |
| `dependencies, pubmed_ids` | JSONB | |
| `dedup_key` | VARCHAR(300) UNIQUE | `drug1|drug2`（排序） |

- Seed 來源：`backend/seeds/ddi_xd_only.json.gz`（主要）、`icu_drug_interactions.json`（fallback）
- Seed 邏輯：`backend/app/startup_migrations.py:_seed_drug_interactions`
- 數量：8,786 unique 藥對、2,169 unique 藥名
- `trgm` index：`ix_drug_interactions_drug1_trgm`, `ix_drug_interactions_drug2_trgm`（模糊查詢用）

### 4. `iv_compatibilities`（靜脈相容性）

- Seed 來源：`backend/seeds/icu_y_site_compatibility_v2_lookup.json`
- 用途：藥師工作站查 Y-site 相容性

### 5. `pharmacy_advice`, `pharmacy_compatibility_favorite`

- 藥師人工產出的建議與收藏

---

## 對照表與參考檔案

### 主要對照表（全部在 `backend/app/fhir/`）

#### `code_maps/drug_formulary.csv`（1,670 行）【PR-0 產出、主幹】

權威 ODR_CODE → ATC 對應表，由 `build_formulary_csv.py` 從三個來源合併：

```
陽明院區常備藥品明細表1150401.xlsx  (1,568 筆，ATC 99.9%)  ← 主要
陽明抗生素清單 20260303.xlsx        (122 筆，is_antibiotic 標記)
FHIR功能/藥物標準化/atc_drugs.csv   (141 筆，kidney_relevant 參考)
drug_formulary_gaps.csv             (19 筆，人工補 gap)
```

欄位：

```
odr_code, atc_code, ingredient, brand_name, unit,
is_antibiotic, kidney_relevant, rxnorm_cui, source, notes
```

#### `code_maps/drug_formulary_gaps.csv`（19 行）【人工維護】

專門給主形成品沒涵蓋的 ODR_CODE 補 ATC：

```
odr_code,db_row_count,sample_name,suggested_atc,notes
IMARC3,5,Marcaine SPINAL0.5% 4ml(Bupivacaine),N01BB01,Local anaesthetic
IROCU1,3,Rocuronium Kabi 10mg/ml 5ml inj,M03AC09,NMB - non-depolarising
...
```

**維護流程**：有新 ODR_CODE 出現在 DB 但不在 formulary → 執行 `build_formulary_csv.py` 會自動加進 gaps.csv → 人工填 `suggested_atc` → 重跑 `build_formulary_csv.py` 合進主 CSV。

#### `code_maps/auto_rxnorm_cache.json`（21 筆）【PR-2 自動補碼】

從 RxNav 查到的 generic → ATC：

```json
{
  "tigecycline": {
    "atc_code": "J01AA",
    "atc_display": "Tetracyclines",
    "generic": "Tigecycline",
    "rxcui": "384455",
    "resolved_at": "2026-04-22T16:38:47Z"
  },
  ...
}
```

**更新方式**：`python3 backend/scripts/refresh_rxnorm_cache.py`（連網，開發者本機跑，commit 進 git）。

#### `his_ddi_alias_map.json`（65 筆）【既有】

ODR_CODE → DDI DB 的乾淨藥名：

```json
{
  "IMORP1": ["Morphine"],
  "IAMIN9": ["Aminoglycosides"],
  "IZAVI1": ["Ceftazidime", "Avibactam"],
  ...
}
```

在 converter 中**覆蓋 `generic_name`** 讓 DDI 字串比對能命中。

#### `his_ddi_exclusion_list.json`（19 筆）【既有】

非藥物 ODR_CODE（點滴、軟便劑），在 converter 中將 `generic_name` 設 None 跳過 DDI。

#### `his_lab_mapping.py`（`HIS_LAB_MAP` 394 筆）【既有】

```python
HIS_LAB_MAP: Dict[str, Tuple[str, str, str]] = {
    "9015E":  ("biochemistry", "Scr", "Creatinine"),
    "9021":   ("biochemistry", "Na",  "Na"),
    ...
}
```

converter 用來決定每筆 lab 要寫到 `lab_data` 的哪個 JSONB 欄位與哪個 key。

#### `loinc_map.py`（`LOINC_MAP`）【既有】

```python
LOINC_MAP: Dict[str, Tuple[str, str, str]] = {
    "Scr": ("2160-0", "Creatinine [Mass/volume] in Serum", "biochemistry"),
    "K":   ("2823-3", "Potassium [Moles/volume] in Serum", "biochemistry"),
    ...
}
```

ChatICU 內部 key → LOINC。**僅 bundle_builder 用**，不入 DB。

### 外部檔案（repo 根目錄）

```
陽明院區常備藥品明細表1150401.xlsx   ← 形成品源頭，季度更新
陽明抗生素清單 20260303.xlsx         ← 抗生素源頭
FHIR功能/藥物標準化/atc_drugs.csv   ← legacy CKD 相關
```

---

## 處理管線逐階段詳解

### 階段 1：HIS JSON 取得

外部流程（不在本 repo 範疇）。結果是 `/patient/{MRN}/{timestamp}/` 下的 JSON 檔案集合。

### 階段 2：排程觸發

- launchd plist：`~/Library/LaunchAgents/com.chaticu.his-sync.plist`
- 時間：每天 06:00、18:00
- 進入點：`backend/scripts/run_his_snapshot_sync.sh`
- 該 sh 設定 `SYNC_ENV_PATH` 後呼叫 Python
- Log：
  - stdout: `backend/.logs/his-sync.stdout.log`
  - stderr: `backend/.logs/his-sync.stderr.log`

手動觸發：

```bash
unset SYNC_ENV_PATH DATABASE_URL
export SYNC_ENV_PATH=/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/.env.his-sync
bash backend/scripts/run_his_snapshot_sync.sh --force > /tmp/his_sync_run.log 2>&1 &
tail -f /tmp/his_sync_run.log
```

旗標：

| 旗標 | 用途 |
|------|------|
| *(無)* | 只同步 hash 有變的病人（日常）|
| `--force` | 全部重跑，忽略 hash |
| `-p <MRN>` | 只同步單一病歷號 |
| `--dry-run` | 預覽，不寫 DB |
| `--concurrency 4` | 並行數（預設 2）|

### 階段 3：增量偵測

```
backend/scripts/sync_his_snapshots.py
├─ load_sync_state()  讀 .state/his_snapshot_sync_state.json
├─ discover_patient_roots()  掃 /patient/* 找病人目錄
└─ for each patient:
     resolve_patient_snapshot()  找最新 snapshot 目錄
     算 normalized SHA-256 hash（排除 volatile key 如 DateTime）
     if hash 和 state 相同: action='unchanged' → skip
     if hash 變了:         action='changed'   → 進 sync
     if --force:           action='forced'    → 強制同步
```

### 階段 4：轉換層（標準化發生處）★

位於 `backend/app/fhir/his_converter.py`。

#### 模組層 load-once（在 import 時跑一次）

```python
_SITE_CONFIG        = _load_site_config()       # 站點配置
_DDI_ALIAS_MAP      = _load_ddi_alias_map()     # 65 筆
_DDI_EXCLUSION_SET  = _load_ddi_exclusion_set() # 19 筆
_FORMULARY_MAP      = _load_formulary()         # 🆕 PR-1: 1,622 筆有 ATC
```

#### `HISConverter.convert_medications()` 的完整流程（每筆藥）

```
for each row in getAllMedicine.Data:
    1. raw_name = m["ODR_NAME"]
    2. clean_name, generic = _clean_drug_name(raw_name)
    3. odr_code = m["ODR_CODE"]

    # 覆蓋 generic_name（為了 DDI 字串比對）
    4. if odr_code in _DDI_ALIAS_MAP:
           generic = " / ".join(_DDI_ALIAS_MAP[odr_code])
       elif odr_code in _DDI_EXCLUSION_SET:
           generic = None

    # 正規化
    5. freq_code  = _FREQ_MAP.get(...)
    6. route_code = _ROUTE_MAP.get(...)
    7. is_prn = "PRN" in freq_code
    8. source_type = _OPD_SW_MAP[opd_sw]  # I/O → inpatient/outpatient

    # status 判定
    9. if DC_FLAG == "Y": status = "discontinued"
       elif source_type == "outpatient":
           if START_DATE + DAYS < today: status = "discontinued"
       else:
           if END_DATE < today: status = "discontinued"

    # ★ 關鍵：標準碼 enrichment（PR-1 + PR-2）
    10. formulary_entry = _FORMULARY_MAP.get(odr_code)
        if formulary_entry:
            atc_code        = formulary_entry["atc_code"]
            is_antibiotic   = formulary_entry["is_antibiotic"]
            kidney_relevant = formulary_entry["kidney_relevant"]
            coding_source   = formulary_entry["source"]
        else:
            # PR-2 fallback：沒 formulary → 嘗試 RxNorm cache
            generic_candidate = extract_generic_name(raw_name)
            hit = rxnorm.lookup(generic_candidate, online=False)
            if hit:
                atc_code = hit.atc_code
                coding_source = "rxnorm_cache"
            else:
                atc_code = None
                coding_source = "unmapped"

    # SAN / category 分類
    11. san_category = _classify_san(raw_name)        # S/A/N
    12. category     = _classify_category(raw_name)

    # 生成確定性 id
    13. med_id = f"med_{md5(MRN|ODR_SEQ|PAT_SEQ|ODR_CODE)[:8]}"

    # 產出 dict（欄位對應 medications 表 schema）
    14. medications.append({
        "id": med_id, "patient_id": ..., "name": clean_name,
        "generic_name": generic, "atc_code": atc_code,
        "is_antibiotic": is_antibiotic, ...
    })
```

#### `HISConverter.convert_lab_data()` 流程

```
for each row in getLabResult.Data:
    lab_code = row["LAB_CODE"]
    mapping = HIS_LAB_MAP.get(lab_code)
    if mapping:
        category, key, name = mapping
        # 寫進對應 JSONB 欄位
        lab_data[category][key] = row["RESULT"]
```

### 階段 5：DB UPSERT + Coverage Report

位於 `backend/app/fhir/snapshot_sync.py`。

#### `sync_snapshot_into_session()`

```
1. converter.convert_all()  → 產生 patient/medications/lab/culture/reports dicts
2. fetch_existing_patient()  → 讀取 DB 既有資料
3. merge_patient_payload()   → HIS-owned 欄位覆蓋、preserved 欄位保留
4. upsert_patient()
5. 三個表走 DELETE + INSERT（整批換）：
   - lab_data
   - culture_results
   - diagnostic_reports
6. reconcile_medications()  → UPSERT
   - 有 administrations FK 的 stale 藥 → 標 discontinued
   - 無 administrations 的 stale 藥 → DELETE
7. 🆕 PR-4: compute_medication_coverage() + write_coverage_report()
   → backend/.logs/his_sync/coverage_{MRN}_{snapshot_id}.json
```

Coverage report 內容：

```json
{
  "mrn": "35876842",
  "patient_id": "pat_a86cb503",
  "snapshot_id": "20260417_170842",
  "total": 313,
  "with_atc": 313,
  "coverage_pct": 100.0,
  "by_source": {
    "formulary": 229,
    "formulary+abx": 39,
    "legacy_only": 23,
    "rxnorm_cache": 15,
    "manual": 6,
    "abx_only": 1
  },
  "unmapped_top": []
}
```

### 階段 6：Supabase 儲存

- 位置：`ap-southeast-2`（AWS Sydney）
- 連線：pooler.supabase.com:6543（transaction mode）
- 連線設定（必須）：
  - `prepared_statement_cache_size=0`
  - `statement_cache_size=0`
  - `command_timeout=120`
- 遷移：啟動時自動 `alembic upgrade head`（`backend/Procfile`）
- 現況：alembic 061（= 含 PR-1 和 PR-3.5 的 migration）

### 階段 7：Railway FastAPI Query 層

#### `GET /patients/{patient_id}/medications`

位於 `backend/app/routers/medications.py:103`。

```
1. 驗權限（get_current_user + verify_patient_access）
2. 查 medications WHERE patient_id AND (optional) status
3. 動態偵測 self-supplied：
   門診藥 AND route=PO AND order_code 有住院藥 → source_type = "self-supplied"
4. 依 SAN × source_type 分組：
   grouped = { sedation, analgesia, nmb, other, outpatient }
5. DDI 查詢（雙路，詳見下一節）
6. 回傳 { medications, grouped, interactions }
```

#### `GET /patients/{patient_id}/fhir-bundle`（PR-5）

位於 `backend/app/routers/fhir_export.py`。

- 權限：doctor / np / pharmacist / admin
- 呼叫 `bundle_builder.build_bundle_for_patient()`
- 回傳 FHIR R5 Bundle（type=collection）
- Audit log：`匯出 FHIR Bundle`

### 階段 8：Vercel Proxy

- `vercel.json` 強制 `buildCommand` 包含 `VITE_API_URL=""`
- 前端發 `/api/*` → Vercel edge function → Railway backend
- 加 `X-Request-ID` header（沒加會被 Vercel rewrite 當 SPA 路由）
- 轉發 cookies（auth session 維持）

### 階段 9：前端渲染

```
src/lib/api/medications.ts
  getMedications(patientId)  → GET /patients/{id}/medications

src/hooks/use-patient-bundle.ts:157
  medicationsApi.getMedications(id, { status: 'all' })
    並行和其他 fetch（labs/vitals/etc）一起打

src/pages/patient-detail.tsx:2008
  <PatientMedicationsTab
    medications={bundle.medications}
    grouped={bundle.medicationsGrouped}
    interactions={bundle.drugInteractions}
    ...
  />

src/components/patient/patient-medications-tab.tsx
  - Tab 切換：Sedation / Analgesia / NMB / 其他 / 門診
  - 每筆藥 card 顯示 name / dose / frequency / route / status
  - <DrugInteractionBadges> 顯示 DDI 警示
```

---

## 藥物標準化的查表鏈

每筆藥進 converter 後，依序查這 5 張表（優先順序由上到下）：

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║  原始藥品 (ODR_CODE + ODR_NAME)                              ║
║                                                              ║
║    │                                                          ║
║    ▼                                                          ║
║                                                              ║
║  ┌──── 步驟 A：DDI alias 覆蓋 generic_name ────┐              ║
║  │  his_ddi_alias_map.json (65)                │              ║
║  │  IMORP1 → "Morphine"                        │              ║
║  └─────────────────────────────────────────────┘              ║
║    │                                                          ║
║    ▼                                                          ║
║                                                              ║
║  ┌──── 步驟 B：DDI exclusion 跳過 ────────────┐              ║
║  │  his_ddi_exclusion_list.json (19)           │              ║
║  │  ITAIT5 (TAITA IV fluid) → generic=None     │              ║
║  └─────────────────────────────────────────────┘              ║
║    │                                                          ║
║    ▼                                                          ║
║                                                              ║
║  ┌──── 步驟 C：主形成品查 ATC ────────────────┐              ║
║  │  drug_formulary.csv (1,670)                 │              ║
║  │  IMORP1 → ATC=N02AA01, is_abx=false        │              ║
║  │          source="formulary"                 │              ║
║  └─────────────────────────────────────────────┘              ║
║    │                                                          ║
║    ├─ 命中 → coding_source=formulary/formulary+abx/manual     ║
║    │                                                          ║
║    ▼ (沒命中)                                                 ║
║                                                              ║
║  ┌──── 步驟 D：RxNorm cache fallback ─────────┐              ║
║  │  auto_rxnorm_cache.json (21)                │              ║
║  │  從 ODR_NAME 抽 generic → 查 cache          │              ║
║  │  "(Tigecycline)" → ATC=J01AA                │              ║
║  └─────────────────────────────────────────────┘              ║
║    │                                                          ║
║    ├─ 命中 → coding_source=rxnorm_cache                      ║
║    │                                                          ║
║    ▼ (沒命中)                                                 ║
║                                                              ║
║  atc_code=None, coding_source="unmapped"                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### 三個查表層各自的維護人

| 層 | 檔案 | 誰維護 | 多久更新 |
|----|------|--------|---------|
| A | `his_ddi_alias_map.json` | 開發者人工 | 有新藥時 |
| B | `his_ddi_exclusion_list.json` | 開發者人工 | 有新點滴/非藥時 |
| C | `drug_formulary.csv` | `build_formulary_csv.py` 自動 | 院區 xlsx 更新時（季度）|
| C-gap | `drug_formulary_gaps.csv` | 開發者人工 | 有新藥 DB 出現時 |
| D | `auto_rxnorm_cache.json` | `refresh_rxnorm_cache.py` 自動（連網）| 有新藥時 |

---

## DDI 交互作用雙路匹配

PR-3.5 之前 Q4 命中率 = 0（因為藥名字串比對在本院資料上幾乎不重合）。PR-3.5 加 ATC 欄 + 雙路 query 後：

```
     病人的 active 藥
       ┌─────────┴─────────┐
       │                   │
       ▼                   ▼

  藥名集合              ATC 集合
  (generic_name          (atc_code from
   拆組合藥後)             medications)
       │                   │
       ▼                   ▼

  Path 1               Path 2 ★
  字串比對             ATC 比對
                       (PR-3.5)
       │                   │
       ▼                   ▼

  drug1 = ANY(names)   drug1_atc = ANY(atcs)
  AND                  AND
  drug2 = ANY(names)   drug2_atc = ANY(atcs)
       │                   │
       └─────────┬─────────┘
                 │
                 ▼

         Union by row id
         （去重）
                 │
                 ▼

         interactions 陣列
         （回傳給前端）
```

位於 `backend/app/routers/medications.py:160-220`。

**為什麼要保留 Path 1**：DDI 表裡有**類別節點**（`Aminoglycosides`、`Cephalosporins`、`Loop Diuretics` 等），這些沒有 ATC 代碼但藥名字串會命中。Path 1 抓這類規則。

### 實測數字

```
DDI 表 8,786 列
├── 758 列兩邊都有 ATC（PR-3.5 backfill 後）
└── 4,362 列至少一邊有 ATC

在 12 位病人中：
  5 位病人有 DDI 命中（透過 ATC path）
  總計 15 個 DDI hits
```

---

## 覆蓋率與命中率指標

稽核腳本：`backend/scripts/fhir_baseline_audit.py`
報告輸出：`docs/fhir-baseline-report.md`

### 核心指標

| 指標 | 數字 |
|------|------|
| `drug_formulary.csv` 總 codes | 1,670 |
| 有 ATC 的 codes | 1,622 (97%) |
| 本院 DB 有的 ODR_CODE | 223 unique |
| DB codes 對到 formulary | 193 (86.5%) |
| DB rows 列權重命中 | 1,373 (94.1%) |
| 不覆蓋的列數 | 42 / 1,459 (2.9%) |

### 實際產出（來自 sync 後的 DB）

```
medications 表 coding_source 分布：
  formulary           : 1,700
  None                : 315   ← 尚未 sync 更新的舊資料
  formulary+abx       : 238
  legacy_only         : 194
  unmapped            : 84
  manual              : 43
  abx_only            : 23

Total with ATC: 2,198 / 2,597 = 84.6%
is_antibiotic=TRUE:  261
```

### 覆蓋率分層

```
  97.1% DB rows 被 CSV 對應表覆蓋
    │
    ├─ 94.1% 有 ATC（來自 formulary / manual / legacy）
    │    │
    │    ├─ 80.3% formulary (主)
    │    ├─  8.7% formulary+abx
    │    ├─  4.5% legacy_only（CKD 相關備援）
    │    └─  0.6% manual（人工補 gap）
    │
    ├─ 3% abx_only（抗生素清單但無 ATC）
    │    └─ 可由 refresh_rxnorm_cache.py 補
    │
    └─ 2.9% unmapped（罕見藥、變體碼）
```

---

## FHIR Bundle 匯出

`GET /patients/{patient_id}/fhir-bundle`

實作：`backend/app/fhir/bundle_builder.py`
Router：`backend/app/routers/fhir_export.py`

### 輸出 Bundle 結構

```json
{
  "resourceType": "Bundle",
  "id": "pat_xxx-{timestamp}",
  "type": "collection",
  "timestamp": "2026-04-23T...",
  "meta": {
    "source": "ChatICU DB snapshot for pat_xxx",
    "versionId": "0.1.0"
  },
  "entry": [
    { "fullUrl": "urn:uuid:patient-pat_xxx", "resource": { Patient } },
    { "fullUrl": "urn:uuid:medicationrequest-med_xxx", "resource": { MedicationRequest } },
    ...
    { "fullUrl": "urn:uuid:observation-lab_xxx-Scr", "resource": { Observation } },
    ...
  ]
}
```

### MedicationRequest 攜帶的 coding

每筆藥有三層 coding：

```json
{
  "resourceType": "MedicationRequest",
  "id": "med_a1b2c3d4",
  "status": "active",
  "intent": "order",
  "subject": { "reference": "Patient/pat_xxx" },
  "medicationCodeableConcept": {
    "text": "Morphine 10mg/ml inj",
    "coding": [
      {
        "system": "http://www.whocc.no/atc",
        "code": "N02AA01",
        "display": "Morphine"
      },
      {
        "system": "http://hospital.local/odr-code",
        "code": "IMORP1",
        "display": "Morphine 10mg/ml inj"
      }
    ]
  },
  "dosageInstruction": [{ ... }],
  "extension": [
    { "url": ".../is-antibiotic", "valueBoolean": false },
    { "url": ".../kidney-relevant", "valueBoolean": true },
    { "url": ".../coding-source", "valueString": "formulary" }
  ]
}
```

### Observation 攜帶的 coding

```json
{
  "resourceType": "Observation",
  "id": "lab_xxx-Scr",
  "status": "final",
  "category": [{
    "coding": [{ "system": ".../observation-category", "code": "laboratory" }]
  }],
  "code": {
    "text": "Scr",
    "coding": [
      { "system": "http://loinc.org", "code": "2160-0", "display": "Creatinine" },
      { "system": "http://hospital.local/lab-code", "code": "Scr", "display": "Scr" }
    ]
  },
  "subject": { "reference": "Patient/pat_xxx" },
  "effectiveDateTime": "2026-04-20T08:30:00",
  "valueQuantity": { "value": 1.2, "unit": "" }
}
```

**注意**：`Observation.code.coding` 的 LOINC 是從 `loinc_map.py` 現場查的，**不在 DB 裡**。

---

## 維運腳本清單

### 定期腳本（launchd 觸發）

| 腳本 | 頻率 | 用途 |
|------|------|------|
| `backend/scripts/run_his_snapshot_sync.sh` | 06:00, 18:00 | 包裝 sync_his_snapshots.py |
| `backend/scripts/sync_his_snapshots.py` | 被上面呼叫 | 增量 sync 所有病人 |

### 維護腳本（人工觸發）

| 腳本 | 觸發時機 | 用途 |
|------|---------|------|
| `backend/scripts/build_formulary_csv.py` | 院區 xlsx 更新時 | 重建 drug_formulary.csv |
| `backend/scripts/refresh_rxnorm_cache.py` | 新藥出現時（可能 1-3 個月一次）| 補 RxNorm cache（連網）|
| `backend/scripts/backfill_drug_interactions_atc.py` | formulary 擴充後 | 回填 DDI 的 ATC 欄 |
| `backend/scripts/fhir_baseline_audit.py` | 隨時稽核 | 產 docs/fhir-baseline-report.md |

### 環境變數

```bash
# 必須設（指向 Supabase）
export SYNC_ENV_PATH=/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/.env.his-sync
```

其中 `.env.his-sync` 含：

```
DATABASE_URL=postgresql+asyncpg://postgres.{project}:{pw}@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres
```

**不要用 port 5432**（session mode），用 6543（transaction mode）。

---

## 前端接了什麼、沒接什麼

### 前端有感的

| 功能 | 狀態 | 備註 |
|------|------|------|
| 藥單分組顯示 | ✅ | Sedation/Analgesia/NMB/其他/門診 |
| DDI 警示 badge | ✅ | PR-3.5 後才真的出現（之前 0 命中）|
| 藥品詳情 modal | ✅ | 既有 |
| 藥師開立/更新 | ✅ | 既有 |
| 門診藥匯入 | ✅ | 既有 |

### 前端沒感的（資料有但 UI 沒顯示）

| 功能 | 資料位置 | 要做什麼 |
|------|---------|---------|
| ATC 代碼標籤 | DB `medications.atc_code` | 改 `med_to_dict()` + 前端 |
| 抗生素 icon | DB `medications.is_antibiotic` | 改 `med_to_dict()` + 前端 |
| 腎毒性 icon | DB `medications.kidney_relevant` | 改 `med_to_dict()` + 前端 |
| 來源標籤 | DB `medications.coding_source` | 改 `med_to_dict()` + 前端 |
| FHIR 匯出按鈕 | Endpoint `/fhir-bundle` 已有 | 前端加按鈕 |

### 關鍵檔案（前端）

- `src/lib/api/medications.ts:4` - `Medication` TypeScript interface
- `src/components/patient/patient-medications-tab.tsx` - 用藥頁
- `src/components/patient/drug-interaction-badges.tsx` - DDI badge

### 後端要改的那一行

`backend/app/routers/medications.py:39` `med_to_dict()` 目前**沒回傳** atc_code 等四個欄位。加上去即可。

---

## 如何擴充 / 驗證 / 診斷

### 加一筆新藥到 formulary

1. 如果院區 xlsx 已更新 → `python3 backend/scripts/build_formulary_csv.py` 重建
2. 如果是突然的 HIS 新藥 → 編輯 `drug_formulary_gaps.csv` 填 `suggested_atc` → 重跑上述腳本
3. 驗證：`python3 backend/scripts/fhir_baseline_audit.py` 看 Q1 覆蓋率

### 驗證 DB 標準化狀況

```bash
# 必須先設 env
export SYNC_ENV_PATH=/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/.env.his-sync
```

```sql
-- 總覆蓋率
SELECT coding_source, count(*) FROM medications GROUP BY 1 ORDER BY 2 DESC;

-- 抗生素分類
SELECT atc_code, count(*) FROM medications
WHERE is_antibiotic = true AND status = 'active'
GROUP BY atc_code;

-- 腎毒性藥物病人列表
SELECT patient_id, array_agg(DISTINCT name)
FROM medications
WHERE kidney_relevant = true AND status = 'active'
GROUP BY patient_id;

-- DDI 有雙邊 ATC 的比例
SELECT count(*) FILTER (WHERE drug1_atc IS NOT NULL AND drug2_atc IS NOT NULL) * 1.0
       / count(*) AS pct
FROM drug_interactions;
```

### 驗證 Railway

```bash
# Health
curl https://chaticu-production-8060.up.railway.app/health

# Alembic 版本（應為 061）
# → 透過上述 Python script 連 Supabase 查 alembic_version

# FHIR bundle endpoint（需認證）
curl -b "auth_cookie" https://chaticu-production-8060.up.railway.app/patients/pat_xxx/fhir-bundle
```

### 驗證前端

```
https://chat-icu.vercel.app
1. 登入
2. 進病人 → 用藥 tab
3. 檢查是否有 DDI badge（有 active 藥多的病人才會顯示）
```

### 診斷「為什麼某藥沒 ATC」

```
1. 查 medications 表找 order_code
2. grep 這個 code 在 drug_formulary.csv
3. 沒有 → 看 drug_formulary_gaps.csv 有沒有待填
4. 沒有 → 看 auto_rxnorm_cache.json
5. 都沒有 → 人工補進 gaps.csv 或執行 refresh_rxnorm_cache.py
```

---

## 已知問題與 TODO

### 已知問題

1. **跨 MRN 資料（chart merge）的 HIS fetcher 盲區**
   - HIS lab API 會自動跨病歷號合併（看得到 alt MRN 的 lab）
   - HIS **getAllMedicine / getOpd / getIpd 只回單一 MRN**，alt MRN 的藥/就診抓不到
   - fetcher 只請求主 MRN → alt MRN 的**門診用藥完全不進系統**
   - 審計腳本：`backend/scripts/audit_alt_mrn.py`（目前影響 1/15 病人：50076763 傅壽曉 ↔ 50036229，神經內科就診 + 用藥被漏）
   - 解決方案：
     - 短期：把 alt MRN 獨立 fetch 成另一個 `/patient/{alt_mrn}/` 目錄
     - 長期：fetcher 自動偵測 lab 中出現的 alt MRN 並補抓

2. **`sync_his_snapshots.py` 外層包裝 PgBouncer 怪象**
   - 部分情況下會 `column atc_code does not exist`（錯誤訊息不準）
   - 直接呼叫 `sync_snapshot_into_session` 不會出現
   - launchd 排程開新 pool 通常可過
   - 下次 06:00 執行有錯再處理

2. **`lab_data` 表沒有 LOINC 欄位**
   - LOINC 只在 bundle_builder 即時計算
   - AI / 外部查詢要 LOINC 要再查一次表
   - 若頻繁需要，可考慮 migration 加上 `loinc` key 到 JSONB

3. **Q4 DDI 命中率仍低（15 hits）**
   - 上限受限於 `drug_interactions` 表只有 8.6% 藥對雙邊都有 ATC
   - 很多 DDI 規則是類別節點（如 `Anti-TNF Agents`）沒 ATC
   - 提升需擴 `drug_interactions` 加更多 ICU 藥對，或接外部 DDI API

4. **舊 medications 不會自動升級**
   - 315 筆 `coding_source=NULL` 是 PR-1 之前寫入的
   - 下次該病人 sync 會自動 UPSERT 覆蓋
   - 也可手動 `--force` 全病人重 sync

### TODO（非緊急）

1. **把 ATC 顯示到前端**（前端 session 任務）
   - 改 `med_to_dict()` 回傳
   - 改 `Medication` interface
   - UI 加 ATC badge

2. **lab_data 落 LOINC 到 DB**
   - 新 migration
   - `convert_lab_data()` 改寫 JSONB 多一層 `{value, loinc}`

3. **前端加 FHIR 匯出按鈕**
   - 病人頁右上角「匯出 FHIR Bundle」
   - 下載 JSON 檔

4. **擴 `drug_interactions` 加 ICU 藥對**
   - 參考 Lexicomp / Micromedex
   - 目標把 Q4 提升到 >100 hits

5. **收斂 `his_ddi_alias_map.json` 和 `drug_formulary.csv`**
   - 現在兩表有重疊（交集 39）
   - 長期應 derive alias 從 formulary 的 `ingredient` 欄

---

## 相關文件

- [fhir-standardization-integration-plan.md](./fhir-standardization-integration-plan.md) — PR-1~5 原始計畫（已執行）
- [fhir-baseline-report.md](./fhir-baseline-report.md) — 量化覆蓋率稽核報告（自動產出）
- [backend-cloud-architecture.md](./backend-cloud-architecture.md) — 後端雲端架構全貌

---

## 附錄：六個 PR 完成清單

| PR | Commit | 影響檔案 | DB 遷移 | 驗證 |
|----|--------|---------|--------|------|
| PR-0 | `4559e88` | 6 new files | — | 基線報告產出 |
| PR-1 | `94d22f7` | converter + model + migration 060 | ✅ 060 | 84.6% ATC |
| PR-2 | `847f083` | rxnorm + converter fallback | — | 21 cache entries |
| PR-3.5 | `149c192` + `33c40a8` | migration 061 + router + backfill | ✅ 061 | 4,362 rows, Q4: 0→15 |
| PR-4 | `b7f0b78` | snapshot_sync + coverage writer | — | Coverage JSON 寫入 |
| PR-5 | `b7f0b78` | bundle_builder + fhir_export router | — | Endpoint 回 401（已註冊）|

---

本文件由 PR-0 ~ PR-5 完整實作後撰寫，2026-04-23 。
