# Lexicomp X/D 升級紀錄（2026-04-28）

## 目的

把逆轉腎 agent 那份 Lexicomp 完整 DDI dump 中、Supabase **沒有覆蓋**的 X / D 高風險規則補進線上 `drug_interactions` 表，**不動既有 C / B / A 資料**。

## 來源

- 路徑：`/Users/chun/Desktop/逆轉腎agent/knowledge_base/drug_database/api/交互作用/interactions/`
- 結構：每個成分一資料夾 × 5 風險檔（`{drug}_X.json`、`_D.json` …）
- 規模：2,290 個藥物資料夾、4,511 個 X/D unique pairs（按 `detail_url` 去重）

## 對照前資料量

| 來源 | X | D | C | B | A | 總計 |
|---|---:|---:|---:|---:|---:|---:|
| Supabase（升級前）| 1,474 | 1,915 | 4,195 | 1,185 | 13 | 8,786 |
| Lexicomp dump (X/D only) | 2,082 | 2,428 | — | — | — | 4,510 |
| 既有 seed `ddi_xd_only.json.gz` | 1,019 | 1,504 | — | — | — | 2,523 |

## 升級腳本

`backend/scripts/upgrade_xd_from_lexicomp.py`

### 過濾流程
1. **strict 比對** — Lexicomp 的 `dedup_key` = `'||'.join(sorted([d1.lower(), d2.lower()]))`，與 Supabase `dedup_key` 直接比。
2. **loose 比對** — 把 `(...)` 描述詞剝掉再比，避免「Calcium Channel Blockers (Nondihydropyridine)」與「Calcium Channel Blockers」誤判。
3. **class 展開比對** — 把 Supabase 含 `interacting_members` 的 class 規則展開成個別藥對（共 79,512 對），Lexicomp 凡命中即視為已涵蓋。
4. **Lexicomp 內部去重** — 同 dedup_key 多 detail_url 取首條。

### Synonym map
```python
SYNONYM_MAP = {
    "Acetylsalicylic Acid (Aspirin)": "Aspirin",
    "Acetylsalicylic Acid": "Aspirin",
}
```
其餘 Lexicomp 名稱保留原樣（如 `Rifampicin (RifAMPin)`、`Fluphenazine Decanoate (FluPHENAZine)`）。

### 欄位映射

| Supabase 欄位 | Lexicomp 來源 |
|---|---|
| `id` | `"ddi_" + sha1(dedup_key)[:12]` |
| `drug1` / `drug2` | `query_drug` / `interacting_drug`（過 SYNONYM_MAP）|
| `severity` | `X→contraindicated`, `D→major` |
| `risk_rating` | `X` 或 `D` |
| `risk_rating_description` | `Avoid combination` / `Consider therapy modification` |
| `severity_label` | `detail.severity` |
| `reliability_rating` | `detail.reliability` |
| `mechanism` / `clinical_effect` | `detail.summary` |
| `management` | `detail.patient_management` |
| `discussion` | `detail.discussion` |
| `footnotes` | `detail.footnotes` join `\n` |
| `references` | `'Lexicomp 2026'` ← 升級標記 |
| `dedup_key` | `'||'.join(sorted([d1.lower(), d2.lower()]))` |
| `body_hash` | `md5(mechanism + management + summary)` |
| `interacting_members` | `NULL`（Lexicomp 是個別藥對，無 class 展開）|
| `dependencies` / `dependency_types` / `pubmed_ids` | `NULL` |
| `drug1_atc` / `drug2_atc` | `NULL`（後續 backfill）|

### 寫入
- `INSERT ... ON CONFLICT (id) DO NOTHING` — 既有 row 0 影響
- 200 / batch，每 batch 一個 transaction
- 跑前需設 `CONFIRM_APPLY=YES` 環境變數

## 執行紀錄

```bash
# 1. dry-run（看 candidates）
python3 backend/scripts/upgrade_xd_from_lexicomp.py --dry-run

# 2. 實寫入
CONFIRM_APPLY=YES python3 backend/scripts/upgrade_xd_from_lexicomp.py --apply
```

### Skip 統計（dry-run）

| 原因 | 條數 |
|---|---:|
| 已被 Supabase class 規則涵蓋 | 1,910 |
| dedup_key 完全相同 | 1,041 |
| Lexicomp 內部重複 | 21 |
| strip-parens 後語意相同 | 15 |
| **小計（不寫入）** | **2,987** |
| **新寫入 candidates** | **1,524**（X=718, D=806）|

### Top 出現次數的新藥/類別
- 94 條：`Alcohol (Ethyl)`（藥-酒交互）
- 86 條：`Polymigel and Oxethazaine`（複方制酸）
- 83 條：`Grapefruit Juice`（CYP3A4 抑制）
- 73 條：`Fluphenazine Decanoate (FluPHENAZine)`（depot 抗精神病）
- 38 條：`St John's Wort`（CYP3A4 誘導）
- 33 條：`Erythromycin Ethylsuccinate`
- 23 條：`Rifampicin (RifAMPin)`、`Lopinavir`
- 18 條：`Nirmatrelvir and Ritonavir`（COVID 抗病毒）

## 升級後實際資料量（2026-04-28 12:56 台北）

| Risk | 升級前 | 升級後 | 增加 |
|---|---:|---:|---:|
| X | 1,474 | **2,191** | **+717** |
| D | 1,915 | **2,720** | **+805** |
| C | 4,195 | 4,195 | 0（不動 ✓）|
| B | 1,185 | 1,185 | 0（不動 ✓）|
| A | 13 | 13 | 0（不動 ✓）|
| **總計** | **8,786** | **10,308** | **+1,522** |

> Candidates 1,524 中有 2 條因 `ON CONFLICT (id) DO NOTHING` 跳過（同 hash 碰撞）。
> 已驗證：`SELECT COUNT(*) FROM drug_interactions WHERE "references"='Lexicomp 2026'` = 1,522。
> ⚠️ Verify 步驟原本因 `references` 為 PG 保留字未加引號崩潰，已修正（不影響 INSERT 結果）。

## 對前端 / API 影響

- `POST /api/v1/clinical/interactions`（用藥交互頁實際 endpoint）走兩兩配對 + ILIKE → 立即看得到新規則
- `GET /pharmacy/drug-interactions` 同樣讀同表
- 重複用藥 `DuplicateDetector.analyze()` 不依賴此表，無影響
- `medication_duplicate_cache` 不需失效

## ATC backfill（2026-04-28 同日完成）

跑 `backend/scripts/backfill_drug_interactions_atc.py` 補新插入 1,522 row 的 ATC：

| 項目 | 結果 |
|---|---:|
| Lexicomp row 中 drug1_atc 補上 | **358 / 1,522 (23.5%)** |
| Lexicomp row 中 drug2_atc 補上 | **225 / 1,522 (14.8%)** |
| 兩邊都補上 | **61 (4.0%)** |
| 兩邊都缺（新藥/罕見藥不在院內 formulary）| 1,000 (65.7%) |
| 既有 8,786 row 的 ATC（升級前已存在）| 沒被動到 ✓ |

樣本：
- `Trileptal (OXcarbazepine) [N03AF02] × Sofosbuvir [J05AP55]`
- `Citalopram [N06AB04] × Escitalopram [N06AB10]` ← 雙 SSRI
- `Ticlopidine [B01AC05] × Ticagrelor [B01AC]` ← 雙抗血小板

## 已知限制與後續工作

1. **語意重複未完全消除** — Lexicomp 全名「Rifampicin (RifAMPin)」與 Supabase 短名「RifAMPin」是不同 dedup_key，會並存。前端 ILIKE `%name%` 會同時找到，無功能影響但會佔行數。**後續可寫 cleanup script** 用 SYNONYM_MAP 擴充 + 去重。
2. **65.7% Lexicomp row 仍缺 ATC** — Lexicomp 多新藥（Mavorixafor、Adagrasib、Tildrakizumab 等）尚未進院內 formulary。後續若 formulary 更新，可再跑一次 backfill。
3. **interacting_members 為 NULL** — Lexicomp 是個別藥對，沒 class 群組資料；要轉成 class 規則需要額外的 ATC 群組對照表。

## 回退指令

```sql
-- 一鍵回退（只刪本次新增）
DELETE FROM drug_interactions WHERE references = 'Lexicomp 2026';
```

預期刪除筆數應與 INSERT 報告的 `inserted=N` 完全一致。
