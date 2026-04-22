# FHIR Standardization Baseline Report (PR-0)

生成時間：2026-04-22T16:10:39.781597+00:00

來源：Supabase production (ap-southeast-2) via `backend/.env.his-sync`

---

## 對照表檔案規模

| 檔案 | 筆數 | 角色 |
|------|-----:|------|
| **`backend/app/fhir/code_maps/drug_formulary.csv`** | **1622** | **PRIMARY（院區形成品 + ABX + 手動補碼）** |
| `FHIR功能/藥物標準化/atc_drugs.csv`（舊 baseline 用） | 141 | 多半已被 formulary 包含，保留做 `kidney_relevant` 參考 |
| `FHIR功能/lab轉FHIR/loinc_labs.csv` | 96 | 交集 < 30%，不採用 |
| `backend/app/fhir/his_ddi_alias_map.json` | 65 | DDI 名稱對齊（暫留） |
| `backend/app/fhir/his_ddi_exclusion_list.json` | 19 | 非藥物排除（維持） |
| `backend/app/fhir/his_lab_mapping.HIS_LAB_MAP` | 394 | 本院 LAB_CODE → ChatICU key |

## DB 規模

| 指標 | 值 |
|------|---:|
| `medications` 總筆數 | 1510 |
| 有 medications 的病人數 | 11 |
| `drug_interactions` 中的唯一藥對數 | 8756 |

---

## Q1：藥物標準碼命中率（ODR_CODE → drug_formulary.csv）

| 指標 | 值 |
|------|---:|
| 有 `order_code` 的 medications 列數 | 1459 |
| distinct ODR_CODE 數 | 223 |
| distinct 命中 drug_formulary.csv（含 ATC） | 212 (95.1%) |
| 以列為權重計算的命中 | 1415 (97.0%) |

**判讀**：

- 列權重命中率 ≥ 70%，**可直接進 PR-3**。

## Q2：Top-30 未命中 ODR_CODE（依出現頻率）

| # | ODR_CODE | 樣本名稱 | 筆數 | 病人數 | 在 exclusion? | 在 DDI alias? |
|--:|----------|---------|-----:|------:|:------------:|:------------:|
| 1 | `ITEIC2` | Teiconin 400mg inj(抗3)(Teicoplanin) | 7 | 1 |  |  |
| 2 | `IGENT1` | Gentamycin 80mg/2ml inj*(Gentamicin) | 7 | 2 |  | ✓ |
| 3 | `ICEFE4` | Cefe 2000mg (抗2) inj (Cefmetazole) | 7 | 1 |  |  |
| 4 | `ICOLI1N` | COLimycin 2000000IU inj (抗4)(Colistin) | 5 | 2 |  | ✓ |
| 5 | `ODIFL1` | Diflucan 50mg (抗3) (Fluconazole) | 5 | 1 |  |  |
| 6 | `ICYME2` | Cymevene 500mg inj(抗3)(Ganciclovir) | 3 | 1 |  | ✓ |
| 7 | `IBOBI1` | Bobimixyn 500000IU inj (抗4)(Polymyxin B) | 3 | 1 |  |  |
| 8 | `ICETA2` | Cetaxime 2gm inj (抗3)(Cefotaxime) | 3 | 1 |  |  |
| 9 | `IZYVO1` | Zyvox 600mg/300ml inj(抗4)(Linezolid) | 2 | 1 |  |  |
| 10 | `IMENO2` | Menocik 100mg inj.(抗4) (Minocycline) | 1 | 1 |  | ✓ |
| 11 | `OPARA2` | Paraflex 500mg cap(Cephalexin) | 1 | 1 |  |  |

- Top-30 中屬於 DDI exclusion（非藥物）：0 筆
- Top-30 中已在 DDI alias 內（有藥名但無 ATC）：4 筆

**擴表 backlog**：上表扣除 exclusion 後的項目，請在 `backend/app/fhir/code_maps/drug_formulary_gaps.csv` 的 `suggested_atc` 欄位填入 ATC，然後重跑 `build_formulary_csv.py` 合併。

## Q3：Lab 標準碼命中率（HIS_LAB_MAP ∩ loinc_labs.csv）

| 指標 | 值 |
|------|---:|
| HIS_LAB_MAP 總 LAB_CODE 數 | 394 |
| loinc_labs.csv 總 LAB_CODE 數 | 96 |
| 交集（可直接對到 LOINC） | 87 (22.1%) |

**判讀**：

- 交集 < 30%，`loinc_labs.csv` 對本院 LAB_CODE 意義不大。直接用 `loinc_map.py` 現成的 ChatICU key 對應即可。

## Q4：現行 DDI 命中基準

| 指標 | 值 |
|------|---:|
| 有 active 藥的病人數 | 10 |
| active 藥對（unique pair，已拆組合藥）總數 | 1520 |
| DDI 表中 unique 藥對數 | 8756 |
| DDI 表中 unique 藥名數 | 2166 |
| **production 現行命中（case-sensitive 精確比對）** | **0 (0.0%)** |
| 若改 case-insensitive 比對可命中 | 0 (0.0%) |
| **若在 query time 套用 `his_ddi_alias_map.json` 後可命中** | **0 (0.0%)** |
| 每位病人平均藥對數 | 152.0 |

### Active 藥的 ODR_CODE 分布

| 指標 | 筆數 | 佔 active 藥 |
|------|----:|-----------:|
| active 藥總列數 | 198 | 100% |
| ODR_CODE 在 `his_ddi_alias_map.json` 中 | 32 | 16.2% |
| ODR_CODE 不在 alias map 中 | 127 | 64.1% |
| 無 ODR_CODE | 39 | 19.7% |
| ODR_CODE 在 `atc_drugs.csv` 中 | 159 | 80.3% |

> **重大發現：production 現行 DDI 比對全滅（0 命中）**。
>
> 進一步驗證 3 種策略都是 0：
> - case-sensitive exact（production 現況）：0
> - case-insensitive（簡單 fix）：0
> - 套用 `his_ddi_alias_map.json`（理論上把 ODR_CODE → clean generic）：0
>
> 我已驗證 alias map 的 50 個乾淨 generic 中，**51 個確實存在於 `drug_interactions.drug1/drug2`**（覆蓋 OK）。但實際 active 藥對的**組合**（e.g. {Fentanyl, Neuromuscular-Blocking Agents}）在 DDI 表**沒有 entry**。
>
> **真正的根因**：`drug_interactions` 表的 8,756 條藥對是通用藥典，但本院 ICU 實際用藥組合（鎮痛鎮靜 + 抗生素 + 支持療法）和表中藥對的交集極小。
>
> 因此 FHIR ATC 標準化只是**必要不充分條件**。光加 ATC 欄位不能修好 DDI，還要：
> - (a) 用 ATC class 去圖查 `drug_graph_bridge.py` 的 class node（現有機制，未串到 DDI）
> - (b) 或擴 `drug_interactions` 加 ATC 欄 + class-level 藥對規則
> - (c) 或改用外部 DDI 服務（Lexicomp/DrugBank API）

### Active 藥組分中，可直接對到 DDI 表的藥名

- case-sensitive 能直接對到：**25** 種
  - 前 20：`Acetaminophen`, `Acetylcysteine`, `Avibactam`, `Azilsartan`, `Budesonide (Oral Inhalation)`, `Cephalosporins`, `Colistimethate`, `DOPamine`, `EPINEPHrine (Systemic)`, `FentaNYL`, `Formoterol`, `Furosemide`, `Insulin`, `Lactulose`, `Levothyroxine`, `Lidocaine (Systemic)`, `Magnesium Sulfate`, `MethylPREDNISolone (Systemic)`, `Midazolam`, `Morphine (Systemic)`
- case-insensitive 能對到：**29** 種
  - 前 20：`acetaminophen`, `acetylcysteine`, `avibactam`, `azilsartan`, `budesonide (oral inhalation)`, `ceftazidime`, `cephalosporins`, `colistimethate`, `diphenhydramine (systemic)`, `dopamine`, `epinephrine (systemic)`, `fentanyl`, `formoterol`, `furosemide`, `insulin`, `lactulose`, `levetiracetam`, `levothyroxine`, `lidocaine (systemic)`, `magnesium sulfate`

### 各病人明細（藥對數前 10）

| patient_id | active 藥組分 | 藥對數 | 現行 exact | lower | **alias 套用** | ATC 雙邊覆蓋 |
|-----------|--------------:|-----:|----------:|-----:|------------:|-----------:|
| `pat_46185343` | 33 | 378 | 0 | 0 | **0** | 378 |
| `pat_26290720` | 40 | 378 | 0 | 0 | **0** | 378 |
| `pat_40812ab1` | 28 | 253 | 0 | 0 | **0** | 253 |
| `pat_f09355f8` | 19 | 136 | 0 | 0 | **0** | 136 |
| `pat_ed7bc912` | 25 | 105 | 0 | 0 | **0** | 105 |
| `pat_a86cb503` | 17 | 91 | 0 | 0 | **0** | 91 |
| `pat_001` | 13 | 78 | 0 | 0 | **0** | 0 |
| `pat_002` | 10 | 45 | 0 | 0 | **0** | 0 |
| `pat_003` | 8 | 28 | 0 | 0 | **0** | 0 |
| `pat_004` | 8 | 28 | 0 | 0 | **0** | 0 |

## Q5：若 DB 有 ATC 欄位，可做 ATC-based 分析的藥對上限

（「ATC 雙邊覆蓋」＝兩個藥的 ODR_CODE 都在 `atc_drugs.csv` 命中 → 都可指派 ATC 代碼）

| 指標 | 值 |
|------|---:|
| 可對 ATC 的藥對總數 | 1341 |
| ATC 覆蓋率（藥對權重） | 88.2% |
| 字串比對 DDI 命中率（exact） | 0.0% |
| 字串比對 DDI 命中率（lower） | 0.0% |

**判讀**：

- ATC 上限 (88.2%) 遠高於最佳 case 現行 (0.0%)，PR-3 切 ATC 比對後 DDI 命中可望大幅增加。

> 注意：`drug_interactions` 表以藥名字串索引，並沒有 ATC 欄位。要真的切 ATC 比對需：(a) 擴 `drug_interactions` 新增 ATC 欄、(b) 或改用「ATC 同類 → 查 class node」的圖查詢。此 Q5 只反映「ATC 標準碼的覆蓋能力」，不是立即可啟動的開關。

## Q6：對照表收斂可行性（ddi_alias vs atc_drugs）

| 指標 | 值 |
|------|---:|
| `his_ddi_alias_map.json` ODR_CODE 數 | 65 |
| `atc_drugs.csv` ODR_CODE 數 | 1622 |
| 交集 | 60 |
| DB 有此 ODR_CODE 且被 alias map 覆蓋 | 59 (26.5%) |

### 只在 DDI alias 但不在 atc_drugs（前 20）

- `ICOLI1N`
- `ICYME2`
- `IGENT1`
- `IMENO2`
- `ODEXA2`

### 只在 atc_drugs 但不在 DDI alias（前 20）

- `09021`
- `09022`
- `EALCA1`
- `EALLE1`
- `EALMI2`
- `EALPH2`
- `EANZO1`
- `EARTE1`
- `EAZAR1`
- `EAZOP1`
- `EBETA1`
- `ECILO1`
- `ECOSO1`
- `ECRAV1`
- `EDEVI1`
- `EDIQU1`
- `EDUOT1`
- `EDURA1`
- `EECON1`
- `EEMEN1`

---

## 下一步建議（基於實測）

### 已知事實

- Q1 ODR→ATC 列權重命中率 **97.0%**，atc_drugs.csv 對現有資料覆蓋合格
- Q3 HIS LAB_CODE→loinc_labs.csv 交集僅 **22.1%**，`loinc_labs.csv` 對本院幫助有限；原計畫 PR-3 的 Lab 段**改用既有 `his_lab_mapping.py` + `loinc_map.py` 二段對應**即可
- Q4 DDI production 命中 **0**，原因不是字串格式（alias 套用也 0），是 **DDI 表缺 ICU 實際用藥組合的 entry**
- Q5 ATC 藥對覆蓋 **88.2%**，遠高於現行 0%，但要真的啟動需擴 `drug_interactions` 或接圖查詢
- Q6 `his_ddi_alias_map.json` 與 `atc_drugs.csv` 只交集 **60** 條，兩表有收斂空間

### 修正後的計畫

原 PR-1~5 計畫需**調整優先順序**。

**立即做（不等 FHIR 整合）**：

- **決策點 D1**：DDI 系統目前靜默失效，要不要先獨立修？
  - 選項 A：先不修，接受現狀；FHIR 整合完成後再一起處理（保留 2-4 週風險窗口）
  - 選項 B：在 FHIR 前插一個 hotfix PR，至少做「name token 正規化 + 套 alias map」讓可能的 51 個 match 先啟動 — 但本次實測證明這條路命中仍是 0，所以效益可能是 0
  - 選項 C：做 DDI 重建 — 給 `drug_interactions` 加 ATC 欄位、seed 一批 ATC class-level 規則，再改 query 走 ATC 比對（工時 1-2 天）

**FHIR 整合原計畫調整**：

1. **PR-1（維持）**：搬 `atc_drugs.csv` 到 `backend/app/fhir/code_maps/`，寫 `atc_map()`。**放棄搬 `loinc_labs.csv`**（Q3 證明效益有限）。
2. **PR-2（維持）**：RxNorm cache-only 模式
3. **PR-3（調整）**：`medications` 加 ATC 欄位、`lab_data` 的 JSONB 補 LOINC（但 LOINC 來源改用 `loinc_map.py`）
4. **PR-3.5（新增）**：解決選項 C — DDI 改用 ATC 比對；這才是 Q4=0 的真正解法
5. **PR-4（維持）**：Coverage report
6. **PR-5（降低優先）**：On-demand Bundle export — 有 ATC/LOINC 之後自然可做，但非緊急

**先擴 `atc_drugs.csv` 的優先項**（依 Q2 top-30 × 病人覆蓋）：

- 前 5 名（不在 exclusion、不在 DDI alias）：`OKEPP1`（Keppra/Levetiracetam）、`OMOSA3`（Mosapride）、`OPLAV1`（Clopidogrel）、`OBISO4`（Bisoprolol）、`OSHEC1`（Bromhexine）
- 前 6 名（已在 DDI alias，補 ATC 即可對齊兩表）：`ICRAV2`（Levofloxacin）、`ICOLI1`（Colistin）、`IGENT1`（Gentamicin）、`INIMB1`（Cisatracurium）、`OEDAR1`（Azilsartan）、`ICOLI1N`（Colistin）

---

**重跑方式**：

```bash
export SYNC_ENV_PATH=/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/.env.his-sync
python3 /Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/scripts/fhir_baseline_audit.py
```
