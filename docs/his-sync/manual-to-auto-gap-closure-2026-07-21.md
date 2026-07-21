# 手動欄位 → 自動可取得 盤點（新數據批 2026-07-21）

> 對象：`patient/{MRN}/<latest.txt 指向的 snapshot>/ALL_MERGED.json`（10 位 M 院區 ICU 病人）
> 目的：新數據批**多了 SMARTBED（`sb*`）+ `getICUbed`**，並在第二批（`20260721_204616`）再加 **`getTPR`（生命徵象）/`getMedicine`/`getStatOrder`**，補上原本「只能手動輸入」的欄位。本文盤點**哪些手動欄位現在可自動取得、哪些仍缺、以及 pipeline 是否已消費**。
> 三方互補：
> - [`his-field-source-inventory-2026-07-21.md`](./his-field-source-inventory-2026-07-21.md) — DB 欄位「HIS 覆蓋 vs 手動保留」邊界（本文更新其「純手動」判定）
> - [`patient-snapshot-field-inventory-2026-07-21.md`](./patient-snapshot-field-inventory-2026-07-21.md) — 原始 snapshot 全欄位 + 陷阱（本文引用其 §4 坑位）
> - [`patient/資料使用手冊.md`](../../patient/資料使用手冊.md) — 官方資料說明

> **⚠️ 2026-07-21 第二批結構變更**：snapshot 版面重組為 `Factories/<院區>/`＋`Smartbed/<院區>/` 巢狀 ＋ `CALL_INDEX.json`＋`_README.txt`＋每 MRN `latest.txt`（讀取一律先看 `latest.txt` 決定 snapshot 目錄）。`ALL_MERGED.json` 仍保留頂層扁平 key（相容）並新增巢狀 `Factories`/`Smartbed`/`_meta`。**新增 3 支 REST API（皆 `<API>_AllPatientSeq` seq 信封）：`getTPR`（生命徵象）、`getMedicine`（逐就診序號用藥，含居家藥）、`getStatOrder`（STAT 醫囑）。** `sb*` 現改放 `Smartbed.M` 底下（不再是頂層扁平 key）。

---

## 1. 摘要 / TL;DR

**舊 pipeline（`his/converter.py`）只讀 `getPatient/getLabResult/getAllMedicine/getAllOrder/getIpd/getOpd/getSurgery/getAIResult/getSO`，完全沒讀任何 `sb*` 與 `getICUbed`。** 這批新數據的 SMARTBED 護理紀錄與在床名單，把上一份 DB 邊界文件裡標成「純手動（HIS 無此資料）」的**身高、體重、BMI、床號、unit、插管、氣切、食物過敏**全部變成**原始資料層已可自動取得**。

但兩件事要分清楚：
1. **資料層 vs pipeline 層**：這些欄位現在**在 snapshot 裡有值**（資料層 ✅），但**converter 尚未讀取**（pipeline ❌）。要真的「不用手動」需要動 `his/converter.py` + `snapshot_sync.py` 的 frozenset 歸類。見 §5。
2. **生命徵象（第二批新補）**：`getTPR` 提供 **HR/收縮壓/舒張壓/呼吸速率/體溫** 的每小時時間序列（10/10 病人，PULSE/BP/RR 有值率 96–98%）→ `vital_signs` 表大部分可自動化。**但仍缺 SpO2、etCO2、CVP、ICP、CPP**（getTPR 沒這些欄）。見 §3。
3. **仍然完全缺席的**：**呼吸器設定、脫離評估數值、藥物過敏** 這批仍無結構化來源（全域巢狀欄位掃描 0 命中），**仍需手動**。見 §3。

---

## 2. 缺口已補：原本手動、現在資料層可自動取得

「舊分類」= [`his-field-source-inventory`](./his-field-source-inventory-2026-07-21.md) 的判定。填充率 = 有值病人數 / 10（實測）。

| DB 欄位 | 舊分類 | 新來源（snapshot key.field） | 填充率 | 陷阱（改前必看） |
|---|---|---|---|---|
| `patients.height` | 純手動 | `sbNutrition.BODY_HEIGHT` | **10/10** | 單位 cm 字串；逐序號可能多列，取當次住院序號那筆 |
| `patients.weight` | 純手動 | `sbNutrition.BODY_WEIGHT` | **10/10** | kg 字串；ICU 體重會變動，屬入院評估值 |
| `patients.bmi` | 系統衍生 | `sbNutrition.BMI` | **10/10** | **來源已算好**（如 61203771=11.3 惡病質，與 dx `R64` 自洽）；可直接用或用 H/W 重算交叉核對 |
| `patients.bed_number` | 純手動 | `getICUbed.BED_CODE`（**過濾 `PAT_NO==資料夾MRN`**） | **10/10** | `getICUbed` 一份含**全 10 位 cohort 床位**，不過濾會拿到別人床（隱私+錯配，見 snapshot §6）；值如 `MICU11` |
| `patients.unit` | 灰色(硬蓋ICU) | `getICUbed.BED_CODE` 前綴推導 | **10/10** | 全批皆 `MICU*`→ 內科 ICU；可取代 converter 硬編碼 `'ICU'`（TRAP #1）。多院區床位前綴 MICU/FICU/GICU/HICU/Q03I |
| `patients.intubated` | 純手動 | `sbTube` 有 `PIPE_ALIASES` 前綴 `Endo_`（氣管內管） | 結構化 | 見 §2.1 氣道判定表；`Endo`=經口插管 |
| `patients.tracheostomy` | 純手動 | `sbTube` 有 `PIPE_ALIASES` 前綴 `Tr_`（氣切） | 結構化 | 同上；`Tr`=氣切套管 |
| `patients.tracheostomy_date` | 純手動(raw SQL) | 對應 `Tr_*` 列的 `sbTube.PUT_DATE` | 結構化 | 民國7碼；只有帶氣切管的病人有 |
| `patients.allergies` | 灰色(SOAP解析) | `sbDisease.FOOD_ALLERGY`（`Smartbed.M` 底下） | **1/10** | **只有食物過敏、無藥物過敏欄**；`''`/`None`=「無/未記錄」難分（snapshot §4 坑）；比 SOAP 解析結構化但覆蓋稀疏 |
| `clinical_scores`(pain) | 純手動 | `sbPain.PAIN_NUMBER`（0–10） | 4/10 | 4 位有記錄；可落地成 pain score |
| `vital_signs.heart_rate` | 純手動 | **`getTPR_AllPatientSeq` › PULSE**（第二批新增） | **10/10**（98% 列有值） | 每小時時間序列（31–1405 列/人）；seq 信封形狀，讀法同 getSO；**跳過整列 null**（如 51026898 最新列全 null） |
| `vital_signs.systolic_bp` | 純手動 | `getTPR.SYSTOLICBP` | **10/10**（98%） | 同上 |
| `vital_signs.diastolic_bp` | 純手動 | `getTPR.DIASTOLICBP` | **10/10**（98%） | 同上；`mean_bp` 可由 SBP/DBP 計算 |
| `vital_signs.respiratory_rate` | 純手動 | `getTPR.RESPIRATIONRATE` | **10/10**（96%） | 同上 |
| `vital_signs.temperature` | 純手動 | `getTPR.TEMPERATURE` | **10/10**（38% 列） | 體溫 q4h 非每小時，故單列有值率低但每人皆有；字串 `37.1` |
| `vital_signs.body_weight` | 純手動 | `sbNutrition.BODY_WEIGHT`（同 `patients.weight`） | 10/10 | 入院評估值，非每日 |

### 2.1 氣道狀態逐病人判定（`sbTube` 實測）

| MRN | 床號 | 氣道管路 | → intubated | → tracheostomy |
|---|---|---|---|---|
| 30546132 | MICU11 | Endo_1 | ✅ | — |
| 30894771 | MICU01 | （無氣道管） | — | — |
| 50080536 | MICU08 | Endo_1 | ✅ | — |
| 50140472 | MICU07 | （無氣道管） | — | — |
| 50153753 | MICU05 | （無氣道管） | — | — |
| 50669055 | MICU17 | Tr_1 | — | ✅ |
| 51026898 | MICU09 | Tr_1 | — | ✅ |
| 61203771 | MICU10 | （無氣道管） | — | — |
| 68073820 | MICU02 | Endo_1 | ✅ | — |
| 76057548 | MICU16 | Endo_1 | ✅ | — |

> `Endo`/`Tr` 是乾淨的二選一氣道訊號（無同時出現），比手動勾選可靠。其餘管路（NG 鼻胃管、Foley 尿管、CVC/PICC 中心靜脈、IV Catheter）為 §4 全新可建模資料。

---

## 3. 缺口未補：仍需手動（第二批也沒有）

**確認方法（2026-07-21 第二批再驗）**：對**全部來源（含巢狀 `Factories`/`Smartbed`）× 10 病人的所有欄位名**跑 regex（SpO2/呼吸器/脫離/藥物過敏/etCO2·CVP·ICP 五組）。結論：以下**結構化數值**確認 0 命中、仍缺，維持 [`his-field-source-inventory`](./his-field-source-inventory-2026-07-21.md) 的「純手動」判定：

| DB 表/欄 | 判定 | 全域欄位名掃描 |
|---|---|---|
| `vital_signs`：**SpO2、etCO2、CVP、ICP、CPP** | ⚠️ 仍缺（其餘 5 項已由 getTPR 補上，見 §2） | `SPO2/血氧` 0 命中、`etCO2/CVP/ICP/CPP` 0 命中；`getTPR` 只有 T/P/R/BP，**無血氧與侵入性壓力** |
| `ventilator_settings`（mode/FiO2/PEEP/TV/…） | ❌ 仍缺 | 呼吸器參數欄位名 0；只有 `getAllOrder.NOTES` 自由文字 `on ventilator`/`on BiPAP`（知道有沒有上機，無參數） |
| `weaning_assessments`（RSBI/NIF/VT/…） | ❌ 仍缺 | 數值欄位名 0；只有醫囑**事件** `extubation of ETT`/`try ventilator weaning`；create endpoint 本身也無 body 參數（既有 bug） |
| `patients.allergies`（**藥物**過敏） | ❌ 仍缺 | 藥物過敏欄位名 0；`sbDisease` 只有 `FOOD_ALLERGY`(_NONE/_OTHER)+PAST/SURGERY/TUMOR_HISTORY，無藥物過敏欄；線索只散在 SOAP `SUBJECTIVE` 自由文字 |

> **生命徵象大翻轉**：第一批完全缺席；**第二批 `getTPR` 補上 HR/BP/RR/體溫 每小時時間序列**（§2）。但 **SpO2 仍不在 `getTPR`** —— 血氧、etCO2、CVP、ICP 這些仍在護理/監視系統，未進 HIS snapshot。

### 3.1 弱訊號（無結構化數值，但可做狀態/事件標記）

| 訊號 | 來源 | 能做什麼 / 不能做什麼 |
|---|---|---|
| 呼吸器 **on/off 狀態** | `getAllOrder.NOTES` 含 `on ventilator`/`on BiPAP` | 可標「使用中」旗標；**不能**得 mode/FiO2/PEEP/TV |
| **ECG 間期值** | `getAIResult.REPORT_CONTENT` 結構化 JSON（`PR`/心率等） | episodic ECG 判讀值，可取心率快照；**非**連續趨勢（現已有 getTPR 連續心率，此為輔助） |
| **拔管/脫離事件** | `getAllOrder`（`extubation of ETT`/`weaning`） | 可做 timeline 事件；**非** RSBI/NIF 評估分數 |

### 3.1 掃描順帶挖到的弱訊號（無結構化數值，但可做狀態/事件標記）

| 訊號 | 來源 | 能做什麼 / 不能做什麼 |
|---|---|---|
| 呼吸器 **on/off 狀態** | `getAllOrder.NOTES` 含 `on ventilator`/`on BiPAP` | 可標「使用中」旗標；**不能**得 mode/FiO2/PEEP/TV |
| **ECG 間期值** | `getAIResult.REPORT_CONTENT` 結構化 JSON（`PR`/心率等） | episodic ECG 判讀值，可取心率快照；**非**連續趨勢 |
| **拔管/脫離事件** | `getAllOrder`（`extubation of ETT`/`weaning`） | 可做 timeline 事件；**非** RSBI/NIF 評估分數 |

---

## 4. 附帶紅利：全新臨床資料（原本 DB 沒建模）

這批 SMARTBED 還帶來原本 ChatICU DB 完全沒有、但臨床有用的結構化資料，屬「可新增功能」而非「補手動缺口」：

| 來源 | 內容 | 填充率 | 可能落點 |
|---|---|---|---|
| `sbDisease.PAST_HISTORY` | 過去病史（高血壓/糖尿病/中風/惡性腫瘤…逗號分隔） | **10/10** | 病人背景 / AI context / alerts |
| `sbDisease.TUMOR_HISTORY` / `SURGERY_HISTORY_OTHER` | 腫瘤史 / 手術史自由文字 | 2/10、6/10 | 同上（注意 `SURGERY_HISTORY_NONE` 名實相反，snapshot §4.138） |
| `sbNutrition.MUST` | 營養不良篩檢分數 | 10/10 | clinical_scores 類 |
| `sbFall.TOTAL_SCORE` | 跌倒風險（**非 Morse**，snapshot §4.137） | 10/10 | 護理風險指標 |
| `sbIO.AMOUNT` | 輸出入量（in/out） | 10/10 | 液體平衡（近似 vital 缺口的替代） |
| `sbLimit.FMS_ORD_TXT` | 約束醫囑 | 10/10 | 安全/照護標記 |
| `sbTube`（NG/Foley/CVC/PICC/IV） | 完整管路留置清單 + 尺寸/深度/置入日 | 10/10 | 管路照護 / 感染風險天數 |
| `sbWound` | 傷口部位/屬性 | 6/10 | 傷口照護 |
| `sbDischargeEval` | 出院準備篩檢 | 6/10 | 出院規劃 |

---

## 5. Pipeline 接線狀態

### 5.1 ✅ 已完成（2026-07-21，patient 欄位 + 新格式 loader）

**Loader（`app/fhir/his/snapshot_io.py`）**：新增 `ALL_MERGED.json` 作為**最後備援來源**——扁平檔存在時仍優先（production flat/hourly-flat 行為零改變），巢狀 `Factories/`+`Smartbed/` 版面因無扁平檔而落到 ALL_MERGED。另加 `load_smartbed()`（讀 `Smartbed.<院區>.sbX`）與 `load_seq()`（讀 `<tool>_AllPatientSeq` 信封，含 getSO/getTPR）。**這一步同時修好了「新格式下連既有來源都讀不到」的破口。**

**converter（`app/fhir/his/converter.py`）**：`convert_patient()` 已接：
- `getICUbed`（過濾 `PAT_NO`）→ `bed_number`
- `sbNutrition` → `height` / `weight` / `bmi`（來源字串轉 float，BMI 用來源預算值）
- `sbTube`（掃 `PIPE_ALIASES`）→ `intubated`（`Endo*`）、`tracheostomy` + `tracheostomy_date`（`Tr*`，濾掉 END_DATE 已過期的移除管路）
- `sbDisease.FOOD_ALLERGY` → `allergies`（在 `convert_all` **併入** getSO SOAP 解析，非取代）
- `_extract_allergies` 改走 loader（原本直接讀檔，新格式讀不到）

**歸類（無需改 frozenset）**：這些欄位都在 `PRESERVE_EXISTING_FIELDS`，converter 現在吐**真值** → `_is_meaningful` 給出「HIS 有值就覆蓋、HIS 沒值就保留手動」的安全語意，**零資料遺失**。故 slice 1 **不動 `snapshot_sync.py`**。

**驗證**：`tests/test_fhir/test_converter_nested_snapshot.py`（7 tests）+ 全 10 病人真實資料 smoke（bed/身高體重/氣道全對，meds/labs 也證明 loader 備援讓既有來源在新格式可讀）+ 全 fhir 套件 111 passed 無 regression。

**刻意延後**：
- `unit`：仍硬編碼 `'ICU'`（TRAP #1）。改讀 BED_CODE 前綴會改變 `unit` 值 → **牽動資料層存取控制**（unit-scoped 使用者可見範圍），需 PM 決策，未動。
- `50153753` SOAP 過敏被 `parse_allergy_texts` 解析成 `['denied']`（應為 NKA）——既有 allergy parser 品質問題，非本次引入，另案處理。

### 5.2 ✅ 已完成 — 生命徵象 `vital_signs`（getTPR）

決策（使用者拍板）：**保留手動、只 upsert HIS 列**。實作：
1. `convert_vital_signs()`（`converter.py`）：`getTPR_AllPatientSeq` 逐列 → vital_signs 列（heart_rate←PULSE、systolic/diastolic_bp、respiratory_rate←RESPIRATIONRATE、temperature；`mean_bp` 由 (SBP+2·DBP)/3 算；跳過整列 null；**確定性 id `vit_<hash(patient+時戳)>`**，同時戳的 HIS 重複列在 converter 就去重）。
2. `convert_all` 多吐 `vital_signs` key + summary `vital_signs_count`。
3. `snapshot_sync.sync_snapshot_into_session`：`upsert_records(session, "vital_signs", rows)`。`upsert_records` 是 `INSERT … ON CONFLICT(id) DO UPDATE`、**從不 DELETE** → HIS 列（`vit_*`）upsert，手動列（uuid）不同 id 空間、**永不被碰**（含 HIS 沒有的 SpO2）。歷史 HIS 讀數跨 sync 累積（時間序列）。
4. **不動 frozenset、不整表 replace**（避免洗掉手動 SpO2）。

**驗證**：`test_converter_nested_snapshot.py` 加 vitals 轉換 + 去重 + 跳空列 2 tests；`test_snapshot_sync_invariants.py::test_upsert_records_preserves_manual_vital_rows` 證手動 SpO2 列在 HIS upsert 後仍存活；全 10 病人真實 smoke（vitals 31–1401 列/人、MAP 計算正確、時戳台北→UTC 正確）。全套件 123 passed 無 regression。

**HIS 仍不供、vital_signs 表這些欄仍手動**：SpO2、etco2、cvp、icp、cpp（converter 不寫這幾欄 → 保持手動列的值）。

> ⚠️ 部署前：走 fresh-DB bootstrap + 本機容器驗收（`scripts/ops/verify_fresh_db_bootstrap.sh`）+ 一次真實 sync 驗 `tracheostomy_date`（raw-SQL 非 ORM 欄）與 vital_signs 寫入。**勿在本機點 HIS sync 按鈕**（直連 prod）。

---

## 6. 一句話結論

**資料層**：這批新數據把 **床號、unit、身高、體重、BMI、插管、氣切（含日期）、食物過敏、疼痛分數** 從「純手動」變成「可自動取得」，並附帶病史/管路/營養/跌倒/約束/傷口等全新結構化資料。
**仍手動**：**生命徵象、呼吸器設定、脫離評估、藥物過敏**。
**待辦**：converter 尚未讀 `sb*`/`getICUbed`，需接線 + 決定各欄「HIS 自動 vs 手動優先」的歸類（§5）。

---

## 附錄：驗證方式

本文所有填充率與樣本值由確定性全掃 10 位病人 `ALL_MERGED.json` 實測產生（非抽樣）；氣道判定表逐病人列出 `sbTube.PIPE_ALIASES`；缺席欄位以 6 個候選來源鍵探針確認 0/10。日期 2026-07-21。
