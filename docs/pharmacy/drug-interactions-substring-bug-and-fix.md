# 用藥交互比對 — 子字串污染 Bug 與修正方案

> 撰寫日期：2026-05-06
> 觸發案例：I-16 傅壽曉，查藥物交互作用時，輸入藥單**沒有 methylprednisolone**，但結果中卻出現它；同一張查詢頁的「摘要」顯示 Risk C，最底下詳細卡片卻顯示 `CYP3A4 Inhibitors (Moderate) + PrednisoLONE (Systemic) Risk B`，兩處不一致。
> 結論：**結構性 bug**，並非個案。`prednisolone` 是 `methylprednisolone` 的字面子字串，整條比對 pipeline（後端 SQL → 後端 pair 驗證 → 前端摘要配對）全用「雙向 substring 包含」，沒有字邊界保護。同類問題會在 `cortisone ⊂ hydrocortisone`、`thyroxine ⊂ levothyroxine`、`salicylic ⊂ acetylsalicylic` 等命名上反覆出現。

---

## 1. 症狀

| 觀察 | 對應的內部現象 |
|---|---|
| 病患 I-16 自動帶入的藥單沒 methylprednisolone，但 result 出現 methylprednisolone | DB 有 `MethylPredniSOLONE (Systemic)` 為 drug1/drug2 的 row 被誤撈，或 row 的 `interacting_members` 群組成員列出 methylprednisolone，前端把整串 members 顯示出來 |
| 摘要顯示 Risk C，詳細卡片顯示 Risk B | 兩列不同 row 都被歸到同一個輸入對的摘要 key，摘要取「最嚴重」→ C；詳細卡片是 Risk B 那一列。Risk C 那一列其實是 methylprednisolone 列，誤撈進來 |
| 過往零星出現「不相干藥」 | 同一個結構性 bug 的不同表現 |

---

## 2. 根本原因 — 三個受污染點

整條鏈路上，**任何一處用了「雙向 substring 包含」當匹配條件**，子字串母字串都會互相吸進來。

### 2.1 受污染點 #1：後端 SQL 過濾（最上游）

兩支 endpoint 共用同款 helper：

```python
# backend/app/routers/clinical.py:840-847
# backend/app/routers/pharmacy_routes/interactions.py:27-37
def _drug_match_clause(drug_name: str):
    escaped = escape_like(drug_name)
    return or_(
        DrugInteraction.drug1.ilike(f"%{escaped}%"),
        DrugInteraction.drug2.ilike(f"%{escaped}%"),
        cast(DrugInteraction.interacting_members, SAString).ilike(f"%{escaped}%"),
    )
```

`ILIKE '%prednisolone%'` 會命中 `MethylPredniSOLONE (Systemic)`。

### 2.2 受污染點 #2：後端 `_pair_on_different_sides`

```python
# clinical.py:864-868
# pharmacy_routes/interactions.py:104-109
da_s1 = any(da_l in n or n in da_l for n in side1)
```

雙向 `in` —— `prednisolone in methylprednisolone (systemic)` 是 True，所以誤撈的 row 通過「不同邊」驗證。

### 2.3 受污染點 #3：前端摘要配對

```ts
// src/pages/pharmacy/interactions.tsx:407-411
for (const drug of validDrugs) {
  const dl = drug.toLowerCase();
  if (!matchA && side1.some(n => n.includes(dl) || dl.includes(n))) matchA = drug;
  if (!matchB && side2.some(n => n.includes(dl) || dl.includes(n))) matchB = drug;
}
```

兩列誤撈的 row 都被歸到同一個 `(prednisolone, <CYP3A4-drug>)` key，於是：

```ts
// interactions.tsx:416-423  取最嚴重者
if (curRisk < (ro[existing.risk] ?? 5)) existing.risk = item.riskRating;
```

→ 摘要顯示 Risk C，詳細區仍能看到 Risk B 卡片，產生不一致。

---

## 3. 為什麼是反覆出現的結構性問題

藥名子字串撞名在臨床命名很常見。只要還用 `ILIKE %X%`，只能仰賴運氣。範例：

| 母字串（會被誤撈） | 子字串（使用者實際查的） |
|---|---|
| `Methylprednisolone` | `Prednisolone` |
| `Hydrocortisone` | `Cortisone` |
| `Levothyroxine` | `Thyroxine` |
| `Norethindrone` | `Ethindrone` |
| `Dexamethasone` | `Methasone` |
| `Acetylsalicylic acid` | `Salicylic acid` |
| `Paracetamol` | `Acetam` |

---

## 4. 修正方案

### 4.1 推薦方案 A：字邊界比對（最小改動，立即見效）

**原理**：PostgreSQL POSIX regex 提供 `\m`（單字開頭）與 `\M`（單字結尾）。`\mprednisolone\M` 不會吃進 `methylprednisolone`，但仍可命中 `Prednisolone (Systemic)`（因為 `(` 是非單字字元，視為字邊界）。

> **⚠️ 重要陷阱（不能忽略）**：若藥名結尾本身就是非字元（例如 `Prednisolone (Systemic)` 結尾是 `)`），固定加 `\M` 會讓 pattern 連自己都對不上 —— 因為 `\M` 要求前一字元是 word，但 `)` 是 non-word。DRUG_LIST 中大量藥名以 `(Systemic)`、`(Oral)` 結尾，所以 pattern 必須**頭尾條件化**：頭/尾若是 word 字元才加 `\m` / `\M`，否則省略。

統一抽 helper：

```python
# backend/app/utils/response.py 或新檔 backend/app/utils/drug_match.py
import re

def word_boundary_pattern(name: str) -> str:
    """Build a POSIX regex pattern with word boundaries that adapts to non-word
    head/tail chars. E.g.:
      'prednisolone'           -> r'\mprednisolone\M'      (擋 methylprednisolone)
      'Prednisolone (Systemic)'-> r'\mPrednisolone \(Systemic\)'  (尾 ) 不加 \M)
      '5-Fluorouracil'         -> r'\m5\-Fluorouracil\M'
    """
    if not name:
        return ""
    escaped = re.escape(name)
    head = r"\m" if (name[0].isalnum() or name[0] == "_") else ""
    tail = r"\M" if (name[-1].isalnum() or name[-1] == "_") else ""
    return f"{head}{escaped}{tail}"
```

#### 改動點 1：`backend/app/routers/clinical.py` `_drug_match_clause`（行 840-847）

```python
# 改前
def _drug_match_clause(drug_name: str):
    escaped = escape_like(drug_name)
    return or_(
        DrugInteraction.drug1.ilike(f"%{escaped}%"),
        DrugInteraction.drug2.ilike(f"%{escaped}%"),
        cast(DrugInteraction.interacting_members, SAString).ilike(f"%{escaped}%"),
    )

# 改後
from app.utils.drug_match import word_boundary_pattern  # 或從 utils.response import

def _drug_match_clause(drug_name: str):
    pattern = word_boundary_pattern(drug_name)
    return or_(
        DrugInteraction.drug1.op("~*")(pattern),
        DrugInteraction.drug2.op("~*")(pattern),
        cast(DrugInteraction.interacting_members, SAString).op("~*")(pattern),
    )
```

`op("~*")` 是 SQLAlchemy 對 Postgres 的 case-insensitive POSIX regex。

#### 改動點 2：`backend/app/routers/pharmacy_routes/interactions.py` `_drug_match`（行 27-37）

完全相同的改法，import 同一個 `word_boundary_pattern`。

#### 改動點 3：`backend/app/routers/clinical.py` `_pair_on_different_sides`（行 864-868）

把雙向 `in` 改成「整字相等 OR 雙向、字邊界、且 head/tail 條件化」的 helper。**注意保留雙向**：原邏輯是「user 輸入包含 row 名」或「row 名包含 user 輸入」，兩個方向都要保留，不然 user 輸入 `Prednisolone (Systemic)` 就匹配不到 DB row 純 `Prednisolone`。

```python
# 改前
da_s1 = any(da_l in n or n in da_l for n in side1)
da_s2 = any(da_l in n or n in da_l for n in side2)
db_s1 = any(db_l in n or n in db_l for n in side1)
db_s2 = any(db_l in n or n in db_l for n in side2)

# 改後
from app.utils.drug_match import word_match  # 與 word_boundary_pattern 同檔

# word_match 內部同時做：
#   1. 短路：a == b 直接回 True
#   2. _word_pattern(shorter) 在 longer 裡 search（雙向都試），head/tail 條件化加 \b
da_s1 = any(word_match(da_l, n) for n in side1)
da_s2 = any(word_match(da_l, n) for n in side2)
db_s1 = any(word_match(db_l, n) for n in side1)
db_s2 = any(word_match(db_l, n) for n in side2)
```

helper 的實作（放在 §4.1 開頭那個 `drug_match.py` 同一個檔案）：

```python
def _word_pattern(name: str) -> str:
    """同 word_boundary_pattern，但使用 Python `\\b` 而非 Postgres `\\m\\M`。"""
    if not name:
        return ""
    escaped = re.escape(name)
    head = r"\b" if (name[0].isalnum() or name[0] == "_") else ""
    tail = r"\b" if (name[-1].isalnum() or name[-1] == "_") else ""
    return f"{head}{escaped}{tail}"


def word_match(a: str, b: str) -> bool:
    """雙向字邊界子字串比對 — 取代原本的 `a in b or b in a`。"""
    if not a or not b:
        return False
    if a == b:
        return True
    # 兩個方向都試（保留原雙向語意）
    if re.search(_word_pattern(a), b) is not None:
        return True
    if re.search(_word_pattern(b), a) is not None:
        return True
    return False
```

註：Python `re` 的 `\b` 跟 Postgres 的 `\m`/`\M` 邊界判定都是「字母/數字/底線 vs. 其他字元」。

#### 改動點 4：`backend/app/routers/pharmacy_routes/interactions.py` `_pair_on_different_sides`（行 104-109）

同樣 import `word_match`，替換掉四行雙向 `in`。

#### 改動點 5：前端 `src/pages/pharmacy/interactions.tsx` 摘要配對（行 407-411）

也要保留雙向語意 + head/tail 條件化：

```ts
// 改前
for (const drug of validDrugs) {
  const dl = drug.toLowerCase();
  if (!matchA && side1.some(n => n.includes(dl) || dl.includes(n))) matchA = drug;
  if (!matchB && side2.some(n => n.includes(dl) || dl.includes(n))) matchB = drug;
}

// 改後
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);

const wordPattern = (name: string): RegExp | null => {
  if (!name) return null;
  const head = isWord(name[0]) ? '\\b' : '';
  const tail = isWord(name[name.length - 1]) ? '\\b' : '';
  return new RegExp(`${head}${escapeRe(name)}${tail}`, 'i');
};

const wordMatch = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = wordPattern(a);
  const pb = wordPattern(b);
  return (pa !== null && pa.test(b)) || (pb !== null && pb.test(a));
};

for (const drug of validDrugs) {
  const dl = drug.toLowerCase();
  if (!matchA && side1.some(n => wordMatch(dl, n))) matchA = drug;
  if (!matchB && side2.some(n => wordMatch(dl, n))) matchB = drug;
}
```

> 注意：JS `\b` 預設是 ASCII `\w` 邊界（不含 Unicode）。ChatICU 藥名都是英文，影響為零。

---

### 4.2 中期方案 B：改用 ATC 碼比對（根除問題，要動資料流）

`drug_interactions` 表已有 `drug1_atc` / `drug2_atc` 欄位（migration 061 + `backend/scripts/backfill_drug_interactions_atc.py`）。如果把查詢改用 ATC：

1. 前端 `DRUG_LIST` 中每個標準名都建一個 `name → ATC` 對照（資料來源：`backend/app/fhir/code_maps/drug_formulary.csv` + `auto_rxnorm_cache.json`）
2. 送 query 時把 `drug_list` 解析成 ATC 碼
3. 後端 `WHERE drug1_atc = :a AND drug2_atc = :b`（雙向 OR）

完全消除字串污染。但需要先確認：
- ATC backfill 覆蓋率（`SELECT COUNT(*) FROM drug_interactions WHERE drug1_atc IS NULL` 跑一下）
- `interacting_members` 群組成員的 ATC 解析（群組是 class，要對 ATC 前綴比對，例如 PPIs = `A02BC*`）
- 複方藥（多 ATC）處理

**B 適合排在下個 sprint**，A 先上止血。

---

### 4.3 保守備案 C：只動前端摘要 key

如果不動後端，至少把摘要的配對 key 改成「row 自己的 `drug1/drug2`」而非「使用者輸入藥名 sort 後 join」：

```ts
// src/pages/pharmacy/interactions.tsx:413-414  改前
const [sortedA, sortedB] = [matchA, matchB].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
const key = `${sortedA.toLowerCase()}|${sortedB.toLowerCase()}`;

// 改後
const [sortedA, sortedB] = [item.drug1, item.drug2].sort(...);
const key = `${sortedA.toLowerCase()}|${sortedB.toLowerCase()}`;
```

效果：本來合併成一列「prednisolone ↔ <CYP3A4>」拿 Risk C 的，會變成兩列：
- `CYP3A4 Inhibitors (Moderate) ↔ PrednisoLONE (Systemic)` Risk B
- `CYP3A4 Inhibitors (Moderate) ↔ MethylPredniSOLONE (Systemic)` Risk C

使用者一眼看出兩個是不同對，自己判斷 methylprednisolone 那筆不該被列入。**這只是讓 UI 不騙人，沒解決誤撈**。

---

## 5. 建議落地順序

| 順序 | 動作 | 預期效果 | 風險 |
|---|---|---|---|
| 1 | 方案 A：5 個改動點全做 | I-16 案例不再出現 methylprednisolone；同類 ⊂ 母字串問題全擋 | 低；但「Aspirin (Systemic)」這類括號名仍被字邊界視為合法（`)` 是 \W），維持原行為 |
| 2 | 跑 regression：人工挑 10 對歷史踩過的子字串案例（皮質類固醇、甲狀腺素等），確認摘要 / 詳細區一致 | 確保沒誤殺合法案例 | — |
| 3 | 中期排 B（ATC）；A 先上線 | 根本解決 | 需要前端 DRUG_LIST → ATC 對照表，跨 session 工作 |

---

## 6. 驗證 SQL（事後檢核）

修完後拿 I-16 病患的 prednisolone 直接打 endpoint，比對結果：

```bash
curl -X POST 'https://chaticu-production-8060.up.railway.app/api/v1/clinical/interactions' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <auth>' \
  -d '{"drug_list":["Prednisolone","<某 CYP3A4 抑制劑>"]}' | jq '.data.findings[] | {drug_a, drug_b, risk_rating}'
```

修正前：會看到 `MethylPredniSOLONE` 的列。
修正後：只剩 `PrednisoLONE` 那列。

也可以直接在 DB 驗：

```sql
-- 修正前的查法（會誤撈）
SELECT id, drug1, drug2, risk_rating
FROM drug_interactions
WHERE drug1 ILIKE '%prednisolone%' OR drug2 ILIKE '%prednisolone%';

-- 修正後的查法（不會誤撈）
SELECT id, drug1, drug2, risk_rating
FROM drug_interactions
WHERE drug1 ~* '\mprednisolone\M' OR drug2 ~* '\mprednisolone\M';
```

兩個查法的差集就是被誤撈的母字串列。

---

## 7. 修正方案的 peer review 驗證（2026-05-06）

本文件提出的修正方案經三個 Opus 4.7 agent 並行審查，結論：

- **Agent 1（引用準確性）**：5 個改動點的 file:line 全對，「改前」code block 與 source 完全相符。
- **Agent 2（regex 正確性）**：用 Python `re` 跑過 7 個對照案例（`prednisolone`/`methylprednisolone`、`cortisone`/`hydrocortisone`、`thyroxine`/`levothyroxine`、`salicylic`/`acetylsalicylic`、`Aspirin (Systemic)`、`Aspirin, low dose`、hyphenated `5-Fluorouracil` / `L-Thyroxine`），全部符合預期。
- **Agent 3（邏輯鏈完整性）**：三段因果鏈端到端確認，沒有遺漏的 canonicalization / dedup 步驟。

審查抓到並已修正的 issue：

1. **固定 `\m...\M` 對結尾非字元的藥名（如 `Prednisolone (Systemic)`）會 anchor 失敗** — 已改為 `word_boundary_pattern` helper，依藥名頭/尾字元類型條件化加 `\m` / `\M`。
2. **單向 `_word_match` 會破壞「user 輸入帶 `(Systemic)` 但 DB row 是純名」的合法雙向匹配** — 已改為雙向 `word_match`，兩個方向各自跑一次 word-boundary 子字串檢查。
3. 上述兩個修正同步套用到後端 SQL（改動點 1、2）、後端 Python helper（改動點 3、4）、前端 JS helper（改動點 5）。

---

## 8. 檔案/行號索引

| 改動點 | 檔案 | 行 |
|---|---|---|
| 1 | `backend/app/routers/clinical.py` `_drug_match_clause` | 840-847 |
| 2 | `backend/app/routers/pharmacy_routes/interactions.py` `_drug_match` | 27-37 |
| 3 | `backend/app/routers/clinical.py` `_pair_on_different_sides` | 864-868 |
| 4 | `backend/app/routers/pharmacy_routes/interactions.py` `_pair_on_different_sides` | 104-109 |
| 5 | `src/pages/pharmacy/interactions.tsx` 摘要配對 | 407-411 |
