# HIS 自動匯入 vs 手動輸入 — 全欄位來源盤點

> 版本：2026-07-21 ｜ 域：his-sync ｜ 對象：後端/前端工程師 + 臨床使用者
> 配對閱讀：[`docs/his-sync/資料更新_0424.md`](../his-sync/資料更新_0424.md)、[`backend/CLAUDE.md`](../../backend/CLAUDE.md)（Data Coverage Summary）

---

## 1. 摘要 / TL;DR

**「哪些欄位是 HIS 說了算、哪些是人填了算」的唯一真相，全部寫在 `backend/app/fhir/snapshot_sync.py` 裡**：三個 frozenset（`HIS_OWNED_FIELDS`、`PRESERVE_EXISTING_FIELDS`、`MIXED_FIELDS`，`snapshot_sync.py:147-201`）決定 **patients 這一張表** 每一欄的合併規則；`REPLACE_TABLES`（`lab_data` / `culture_results` / `diagnostic_reports`）走整表刪除重插；`medications` 走 `reconcile_medications`（upsert + stale 刪除/停用）。HIS sync 是**每小時把 snapshot 覆蓋進 DB 的權威來源**：凡是落在 `HIS_OWNED` / `MIXED` 的欄位，手動改了下一次 sync 一律被蓋回（連空值 `''`/`0`/`None`/`[]` 都蓋）；只有 `PRESERVE_EXISTING` 的空 placeholder 欄位、以及**完全不在 sync pipeline 內的 10 張 App 表**，手動輸入才留得住。這份文件把每一張表、每一欄逐一標記到這套機制上（經過逐表對抗驗證）。

一句話界線：**`HISConverter.convert_all()` 只吐 5 個 key**（patient / medications / lab_data / culture_results / diagnostic_reports，`converter.py:927-931`），`sync_snapshot_into_session` 只寫這 5 個目標（`snapshot_sync.py:483-527`）。其餘 `vital_signs`、`clinical_scores`、`symptom_records`、`ventilator_settings`、`weaning_assessments`、`medication_administrations`、`pharmacy_soap_records`、`pharmacy_advices`、`patient_messages`、`team_chat_messages` **HIS 從頭到尾不碰**。

---

## 2. 分界機制

### 2.1 patients 表：三個 frozenset + 一個 post-merge override

合併發生在 `merge_patient_payload`（`snapshot_sync.py:231-260`）。若 patient 是全新的（existing 為 None），直接把 converter 的 incoming 整包插入（所有 placeholder：`bed_number=''`、`height/weight/bmi=None`、`symptoms/sedation/…/allergies=[]`、`unit='ICU'` 等）。若已存在，`merged = dict(existing)` 後跑四個 loop：

| 機制 | 成員數 | sync 行為 | 關鍵碼 |
|---|---|---|---|
| `HIS_OWNED_FIELDS` | 15 | **無條件覆蓋**（key 一定在 incoming，**無** `_is_meaningful` 檢查，連 `''`/`0`/`None` 也覆蓋） | `snapshot_sync.py:147-165, 238-240` |
| `MIXED_FIELDS` | 5 | **與 HIS_OWNED 逐字元相同的無條件覆蓋**（含空 `[]`/`0`/`None`） | `snapshot_sync.py:187-195, 242-244` |
| `PRESERVE_EXISTING_FIELDS` | 15 | **有意義才覆蓋**：`_is_meaningful(incoming)` 為 True 才寫，否則保留 DB 既有值 | `snapshot_sync.py:167-185, 246-253` |
| catch-all loop | — | 目前為 no-op（33 個 converter key 全被三 frozenset 覆蓋：15+15+5−2 未吐=33） | `snapshot_sync.py:255-258` |

`_is_meaningful`（`snapshot_sync.py:217-228`）：`None`→False；字串 strip 後空→False；`list`/`dict` 長度 0→False；`bool` **只有 True 才算有意義**（False 不算）；`int`/`float` **0 不算**；其他→True。這是 `PRESERVE_EXISTING` 的唯一閘門。

**Post-merge 覆寫（TRAP #5）**：merge 完後 `snapshot_sync.py:497` 立刻 `merged_patient['last_update'] = datetime.now(utc)`，打敗 `last_update` 的 PRESERVE 身分；`upsert_patient`（`272-299`）再把 `updated_at=CURRENT_TIMESTAMP`。

### 2.2 三張 REPLACE_TABLES：整表刪除重插

`lab_data` / `culture_results` / `diagnostic_reports`（`REPLACE_TABLES`，`snapshot_sync.py:197-201`）走 `replace_patient_records`（`302-338`）：先 snapshot 既有 id 算 delta → `DELETE FROM {table} WHERE patient_id` → `insert_records` 嚴格多列 INSERT（**無 ON CONFLICT、無去重**，重複 id 直接 `IntegrityError` fail-loud）。**每次 sync 整批砍掉重建**，手動塞的列一定被銷毀，`created_at` 每次 sync 重置為 now()。

### 2.3 medications：reconcile（非 REPLACE）

`reconcile_medications`（`snapshot_sync.py:402-456`）：
- **Step 1 upsert**：`ON CONFLICT (id) DO UPDATE SET <每個非 id 欄>=excluded.col, updated_at=CURRENT_TIMESTAMP`；`created_at` 刻意排除以保留原始插入時間（`384-387`）。無 `_is_meaningful` 閘門 → 每個 converter 欄位對 HIS-id 列**無條件覆蓋**（連 `None`/`[]`/`False`）。
- **Step 2 stale 處理**：`stale = existing_ids − incoming_ids`。每個 stale 列，**若有 `medication_administrations` 子列 → 改 `status='discontinued'` 保留（protected）；否則硬 DELETE**（TRAP #4）。手動新增藥用 app uuid（`med_xxxxxx` / `med_opd_xxxxxx`）永遠不在 incoming set，故一定被當 stale 處理。

---

## 3. 逐表欄位盤點

**類別中文標籤對照**：

| JSON 類別 | 中文標籤 | 意義 |
|---|---|---|
| `HIS_OWNED` | **HIS 專屬覆蓋** | 每次 sync 無條件覆蓋（含空值） |
| `MIXED` | **HIS 衍生覆蓋(含空值)** | HIS 由其他資料衍生，每次無條件覆蓋（含 `[]`/`0`/`None`） |
| `PRESERVE_EXISTING` | **手動優先保留** | converter 只吐空 placeholder → 保留 DB 手動值 |
| `MANUAL_ONLY` | **純手動** | converter 從不吐；sync 不碰（或整表不在 pipeline） |
| `HIS_ONLY` | **純 HIS(無手動入口)** | 只有 HIS 寫入，無任何手動 create/update endpoint |
| `GRAY_BOTH` | **灰色地帶** | 手動可填，但 HIS 有條件蓋回 |
| `APP_MANAGED` | **系統自動(APP/DB)** | 伺服器/DB 產生（id、時間戳、衍生值），非 HIS 非手動打字 |

### 3.1 patients（最重要，40 個 ORM 欄 + 2 個 raw-SQL 欄）

| 欄位 | 類別 | HIS 來源 | sync 行為 | 手動入口 | 備註 |
|---|---|---|---|---|---|
| `id` | HIS 專屬覆蓋 | `_gen_id('pat', pat_no)` = `pat_`+md5(MRN)[:8] | 無條件覆蓋（no-op，決定性） | 無（手動建立走 `pat_{uuid6}`，`patients.py:315`） | 合成 PK，`converter.py:110` |
| `name` | HIS 專屬覆蓋 | `PAT_NAME` | 無條件覆蓋 | PATCH + Create | 空 `''` 也會蓋掉既有名字 |
| `bed_number` | 手動優先保留 | 無（converter 恆吐 `''`） | 保留 | PATCH + Create（必填） | HIS 無床號，需 GetIpd（尚未呼叫） |
| `medical_record_number` | HIS 專屬覆蓋 | `self.pat_no`（MRN，snapshot 資料夾 key） | 無條件覆蓋 | PATCH + Create | 手動改會被還原，且破壞 snapshot→row 匹配 |
| `age` | HIS 專屬覆蓋 | `BIRTHDAY`→age | 無條件覆蓋 | PATCH + Create | 無法解析→`age 0` 也覆蓋；CHECK 0..200 |
| `date_of_birth` | 純 HIS(無手動入口) | `BIRTHDAY` | 無條件覆蓋 | **無**（不在 PatientCreate/Update） | `None` 也覆蓋 |
| `gender` | HIS 專屬覆蓋 | `SEX`→正規化 | 無條件覆蓋 | PATCH + Create | 未知→`Other` 覆蓋 |
| `height` | 手動優先保留 | 無（恆吐 None） | 保留 | PATCH + Create | 編輯後重算 bmi |
| `weight` | 手動優先保留 | 無（恆吐 None） | 保留 | PATCH + Create | 編輯後重算 bmi |
| `bmi` | 系統自動(APP/DB) | 無 | 保留（伺服器由 height/weight 衍生） | 無（自動，`patients.py:326-328,562-568`） | 不在 Create/Update |
| `diagnosis` | HIS 專屬覆蓋 | getIPD ICD_CODE1..10；fallback getOpd | 無條件覆蓋 | PATCH + Create | 無 ICD 時吐 `'待確認'` placeholder **會覆蓋**手動診斷 |
| `symptoms` | 手動優先保留 | 無（恆吐 `[]`） | 保留 | PATCH（setattr loop，schema:69） | JSONB；無前端 widget 但 API 可寫 |
| `intubated` | 手動優先保留 | 無（恆吐 False） | 保留 | PATCH + Create | 設 tracheostomy 時 server 強制 True |
| `tracheostomy` | 純手動 | 無 | **不觸碰**（converter 從不吐此 key） | PATCH + Create | 在 PRESERVE 集合但 never emitted |
| `tracheostomy_date` | 純手動 | 無 | **不觸碰**（raw SQL 往返） | PATCH/POST `_persist_date_column` | **非 ORM 欄**（migration 068，raw SQL 讀寫） |
| `critical_status` | 手動優先保留 | 無（恆吐 None） | 保留 | PATCH + Create | 作為列表 filter |
| `sedation` | HIS 衍生覆蓋(含空值) | active 藥 `_classify_san=='S'`（`_derive_san`） | 無條件覆蓋（含 `[]`） | PATCH + Create | TRAP #3：無 S 類藥→空 `[]` 洗掉手動值 |
| `analgesia` | HIS 衍生覆蓋(含空值) | active 藥 `=='A'` | 無條件覆蓋（含 `[]`） | PATCH + Create | TRAP #3 |
| `nmb` | HIS 衍生覆蓋(含空值) | active 藥 `=='N'` | 無條件覆蓋（含 `[]`） | PATCH + Create | TRAP #3 |
| `admission_date` | HIS 專屬覆蓋 | getIPD `IPD_DATE`；fallback 最早 med START_DATE | 無條件覆蓋 | PATCH + Create | `None` 也覆蓋 |
| `icu_admission_date` | HIS 專屬覆蓋 | getIPD `IPD_DATE`（**設等於** admission_date） | 無條件覆蓋 | PATCH + Create | 非真 ICU 轉入時間；手動修正每次被還原 |
| `ventilator_days` | HIS 衍生覆蓋(含空值) | getAllOrder `MAJOR_CLASS=='D3'` TOTAL_QTY 加總 | 無條件覆蓋（含 `0`） | PATCH + Create（**僅未插管時**生效） | 三重治理：HIS / app 由 airway date 覆寫 / 手動；CHECK ≥0 |
| `attending_physician` | HIS 專屬覆蓋 | 由 med USER_NAME 啟發式；fallback DR_NAME | 無條件覆蓋 | PATCH + Create | 手動被蓋；可覆蓋為 None |
| `department` | HIS 專屬覆蓋 | 對應 attending 的 HDEPT_NAME | 無條件覆蓋 | PATCH + Create | 手動被蓋；可為 None；indexed |
| `unit` | **灰色地帶** | **硬編碼字面 `'ICU'`**（非 payload 欄） | **實質無條件覆蓋**（在 PRESERVE 但 `'ICU'` 恆 meaningful） | POST only（create 覆寫為建立者 unit 或 `'加護病房一'`）；**不可 PATCH** | **TRAP #1**：每次 sync 蓋回 `'ICU'`；驅動資料層存取控制，可能悄悄讓 HIS 病人脫離 unit-scoped 使用者 |
| `alerts` | **灰色地帶** | getPatient `DNR_CONSENT/DNR_IC_FLAG`→DNR 字串；否則 `[]` | 有意義才覆蓋（`[]` 保留，有 DNR 覆蓋） | PATCH + Create | **TRAP #2**：DNR alert 以 fresh `[]`+dnr 重建，**取代（非合併）**手動 alerts |
| `consent_status` | HIS 衍生覆蓋(含空值) | DNR→`'DNR signed'` 或 None | 無條件覆蓋（含 None） | PATCH + Create | TRAP #3：無 DNR 時手動值被洗成 None |
| `allergies` | **灰色地帶** | getSO SUBJECTIVE SOAP `parse_allergy_texts` | 有意義才覆蓋（`[]` 保留，`has_allergies` 覆蓋） | PATCH + Create | **TRAP #2**：`nka`/`unknown` 保留既有（記錄 NKA **不會清空**清單），只有陽性覆蓋 |
| `blood_type` | HIS 專屬覆蓋 | `BLOODTYPE_LAB`+`_RH` | 無條件覆蓋 | PATCH + Create | 缺值→None 覆蓋 |
| `code_status` | HIS 專屬覆蓋 | DNR flags→`'DNR'`/`'Full Code'` | 無條件覆蓋 | PATCH + Create | 手動每次被還原 |
| `has_dnr` | HIS 專屬覆蓋 | DNR flags（bool） | 無條件覆蓋 | PATCH + Create | 因是 HIS_OWNED，HIS 的 False **會蓋掉**既有 True |
| `is_isolated` | 手動優先保留 | 無（恆吐 False） | 保留 | PATCH + Create | HIS 無此資料 |
| `archived` | HIS 專屬覆蓋 | `DEAD_DATE`（bool，死亡才 True） | 無條件覆蓋 | PATCH `/patients/{id}/archive`（獨立 endpoint） | 手動 archive/出院**會被還原**（活人被 un-archive）；只反映死亡不反映出院 |
| `archived_at` | 系統自動(APP/DB) | 無 | **不觸碰**（原樣往返） | server-set on `/archive` | DateTime(tz) |
| `discharge_type` | 純手動 | 無 | **不觸碰** | `/archive`（首次 active→archived） | 無 HIS 來源 |
| `discharge_date` | 純手動 | 無 | **不觸碰** | `/archive`（ISO→date.fromisoformat） | 無效格式→400 |
| `discharge_reason` | 純手動 | 無 | **不觸碰** | `/archive`（schema `reason`→欄 `discharge_reason`） | — |
| `campus` | 手動優先保留 | 無（恆吐 None） | 保留（**但無 API/form 寫入**） | 僅 seed/import/直接 DB | 不在 Create/Update；String(50) 院區 |
| `last_update` | 系統自動(APP/DB) | 無 | **無條件覆蓋為 now(UTC)**（post-merge） | create/PATCH 也 stamp now() | **TRAP #5**：`snapshot_sync.py:497` 打敗其 PRESERVE 身分 |
| `created_at` | 系統自動(APP/DB) | 無 | **不觸碰**（upsert 排除；server_default now()） | 無 | 保留原始插入時間 |
| `updated_at` | 系統自動(APP/DB) | 無 | 無條件覆蓋（upsert force `CURRENT_TIMESTAMP`） | 無 | DB 管理；每次 sync/edit bump |
| `intubation_date` | 純手動 | 無 | **不觸碰**（raw SQL；**連 PRESERVE 集合都不在**） | PATCH/POST `_persist_date_column`（`patients.py:187-207`） | **非 ORM 欄**（migration 056）；驅動 ventilator_days |

> **關鍵盲點**：`intubation_date` 與 `tracheostomy_date` 是 DB 欄但**刻意不 ORM-map**（`patient.py:33-35`，避免 async deferred-column lazy-load），只透過 raw SQL 存取。任何只讀 ORM model 的盤點都會漏掉這兩欄。

### 3.2 medications（reconcile：upsert + stale 刪除/停用）

| 欄位 | 類別 | HIS 來源 | sync 行為 | 手動入口 | 備註 |
|---|---|---|---|---|---|
| `id` | HIS 專屬覆蓋 | `_gen_id('med', pat_no, ODR_SEQ, PAT_SEQ, ODR_CODE)` | ON CONFLICT 目標，**排除於 SET → 從不更新** | POST create `med_{uuid6}` / import `med_opd_{uuid6}`（app uuid） | 手動 uuid 另一個 keyspace，reconcile 當 stale 刪/停 |
| `patient_id` | HIS 專屬覆蓋 | `_gen_id('pat', pat_no)` | 覆蓋（值為穩定病人身分） | 手動藥沿用同一 HIS patient id | FK RESTRICT |
| `name` | HIS 衍生覆蓋(含空值) | `ODR_NAME`→`_clean_drug_name` | 無條件覆蓋（HIS-id 列） | Create + import | 手動藥保留 name 直到 reconcile 刪/停 |
| `generic_name` | HIS 衍生覆蓋(含空值) | 清理後 ODR_NAME + `_DDI_ALIAS_MAP` | 無條件覆蓋 | Create + import | DDI alias/exclusion 來自 `resources.py` |
| `order_code` | 純 HIS(無手動入口) | `ODR_CODE` | 無條件覆蓋 | 無（手動藥留 NULL） | self-supplied 交叉參照用 |
| `category` | HIS 衍生覆蓋(含空值) | `_classify_category(ODR_NAME)` | 無條件覆蓋（含 None） | Create | — |
| `san_category` | HIS 衍生覆蓋(含空值) | `_classify_san(ODR_NAME)` | 無條件覆蓋 | Create + Update（正規化 S/A/N） | 單字母 S/A/N，≠ patients.sedation CSV；手動 PATCH 被蓋 |
| `dose` | HIS 衍生覆蓋(含空值) | `str(DOSE)` | 無條件覆蓋 | Create + Update + import | 手動 PATCH 還原為 HIS DOSE |
| `unit` | HIS 衍生覆蓋(含空值) | `DOSE_UNIT` | 無條件覆蓋 | Create + Update + import | **是藥物劑量單位，≠ patients.unit**；純 MIXED 無 trap#1 |
| `frequency` | HIS 衍生覆蓋(含空值) | `_FREQ_MAP`/freq_code | 無條件覆蓋 | Create + Update + import | — |
| `route` | HIS 衍生覆蓋(含空值) | `_ROUTE_MAP`/route_code | 無條件覆蓋 | Create + Update + import | `PO` 參與 self-supplied 交叉參照 |
| `prn` | HIS 衍生覆蓋(含空值) | `'PRN' in FREQ_CODE` | 無條件覆蓋 | Create（default False） | — |
| `indication` | 純手動 | 無（converter **恆吐 None**） | HIS-id 列每次覆蓋為 **NULL** | Create + import（不在 Update） | HIS 不供；只在手動藥有意義，而手動藥被 reconcile 處理 |
| `start_date` | HIS 衍生覆蓋(含空值) | `_roc_to_date(START_DATE)` | 無條件覆蓋 | Create + import | 建立後不可編輯 |
| `end_date` | HIS 衍生覆蓋(含空值) | `_roc_to_date(END_DATE)` | 無條件覆蓋 | Update + import | 手動停藥 endDate 還原 |
| `status` | HIS 衍生覆蓋(含空值) | DC_FLAG/OPD_SW/日期比較衍生 | 無條件覆蓋 + reconcile 對有 admin 的 stale 強制 `discontinued` | Update（create 強制 `active`） | tri-provenance；CHECK 5 值 |
| `prescribed_by` | HIS 專屬覆蓋 | `{name: USER_NAME}` | 無條件覆蓋 | create 由 auth user 衍生 `{id,name}`（非 body、非打字） | JSONB |
| `warnings` | 純手動 | 無（恆吐 `[]`） | HIS-id 列每次覆蓋為 `[]` | **無任何寫入路徑**（dead 欄） | Create/Update/import 皆無此欄 |
| `concentration` | 純手動 | 無（恆吐 None） | HIS-id 列每次覆蓋為 **NULL** | Create + Update | 本表最清楚的「手動值被蓋成 None」陷阱 |
| `concentration_unit` | 純手動 | 無（恆吐 None） | HIS-id 列每次覆蓋為 **NULL** | Create + Update | 同上 |
| `notes` | HIS 衍生覆蓋(含空值) | `NOTES` | 無條件覆蓋 | Update | `自備` substring 觸發 query-time self-supplied |
| `source_type` | HIS 專屬覆蓋 | `_OPD_SW_MAP`（inpatient/outpatient） | 無條件覆蓋 | 非打字（import 強制 outpatient） | default `inpatient` |
| `source_campus` | 純手動 | 無（恆吐 None） | HIS-id 列覆蓋為 NULL | import-outpatient（院區） | 真人填 |
| `prescribing_hospital` | 純手動 | 無（恆吐 None） | HIS-id 列覆蓋為 NULL | import-outpatient | 真人填 |
| `prescribing_department` | HIS 衍生覆蓋(含空值) | `HDEPT_NAME` | 無條件覆蓋（HIS-id 列） | import-outpatient | **雙來源**：HIS 1791 藥 + 手動 import |
| `prescribing_doctor_name` | HIS 衍生覆蓋(含空值) | `USER_NAME` | 無條件覆蓋 | import-outpatient | 雙來源 |
| `days_supply` | HIS 衍生覆蓋(含空值) | `int(DAYS)` | 無條件覆蓋 | import-outpatient | 雙來源；用於 outpatient 到期計算 |
| `is_external` | 純手動 | 無（恆吐 False） | HIS-id 列覆蓋為 False | import-outpatient（default False） | 非聯醫體系旗標 |
| `atc_code` | 純 HIS(無手動入口) | formulary CSV / RxNorm cache（依 ODR_CODE） | 無條件覆蓋 | 無 | app-side enrichment；prod 不連網 |
| `is_antibiotic` | 純 HIS(無手動入口) | formulary（依 ODR_CODE） | 無條件覆蓋 | 無 | server_default false() |
| `kidney_relevant` | 純 HIS(無手動入口) | formulary | 無條件覆蓋 | 無 | 三態 Boolean |
| `coding_source` | 純 HIS(無手動入口) | provenance flag | 無條件覆蓋 | 無 | 驗證 VALID_CODING_SOURCES |
| `created_at` | 系統自動(APP/DB) | 無 | ON CONFLICT **保留**（測試把關） | 無 | `test_upsert_records_preserves_created_at_on_update` |
| `updated_at` | 系統自動(APP/DB) | 無 | 每次 ON CONFLICT force `CURRENT_TIMESTAMP`；reconcile 停藥也 set | 無 | 等同 patients last_update trap 的 medications 版 |

### 3.3 lab_data（REPLACE_TABLES：整表刪除重插）

| 欄位 | 類別 | HIS 來源 | sync 行為 | 手動入口 | 備註 |
|---|---|---|---|---|---|
| `id` | HIS 專屬覆蓋 | `_gen_id('lab', pat_no, REPORT_DATE_TIME)` | 刪除重插（每次砍掉重建） | 無 | 決定性 id，非 DB 生成 |
| `patient_id` | HIS 專屬覆蓋 | `pat_id` | 刪除重插 | 無 | FK RESTRICT |
| `timestamp` | HIS 專屬覆蓋 | `REPORT_DATE+TIME`→`_roc_to_datetime` | 刪除重插 | 無 | 一次抽血分組 key |
| `biochemistry` | **灰色地帶** | `HIS_LAB_MAP` cat biochemistry（value/unit/range/isAbnormal） | 刪除重插；**手動修正下次 sync 被還原** | PATCH `/lab-data/{id}/correct`（admin/doctor/np） | converter 恆吐此 key（空→NULL），空抽血也覆蓋 |
| `hematology` | **灰色地帶** | cat hematology | 刪除重插；手動修正被還原 | PATCH correct | 同上 |
| `blood_gas` | **灰色地帶** | cat blood_gas | 刪除重插；手動修正被還原 | PATCH correct（`bloodGas`→snake） | 同上 |
| `venous_blood_gas` | **灰色地帶** | cat venous_blood_gas（migration 055） | 刪除重插；手動修正被還原 | PATCH correct（`venousBloodGas`→snake） | Response schema 強制 `or {}` 不回 null，但 DB 欄仍 HIS-owned |
| `inflammatory` | **灰色地帶** | cat inflammatory | 刪除重插；手動修正被還原 | PATCH correct | — |
| `coagulation` | **灰色地帶** | cat coagulation | 刪除重插；手動修正被還原 | PATCH correct | — |
| `cardiac` | **灰色地帶** | cat cardiac | 刪除重插；手動修正被還原 | PATCH correct | — |
| `thyroid` | **灰色地帶** | cat thyroid | 刪除重插；手動修正被還原 | PATCH correct | — |
| `hormone` | **灰色地帶** | cat hormone | 刪除重插；手動修正被還原 | PATCH correct | — |
| `lipid` | **灰色地帶** | cat lipid | 刪除重插；手動修正被還原 | PATCH correct | — |
| `other` | **灰色地帶** | catch-all（未對應碼 + glycated/serology/tumor/allergy/tdm + U_/ST_/PF_ 前綴） | 刪除重插；手動修正被還原 | PATCH correct | culture/susceptibility/gram_stain 等在此 SKIP，改進 culture_results |
| `corrections` | 純手動 | 無（converter 從不吐） | 刪除重插 **WIPES** 整個 audit trail | PATCH correct（append 修正紀錄） | **GOTCHA**：手動修正 audit 每次 sync 被銷毀 |
| `created_at` | 系統自動(APP/DB) | 無 | **每次 sync 重置為 now()**（刪除重插，非 upsert） | 無 | 對比 medications 刻意保留 |
| `updated_at` | 系統自動(APP/DB) | 無 | insert 時 now()；手動 PATCH 觸發 onupdate | 無 | — |

### 3.4 culture_results（REPLACE_TABLES，純 HIS，無任何寫入 endpoint）

> 全表 12 欄由 converter 供給、刪除重插、**無 create/update/delete endpoint**（只有 `GET /{patient_id}/cultures`）。

| 欄位 | 類別 | HIS 來源 | sync 行為 | 手動入口 | 備註 |
|---|---|---|---|---|---|
| `id` | 純 HIS(無手動入口) | `_gen_id('cul', pat_no, SHEET_NO)` | 刪除重插（嚴格 INSERT，重複 id fail-loud） | 無 | REPLACE 成員 |
| `patient_id` | 純 HIS(無手動入口) | `convert_patient()['id']` | 刪除重插 | 無 | FK RESTRICT |
| `sheet_number` | 純 HIS(無手動入口) | `SHEET_NO`（fallback `'unknown'`） | 刪除重插 | 無 | — |
| `specimen` | 純 HIS(無手動入口) | group 首列 `ITEM_NAME` | 刪除重插 | 無 | 空字串 fallback |
| `specimen_code` | 純 HIS(無手動入口) | 首列 `ITEM_CODE` | 刪除重插 | 無 | — |
| `department` | 純 HIS(無手動入口) | 首列 `HDEPT_NAME` | 刪除重插 | 無 | Python 端 default `''` |
| `collected_at` | 純 HIS(無手動入口) | 首列 `SIGN_DATE+TIME` | 刪除重插 | 無 | 可為 None；GET ORDER BY key |
| `reported_at` | 純 HIS(無手動入口) | 首列 `REPORT_DATE+TIME` | 刪除重插 | 無 | 可為 None |
| `isolates` | 純 HIS(無手動入口) | `_Isolate1/2/3`+`_Colonies1/2/3` | 刪除重插 | 無 | JSONB array |
| `susceptibility` | 純 HIS(無手動入口) | susceptibility items（`*_MIC` 排除） | 刪除重插 | 無 | JSONB array（S/I/R） |
| `q_score` | 純 HIS(無手動入口) | `_QScore` | 刪除重插 | 無 | 非整數→None |
| `result` | 純 HIS(無手動入口) | `_Result`；或合成 `'No growth to date'` | 刪除重插 | 無 | converter 算出的 `alerts`/aerobic/anaerobic **刻意丟棄**（表無此欄） |
| `created_at` | 系統自動(APP/DB) | 無 | **每次 sync 重置為 now()** | 無 | 非穩定插入時間 |
| `updated_at` | 系統自動(APP/DB) | 無 | onupdate 從不觸發（只刪除重插）；恆等於 created_at | 無 | GET-only router |

### 3.5 diagnostic_reports（REPLACE_TABLES，純 HIS，只有 GET endpoint）

> 三來源串流合併：imaging（getAllOrder MAJOR_CLASS∈{22,23}）、procedure（getSurgery）、ecg_ai（getAIResult）。無 updated_at 欄。

| 欄位 | 類別 | HIS 來源 | sync 行為 | 手動入口 | 備註 |
|---|---|---|---|---|---|
| `id` | 純 HIS(無手動入口) | `_gen_id('diag'/'surg'/'ecgai', …)` | 刪除重插 | 無 | PK 無 DB default，HIS 衍生 |
| `patient_id` | 純 HIS(無手動入口) | `pat_id` | 刪除重插 | 無 | FK RESTRICT |
| `report_type` | 純 HIS(無手動入口) | 字面 `imaging`/`procedure`/`ecg_ai` | 刪除重插 | 無 | model 註解 `'other'` 不準，實際吐 `ecg_ai` |
| `exam_name` | 純 HIS(無手動入口) | `ODR_NAME`/`'手術'`/`'ECG AI Interpretation'` | 刪除重插 | 無 | 非 null |
| `exam_date` | 純 HIS(無手動入口) | START/IN_OR/REPORT date | 刪除重插 | 無 | 非 null；None→batch fail |
| `body_text` | 純 HIS(無手動入口) | `NOTES`/`CONTENT_TEXT`/`json.dumps(REPORT_CONTENT)` | 刪除重插 | 無 | 空→`''` |
| `impression` | 純 HIS(無手動入口) | 僅 ecg_ai：`_build_ecg_impression` | 刪除重插 | 無 | imaging/surgery 恆 None |
| `reporter_name` | 純 HIS(無手動入口) | `USER_NAME`/`DR_NAME`/`'AI System'` | 刪除重插 | 無 | 可 None |
| `status` | 純 HIS(無手動入口) | 字面 `'final'`（三串流皆是） | 刪除重插 | 無 | 只寫 `final` |
| `created_at` | 系統自動(APP/DB) | 無 | **每次 sync 重置為 now()** | 無 | REPLACE 表無穩定原始時間；**無 updated_at 欄** |

### 3.6 完全不在 HIS pipeline 的 10 張 App 表

以下每張表 **his_source = null、sync 行為 = 不觸碰（never-touched）**（`HISConverter` 從不吐、三 frozenset/REPLACE_TABLES/reconcile 皆不引用）。因此只列 類別 + 手動入口 + 備註。

**`medication_administrations`**（HIS 只在 reconcile 讀取一次以決定 med 命運，`snapshot_sync.py:424`）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` / `medication_id` / `patient_id` / `scheduled_time` / `dose` / `route` | 系統自動(APP/DB) | seed（`medicationAdministrations.json`） | `medication_id`（FK RESTRICT）是 **TRAP #4 樞紐**：有此列的 med sync 時改停用而非刪除 |
| `status` | 純手動 | PATCH `.../administrations/{id}`（5 值） | 無 POST create；只在 pre-seed 列上做狀態轉換 |
| `administered_time` | 純手動 | PATCH 副作用（status=administered stamp now，write-once） | 非打字；離開 administered 清空 |
| `administered_by` | 純手動 | PATCH 副作用（auth user `{id,name}`，每次覆寫） | 非打字 |
| `notes` | 純手動 | PATCH（**無條件覆寫**） | **陷阱**：省略 notes 會把既有 note 洗成 None |
| `created_at` / `updated_at` | 系統自動(APP/DB) | — | onupdate 走 ORM 可靠觸發 |

**`clinical_scores`**（backend/CLAUDE.md：需臨床評估，HIS 0 列；無 updated_at 欄；immutable 只 insert/delete）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` / `created_at` | 系統自動(APP/DB) | 伺服器（uuid / server_default） | — |
| `patient_id` | 純手動 | POST `.../scores`（URL path 衍生） | server-derived from route |
| `score_type` / `value` / `notes` | 純手動 | POST body（`pain`/`rass`；範圍 Pydantic 驗證） | — |
| `timestamp` | 純手動 | 伺服器 `now(utc)` at POST | 評估時間，非 body |
| `recorded_by` | 純手動 | `user.id`（scalar 字串，非 JSONB） | server-derived |

**`symptom_records`**（無 updated_at 欄）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` / `patient_id` / `recorded_at` / `recorded_by` / `created_at` | 系統自動(APP/DB) | 伺服器（uuid / route / now(utc) / session user / server_default） | 同一 list 也鏡射到 `patients.symptoms` |
| `symptoms` / `notes` | 純手動 | POST body | 真人輸入 |

> **勿混淆**：`patients.symptoms`（PRESERVE 欄）與 `symptom_records` 表是兩回事。

**`vital_signs`**（backend/CLAUDE.md：HIS 無床邊監視器資料，0 列）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` / `patient_id` / `timestamp` | 系統自動(APP/DB) | 伺服器（uuid / route / now(utc)） | — |
| `heart_rate` `systolic_bp` `diastolic_bp` `mean_bp` `respiratory_rate` `spo2` `temperature` `etco2` `cvp` `icp` `cpp` `body_weight` | 純手動 | admin POST（`patient-labs-tab.tsx`）；`etco2/cvp/icp/cpp/body_weight` 另由 `run_seed_repair.py` 回填（非 HIS） | spo2 有 CHECK 0..100 |
| `reference_ranges` | 系統自動(APP/DB) | 無（**dead/orphan 欄**，恆 NULL） | API 回硬編碼常數，DB 欄從不讀寫 |
| `created_at` / `updated_at` | 系統自動(APP/DB) | — | 無 UPDATE endpoint，onupdate 僅 seed_repair 觸發 |

**`ventilator_settings`**（backend/CLAUDE.md：HIS 無呼吸器參數，0 列；admin-only 手動入口）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` / `timestamp` / `created_at` / `updated_at` | 系統自動(APP/DB) | 伺服器 | timestamp 非 body |
| `patient_id` | 純手動 | admin POST `.../ventilator/settings`（URL path） | — |
| `mode` `fio2` `peep` `tidal_volume` `respiratory_rate` `inspiratory_pressure` `pressure_support` `ie_ratio` `pip` `plateau` `compliance` `resistance` | 純手動 | admin POST（`VentilatorInput`） | fio2 CHECK 21..100；**手動列 sync 不刪**（不同於手動藥） |

**`weaning_assessments`**（admin-only；13 臨床欄目前**無寫入路徑、恆 NULL**）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` / `patient_id` / `timestamp` / `assessed_by` / `created_at` / `updated_at` | 系統自動(APP/DB) | 伺服器（uuid / route / now / auth `{id,name,role}`） | assessed_by 是唯一可靠填入的 clinical-table 欄 |
| `rsbi` `nif` `vt` `rr` `spo2` `fio2` `peep` `gcs` `cough_strength` `secretions` `hemodynamic_stability` `recommendation` `readiness_score` | 純手動（設計意圖） | POST `.../weaning-assessment` | **陷阱**：create endpoint **無 body 參數**，這 13 欄目前無任何 writer → 實際恆 NULL，卻在前端渲染 |

**`pharmacy_soap_records`**（100% 藥師/App 撰寫；只有 POST + GET）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` / `pharmacist_id` / `pharmacist_name` / `bed_number` / `created_at` / `updated_at` | 系統自動(APP/DB) | 伺服器（uuid / auth / **patient.bed_number 快照**） | bed_number 是凍結快照，非打字 |
| `patient_id` | 純手動 | POST body.patientId（唯一必填非文字欄） | — |
| `subjective` `objective` `assessment` `plan` `polished_content` | 純手動 | 藥師 free-text（S/O/A/P + LLM polished） | 無 UPDATE endpoint |

**`pharmacy_advices`**（藥師/App 撰寫；可由 VPN-tagged message 自動建立，仍非 HIS）

| 欄位 | 類別 | 手動入口 | 備註 |
|---|---|---|---|
| `id` `pharmacist_id` `pharmacist_name` `responded_by_id` `responded_by_name` `responded_at` `timestamp` `source_message_id` `created_at` `updated_at` | 系統自動(APP/DB) | 伺服器/auth/now() | — |
| `patient_name` / `bed_number` | 系統自動(APP/DB) | patients 列快照（**非打字**） | **staleness 風險**：name 是 HIS_OWNED、bed_number 是 PRESERVE，此凍結副本不隨 HIS 更新 |
| `patient_id` | 純手動 | POST body.patientId | 真人選病人 |
| `advice_code` `advice_label` `category` `content` `linked_medications` `accepted` | 純手動 | POST/PATCH（accepted 為醫師 accept/reject 決定，doctor/np/admin） | source_message_id FK ondelete CASCADE |

**`patient_messages`** / **`team_chat_messages`**（協作/公佈欄，無 HIS 對應）

| 分組 | 類別 | 欄位 |
|---|---|---|
| 系統/auth 產生 | 系統自動(APP/DB) | `id`、`patient_id`/route、`author_*`/`user_*`（auth 快照）、`timestamp`、`is_read`、`read_by`、`reply_count`、`pinned*`、`deleted_*`、`advice_record_id`、`created_at`、`updated_at` |
| 使用者撰寫 | 純手動 | `content`、`message_type`、`linked_medication`、`advice_code`、`reply_to_id`、`tags`、`mentioned_roles`、`mentioned_user_ids`、`mentions_all` |

---

## 4. 灰色地帶（BOTH）— 手動可填但會被 HIS 蓋回

以下欄位**前端/API 讓你填，但下一次 sync 會覆蓋**。這是最容易踩的坑，逐條列出：

1. **`patients.unit`（TRAP #1，存取控制風險）**：宣告在 `PRESERVE_EXISTING_FIELDS`（意圖=保留），但 converter 硬編碼 `'ICU'`，`_is_meaningful('ICU')=True`，故 PRESERVE loop **每次 sync 都覆蓋**建立時的 unit（例如 `'加護病房一'`）回 `'ICU'`。且 `unit` 不在 PatientUpdate（不可 PATCH）。unit 驅動資料層存取控制 → HIS 病人可能悄悄脫離 unit-scoped 使用者。

2. **`patients.allergies`（TRAP #2）**：CLAUDE.md 說「HIS 無過敏」，但 converter **確實**從 getSO SUBJECTIVE SOAP 解析。`nka`/`unknown` 保留既有（記錄 NKA **不會清空**清單）；只有 `has_allergies` 陽性覆蓋，且是 **fresh `[]`+新值重建、取代而非合併**手動輸入。

3. **`patients.alerts`（TRAP #2）**：手動可填，但 HIS DNR 解析出 alert 時，用 fresh `[]`+dnr_alerts 重建 → **取代**（非合併）手動 alerts。

4. **`patients.sedation` / `analgesia` / `nmb` / `consent_status` / `ventilator_days`（MIXED，TRAP #3）**：MIXED loop 與 HIS_OWNED 逐字元相同、**無 meaningfulness 檢查**。HIS 沒東西時，incoming 的空 `[]`/`0`/`None` **無條件洗掉**手動值。`ventilator_days` 另有 app 端（插管時由 airway date 覆寫）與手動（僅未插管生效）兩層。

5. **所有 HIS_OWNED 但可 PATCH 的 patients 欄位**：`name`、`age`、`gender`、`diagnosis`、`medical_record_number`、`attending_physician`、`department`、`admission_date`、`icu_admission_date`、`blood_type`、`code_status`、`has_dnr`、`archived` — 手動改了下次 sync 一律被還原（`archived` 尤其危險：**手動 archive/出院的活人下次 sync 被 un-archive**，因為 `archived=bool(DEAD_DATE)` 只反映死亡）。

6. **`medications` HIS-id 藥的手動 PATCH**：`dose`/`unit`/`frequency`/`route`/`status`/`endDate`/`sanCategory`/`concentration`/`concentration_unit`/`notes` 下次 sync 全部還原成 converter 值。`concentration`/`concentration_unit` 甚至被 **蓋成 NULL**（converter 恆吐 None）。

7. **手動新增藥被刪（TRAP #4）**：POST 建立的手動藥（`med_xxxxxx` / `med_opd_xxxxxx`）永不在 HIS incoming set → 被當 stale：**無 `medication_administrations` 子列 → 硬 DELETE；有子列 → 強制 `discontinued` 保留**。手動藥**永遠無法**存活成 active 通過一次 sync。

8. **`lab_data` 手動修正被洗掉**：`PATCH /lab-data/{id}/correct` 會（a）改 category JSONB 內的 item value、（b）append `corrections` audit 陣列。但 lab_data 是 REPLACE_TABLES → **每小時 sync 整批 DELETE+re-INSERT**，兩者都被還原/銷毀（converter 從不吐 `corrections` key）。醫師輸入的檢驗值修正與稽核軌跡都不持久。

---

## 5. 純 HIS / 純手動 快速清單

**純 HIS（改了留不住 — 手動改會被覆蓋，或根本沒有手動入口）**

- **完全無手動入口（純 HIS-only）**：`culture_results` 全表、`diagnostic_reports` 全表、`patients.date_of_birth`、`medications.order_code`/`atc_code`/`is_antibiotic`/`kidney_relevant`/`coding_source`、`lab_data.id`/`patient_id`/`timestamp`。
- **有手動入口但每次被覆蓋（HIS_OWNED / MIXED）**：`patients` 的 `name`/`age`/`gender`/`diagnosis`/`medical_record_number`/`attending_physician`/`department`/`admission_date`/`icu_admission_date`/`blood_type`/`code_status`/`has_dnr`/`archived`（HIS_OWNED）＋ `sedation`/`analgesia`/`nmb`/`consent_status`/`ventilator_days`（MIXED）；`medications` 的 `name`/`generic_name`/`category`/`san_category`/`dose`/`unit`/`frequency`/`route`/`prn`/`status`/`start_date`/`end_date`/`notes`/`prescribing_department`/`prescribing_doctor_name`/`days_supply`（MIXED）＋ `patient_id`/`prescribed_by`/`source_type`（HIS_OWNED）；`lab_data` 全部 11 個 category 欄（灰色地帶，HIS 為持久贏家）。

**純手動（sync 不碰，填了會保留）**

- **patients 表內**：`bed_number`、`height`、`weight`、`bmi`（app 衍生）、`symptoms`、`intubated`、`tracheostomy`、`tracheostomy_date`、`intubation_date`、`critical_status`、`is_isolated`、`campus`（僅 seed/DB）、`discharge_type`/`discharge_date`/`discharge_reason`/`archived_at`。
- **整張表都是手動/App（HIS 從不碰）**：`medication_administrations`、`clinical_scores`、`symptom_records`、`vital_signs`、`ventilator_settings`、`weaning_assessments`、`pharmacy_soap_records`、`pharmacy_advices`、`patient_messages`、`team_chat_messages`。

---

## 6. 給臨床使用者

**填了會留住（安全）：**
- 病人基本補充資料：**床號、身高、體重、隔離狀態、氣管內管/氣切與其日期、危急狀態、症狀**。這些 HIS 沒有，你填了就一直在。
- **所有生命徵象、鎮靜/RASS 評分、症狀紀錄、呼吸器設定、脫離評估、藥師 SOAP 與藥事建議、團隊聊天/病人留言** — 這些整套都是院內自己記的，HIS 完全不會蓋掉。
- 出院/離開資訊（出院類型、日期、原因）走獨立的封存流程，不會被 sync 動到。

**填了只是暫時（下次同步會被 HIS 蓋回，別依賴）：**
- 病人的**姓名、年齡、性別、診斷、血型、主治醫師、科別、住院/入 ICU 日期、DNR/code status、病歷號** — 這些以 HIS 為準，你在系統裡改，最多撐到下一次每小時同步。
- **鎮靜/止痛/肌鬆藥清單、consent 狀態、呼吸器天數、過敏、警示（alerts）**：HIS 有資料時會覆蓋；沒資料時，鎮靜/consent/呼吸器天數甚至會被**清空**（過敏/警示例外：HIS 沒抓到時會保留你填的）。
- **床位所在 unit** 會被固定蓋回 `ICU`。
- **檢驗值的手動更正**：你在檢驗頁做的更正，**下一次同步會被原始 HIS 值蓋回**，更正紀錄也會消失 — 若需長期修正請走正式管道。
- **手動新增的藥**：下次同步會被移除（若沒有給藥紀錄）或標記為停用（若已有給藥紀錄），無法維持在「使用中」。對 HIS 既有藥所做的劑量/頻率/途徑等修改也只是暫時。

一句話：**HIS 有的欄位以 HIS 為準；HIS 沒有的欄位你說了算。**

---

## 7. 給工程師的注意事項

**改分界時要動哪裡：**
- patients 的每一欄歸屬，**只改 `snapshot_sync.py:147-201` 的三個 frozenset**。搬動一欄的意義：`HIS_OWNED`↔`MIXED`（兩者行為逐字元相同，都無條件覆蓋）差別只在語意分類；真正改行為是搬進/搬出 `PRESERVE_EXISTING_FIELDS`（唯一跑 `_is_meaningful` 的桶）。
- 子表分界改 `REPLACE_TABLES`（整表刪除重插）或 `reconcile_medications`（upsert + stale 刪/停）。這兩套與 patients 三 frozenset **完全獨立**。

**加新欄位預設落在哪一類：**
- 若 converter 會吐這個 key（即使是空 placeholder），且**沒**放進任一 frozenset → 落到 catch-all loop（`255-258`）被無條件複製，行為 = MIXED。**要保留手動值就必須顯式放 `PRESERVE_EXISTING_FIELDS` 並讓 converter 吐空 placeholder**（`''`/`None`/`[]`/`False`/`0`，這些都 `_is_meaningful=False`）。
- 若 converter **不**吐這個 key → 即使在 PRESERVE 集合也走 `if field not in incoming: continue`，永遠不被觸碰（例：`tracheostomy`/`tracheostomy_date`）。
- 全新 App 表：只要 `convert_all()` 不加 key、`sync_snapshot_into_session` 不加寫入，就自動安全（純手動）。

**常見誤區：**
- 別把 `medications.unit`（藥物劑量單位，純 MIXED）誤當成 `patients.unit`（TRAP #1 灰色地帶）。同名不同表、不同機制。
- 別以為 `PRESERVE_EXISTING` 就一定保留：`unit`（硬 `'ICU'`）與 `last_update`（post-merge force now()）都在 PRESERVE 集合卻被打敗。
- HIS_OWNED loop **無 meaningfulness 檢查**：空 `''` name、`0` age、`None` blood_type、`'待確認'` diagnosis placeholder 都會覆蓋既有值 — 加 HIS_OWNED 欄前想清楚 converter 缺值時吐什麼。
- REPLACE 表的 `created_at` **每次 sync 重置**（刪除重插），不是穩定插入時間；只有 medications 的 upsert 路徑刻意保留 `created_at`。
- 只讀 ORM model 會漏 `patients.intubation_date` / `tracheostomy_date`（raw SQL，非 ORM-mapped）。
- Python 端 `default=`（非 `server_default=`）只在 ORM insert 生效；raw-SQL/bulk sync 路徑會繞過（例：`medications.status='active'`、`source_type='inpatient'`、各 bool False）。
- 資料修補**不要再疊 data-seed migration**；走 `backend/scripts/run_seed_repair.py`（見 CLAUDE.md）。lab corrections 若要持久化，需在 REPLACE 邏輯外另存（現況會被 sync 洗掉）。

---

## 8. 附錄

**產出方式**：本文件由多 agent 分表盤點（model reader / converter reader / schema reader）+ 逐表對抗驗證（adversarial re-check against source）產生，日期 2026-07-21。所有 `frozenset` 成員、`_is_meaningful` 語意、REPLACE/reconcile 路徑均對照原始碼行號覆核；已修正 reader 階段的多處誤判（unit→GRAY_BOTH、alerts/allergies→GRAY_BOTH、lab category→GRAY_BOTH 而非 MIXED、多個 id→HIS_OWNED、denormalized 快照→APP_MANAGED、13 個 weaning 欄實際恆 NULL 等）。

**關鍵檔案索引：**

| 角色 | 路徑 | 重點行號 |
|---|---|---|
| 合併規則（唯一真相） | `backend/app/fhir/snapshot_sync.py` | frozenset `147-201`；`merge_patient_payload` `231-260`；`_is_meaningful` `217-228`；post-merge last_update `497`；`replace_patient_records` `302-338`；`reconcile_medications` `402-456`；`upsert_patient` `272-299` |
| 同步進入點 | `backend/app/fhir/snapshot_sync.py` | `sync_snapshot_into_session` `483-527` |
| HIS→dict 轉換 | `backend/app/fhir/his/converter.py` | patients `85-142`；medications `346-420`；lab `441-534`；culture `550-663`；diagnostic `678-767`；`convert_all` `885-951`（5 個 key `927-931`） |
| 生產同步腳本 | `backend/scripts/sync_his_snapshots_serial.py` | （禁用舊版 `sync_his_snapshots.py`） |
| 病人手動入口 | `backend/app/routers/patients.py` | `create_patient` `308`；`update_patient` `506-652`（field_mapping `524-537`）；`/archive` `655-696`；airway raw SQL `187-207` |
| 藥物手動入口 | `backend/app/routers/medications.py` | create `342`；update `387-399`；import-outpatient `489-507` |
| 檢驗更正 | `backend/app/routers/lab_data.py` | `correct_lab_data` `394-437` |
| enrichment 來源 | `code_maps/drug_formulary.csv`；`backend/app/fhir/his/resources.py` `58-99`；`backend/app/fhir/his_lab_mapping.py` | ATC/antibiotic/kidney；LAB_CODE 路由 |
| 資料覆蓋現況 | `backend/CLAUDE.md` | Data Coverage Summary（vital/ventilator/scores = 0；height/weight/allergies/campus/bed_number/unit 非 HIS） |