# DDI 藥物交互作用系統維護手冊

## 架構概覽

```
HIS getAllMedicine.json (ODR_CODE + ODR_NAME)
        ↓
  his_converter.py
  ├─ his_ddi_alias_map.json     ← 品牌名/縮寫 → DDI DB 學名
  └─ his_ddi_exclusion_list.json ← 點滴液/輔助品 → 排除 DDI 分析
        ↓
  Medication.generic_name (資料庫欄位)
        ↓
  ddi_check.py → drug_graph_bridge → drug_interactions 資料表
        ↓
  前端顯示交互作用警示
```

## 設定檔位置

| 檔案 | 路徑 | 說明 |
|------|------|------|
| 別名對照表 | `backend/app/fhir/his_ddi_alias_map.json` | ODR_CODE → DDI DB 藥名 |
| 排除清單 | `backend/app/fhir/his_ddi_exclusion_list.json` | 點滴/輔助品排除 |
| 院所設定 | `backend/app/fhir/his_site_config.json` | ICU 內科醫師名單 |
| DDI 資料庫 | `backend/seeds/drug_interactions_full.json` | 8,775 筆交互作用 |

---

## 情境 1：新藥物進來，DDI 查詢沒有結果

### 症狀
病患用藥列表有某藥，但交互作用頁面查無資料。

### 診斷步驟

```bash
# 1. 確認藥物的 ODR_CODE 和 ODR_NAME
# 從 patient/*/getAllMedicine.json 找

# 2. 確認 DDI 資料庫有沒有這個藥
python3 -c "
import json
with open('backend/seeds/drug_interactions_full.json') as f:
    ddi = json.load(f)
drugs = set(r['drug1'] for r in ddi) | set(r['drug2'] for r in ddi)
term = '你的藥名'
print([d for d in drugs if term.lower() in d.lower()])
"
```

### 處理方式

**情況 A：DDI 資料庫有這個藥，只是名字不對**

在 `his_ddi_alias_map.json` 新增一行：

```json
"ODR_CODE": ["DDI資料庫中的正確藥名"]
```

注意：藥名必須完全符合 DDI 資料庫的大小寫（含 TALL MAN 字母，如 `FentaNYL`）。

組合藥（如氨苄西林+舒巴坦）填陣列：
```json
"IAMSU1": ["Ampicillin", "Sulbactam"]
```

**情況 B：DDI 資料庫完全沒有這個藥**

這是資料缺口（Category E），目前無法自動處理。可從 [Drugs.com](https://www.drugs.com/drug_interactions.html) 或 Micromedex 手動查詢後補充資料庫。

---

## 情境 2：新增藥物到別名對照表後套用

```bash
# 1. 編輯 his_ddi_alias_map.json，新增對應

# 2. 重新匯入所有 HIS 病患
cd backend
python3 scripts/import_his_patients.py

# 如果只要更新單一病患
python3 scripts/import_his_patients.py -p 50067505
```

---

## 情境 3：新藥物是點滴液或輔助品，想排除 DDI 分析

在 `his_ddi_exclusion_list.json` 的 `exclusions` 陣列加入：

```json
{
  "odr_code": "INEW1",
  "name": "新點滴液 500mL",
  "reason": "葡萄糖點滴，無DDI臨床意義"
}
```

然後重新匯入：
```bash
python3 scripts/import_his_patients.py
```

---

## 情境 4：確認目前匹配率

```bash
cd backend
python3 - << 'EOF'
import json, glob, re
from collections import Counter

with open('seeds/drug_interactions_full.json') as f:
    ddi = json.load(f)
ddi_drugs = set(r['drug1'].lower() for r in ddi) | set(r['drug2'].lower() for r in ddi)

with open('app/fhir/his_ddi_alias_map.json') as f:
    alias = {k: v for k, v in json.load(f).items() if not k.startswith('_')}

with open('app/fhir/his_ddi_exclusion_list.json') as f:
    exclusion = {e['odr_code'] for e in json.load(f)['exclusions']}

# Count from all patients
his_drugs = {}
for f in glob.glob('../patient/*/getAllMedicine.json'):
    d = json.load(open(f))
    for r in (d.get('Data', []) if isinstance(d, dict) else []):
        code = r.get('ODR_CODE', '').strip()
        if code and code not in his_drugs:
            his_drugs[code] = r.get('ODR_NAME', '')

total = len(his_drugs)
excluded = sum(1 for c in his_drugs if c in exclusion)
aliased = sum(1 for c in his_drugs if c in alias)
# ... (simplified)
print(f"總藥物種類: {total}")
print(f"排除（點滴/輔助品）: {excluded}")
print(f"透過 alias map 對應: {aliased}")
EOF
```

---

## 檔案格式參考

### his_ddi_alias_map.json

```json
{
  "_comment": "說明文字（以 _ 開頭的 key 會被程式忽略）",
  "ODR_CODE": ["DDI_DB_藥名"],
  "ODR_CODE_2": ["藥名A", "藥名B"]
}
```

### his_ddi_exclusion_list.json

```json
{
  "exclusions": [
    {
      "odr_code": "ODR_CODE",
      "name": "顯示名稱",
      "reason": "排除原因"
    }
  ]
}
```

---

## 目前 DDI 匹配率（2026-04）

| 狀態 | 數量 | 說明 |
|------|------|------|
| 自動匹配（學名提取） | 166 種 | regex 從括號提取學名 |
| alias map 對應 | 26 種 | 品牌名/縮寫/組合藥 |
| 排除（非藥物） | 14 種 | 點滴液、輔助品 |
| DDI DB 缺漏（Cat E） | 50 種 | 需補充資料庫 |
| **有效匹配率** | **~77%** | 持續改善中 |

---

## 聯絡資訊

- 系統維護：後端工程師
- DDI 資料來源：Micromedex DrugDex / Drugs.com
- 問題回報：GitHub Issues
